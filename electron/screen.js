/**
 * 识屏（对标 dsh-pet「看看屏幕」+「主动识屏陪伴」）：
 * - getForegroundWindow：PowerShell 读前台窗口（标题/进程名/矩形），带短缓存；
 * - captureScreenDataUrl：desktopCapturer 截屏，仅内存不落盘；
 * - askScreen：截屏 + 前台上下文 → 视觉模型回答；
 * - startProactiveWatcher：前台切到白名单应用时主动冒泡关怀（默认关闭）。
 * 仅 Windows 提供前台窗口信息；其他平台降级为纯截屏。
 */
const { execFile } = require('child_process');

const FG_CACHE_MS = 800;

const PS_SCRIPT = `
Add-Type @"
using System;using System.Runtime.InteropServices;using System.Text;
public class FGPet{
[DllImport("user32.dll")]public static extern IntPtr GetForegroundWindow();
[DllImport("user32.dll")]public static extern int GetWindowText(IntPtr h,StringBuilder t,int c);
[DllImport("user32.dll")]public static extern uint GetWindowThreadProcessId(IntPtr h,out uint pid);
[DllImport("user32.dll")]public static extern bool GetWindowRect(IntPtr h,out RECT r);
public struct RECT{public int L;public int T;public int R;public int B;}
}
"@
$h=[FGPet]::GetForegroundWindow()
$sb=New-Object System.Text.StringBuilder 512
[void][FGPet]::GetWindowText($h,$sb,512)
$wpid=0
[void][FGPet]::GetWindowThreadProcessId($h,[ref]$wpid)
$pn=''
try{$pn=(Get-Process -Id $wpid -ErrorAction Stop).ProcessName}catch{}
$r=New-Object FGPet+RECT
[void][FGPet]::GetWindowRect($h,[ref]$r)
"[$($r.L),$($r.T),$($r.R),$($r.B)]|$pn|$($sb.ToString())"
`;

let fgCache = { at: 0, value: null };
let fgInFlight = null;

/** 返回 {x,y,w,h,process,title} 或 null */
function getForegroundWindow() {
  if (process.platform !== 'win32') return Promise.resolve(null);
  if (fgCache.value && Date.now() - fgCache.at < FG_CACHE_MS) return Promise.resolve(fgCache.value);
  if (fgInFlight) return fgInFlight;

  fgInFlight = new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', PS_SCRIPT],
      { timeout: 5000, windowsHide: true },
      (err, stdout) => {
        fgInFlight = null;
        let value = null;
        if (!err && stdout) {
          const line = stdout.trim().split('\n').pop() || '';
          const [rect, process, ...titleParts] = line.split('|');
          const m = /^\[(-?\d+),(-?\d+),(-?\d+),(-?\d+)\]$/.exec(rect || '');
          if (m && process !== undefined) {
            const [L, T, R, B] = m.slice(1).map(Number);
            value = {
              x: L,
              y: T,
              w: R - L,
              h: B - T,
              process: process.trim(),
              title: titleParts.join('|').trim(),
            };
          }
        }
        fgCache = { at: Date.now(), value };
        resolve(value);
      },
    );
  });
  return fgInFlight;
}

/** 判断前台窗口是否为真全屏（区分最大化：最大化不会完全覆盖任务栏区） */
async function isForegroundFullscreen() {
  const fg = await getForegroundWindow();
  return Boolean(fg && fg.w > 0 && fg.h > 0 && fg.x <= 0 && fg.y <= 0);
}

/**
 * 截屏 → JPEG dataURL（仅内存）。
 * @param {{width?:number,height?:number}} size
 */
async function captureScreenDataUrl(desktopCapturer, size = { width: 1280, height: 800 }) {
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: size,
  });
  const shot = sources.find((s) => s.thumbnail && !s.thumbnail.isEmpty());
  if (!shot) throw new Error('没有可截取的屏幕');
  return shot.thumbnail.toDataURL({ format: 'jpeg', quality: 0.72 });
}

const SCREEN_SYSTEM_PROMPT =
  '你是用户的桌面宠物小猫，用户让你「看看屏幕」。根据截图和前台窗口信息，' +
  '用简短的中文（80字内）说明你看到了什么，语气软萌可爱，可带一个emoji。不要逐字罗列，挑重点说。';

/** 看看屏幕：截屏 + 前台窗口 → 视觉模型。返回文本。 */
async function askScreen(llm, cfg, { question } = {}) {
  const shot = await captureScreenDataUrl();
  const fg = await getForegroundWindow();
  const context = fg
    ? `前台窗口：${fg.title}（进程 ${fg.process}）`
    : '前台窗口信息不可用';
  const q = String(question || '').trim() || '看看我现在屏幕上是什么？';
  return llm.chatOnce({
    baseUrl: cfg.baseUrl,
    apiKey: cfg.apiKey,
    model: cfg.visionModel || cfg.model,
    systemPrompt: SCREEN_SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: `${q}\n${context}` },
          { type: 'image_url', image_url: { url: shot } },
        ],
      },
    ],
  });
}

const CARE_SYSTEM_PROMPT =
  '你是用户的桌面宠物小猫。用户刚刚切换到了某个应用，请结合应用名与窗口标题，' +
  '主动说一句简短（40字内）的关心话，语气软萌，带一个emoji，不要问句结尾堆叠，只输出这一句话。';

const CARE_FALLBACK = [
  '打开新页面啦，注意休息眼睛哦 👀',
  '又切应用了～坐姿要端正呀！',
  '看到你忙起来了，记得喝水 💧',
];

/**
 * 主动识屏陪伴 watcher。
 * @returns {() => void} stop()
 */
function startProactiveWatcher({ loadSettings, llm, resolveProvider, matchesWhitelist, onCare }) {
  const POLL_MS = 3000;
  const COOLDOWN_MS = 8 * 60 * 1000;
  let lastTitle = null;
  let lastCareAt = 0;
  let stopped = false;

  const timer = setInterval(async () => {
    if (stopped) return;
    const s = loadSettings();
    if (!s.proactiveSense) return;
    const fg = await getForegroundWindow();
    if (!fg) return;
    const identity = `${fg.process}|${fg.title}`;
    if (identity === lastTitle) return;
    lastTitle = identity;
    if (Date.now() - lastCareAt < COOLDOWN_MS) return;
    if (!matchesWhitelist(fg.title, s.senseWhitelist || []) && !matchesWhitelist(fg.process, s.senseWhitelist || [])) {
      return;
    }
    lastCareAt = Date.now();
    let line = null;
    const cfg = resolveProvider(null);
    if (cfg.apiKey && cfg.model) {
      try {
        line = await llm.chatOnce({
          baseUrl: cfg.baseUrl,
          apiKey: cfg.apiKey,
          model: cfg.model,
          systemPrompt: CARE_SYSTEM_PROMPT,
          messages: [{ role: 'user', content: `应用：${fg.process}\n窗口标题：${fg.title}` }],
          maxTokens: 120,
          timeout: 15000,
        });
      } catch {
        line = null;
      }
    }
    if (!line) line = CARE_FALLBACK[Math.floor(Math.random() * CARE_FALLBACK.length)];
    onCare(line, fg);
  }, POLL_MS);

  return () => {
    stopped = true;
    clearInterval(timer);
  };
}

module.exports = { getForegroundWindow, isForegroundFullscreen, captureScreenDataUrl, askScreen, startProactiveWatcher };
