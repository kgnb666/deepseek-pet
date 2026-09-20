const {
  app,
  BrowserWindow,
  ipcMain,
  Tray,
  Menu,
  nativeImage,
  screen,
  safeStorage,
  shell,
  dialog,
  protocol,
  session,
  desktopCapturer,
  Notification,
} = require('electron');

const path = require('path');
const fs = require('fs');
const https = require('https');
const { spawn } = require('child_process');
const { pathToFileURL } = require('url');

// ---- 多实例（对标 dsh-pet「生小肥鱼」）：--pet-name=xxx → 独立 userData（配置隔离）----
// 单实例锁按 userData 区分：同名宠物仍然单例，不同名字可以共存。
const PET_NAME = (() => {
  const arg = process.argv.find((a) => a.startsWith('--pet-name='));
  const raw = arg ? arg.slice('--pet-name='.length) : '';
  const clean = raw.replace(/[\\/:*?"<>|]/g, '').trim().slice(0, 20);
  return clean || '';
})();
if (PET_NAME) {
  app.setPath('userData', path.join(app.getPath('userData'), 'pets', PET_NAME));
}

// ---- GPU 崩溃回退：默认启用硬件加速，仅在 GPU 进程崩溃时回退软渲染并重启 ----
// 必须注册在模块顶层（ready 之前），否则启动期的 GPU 崩溃（Chromium 直接 FATAL）捕获不到。
function readRawSettings() {
  try {
    return JSON.parse(fs.readFileSync(path.join(app.getPath('userData'), 'settings.json'), 'utf8'));
  } catch {
    return {};
  }
}
function writeRawSettings(obj) {
  fs.writeFileSync(path.join(app.getPath('userData'), 'settings.json'), JSON.stringify(obj, null, 2));
}
function handleGpuFallback() {
  const raw = readRawSettings();
  if (raw.gpuFallback) return; // 已回退，避免重启循环
  writeRawSettings({ ...raw, gpuFallback: true });
  app.relaunch();
  app.exit(0);
}
app.on('gpu-process-crashed', handleGpuFallback);
app.on('child-process-gone', (_event, details) => {
  if (details.type === 'GPU' && details.reason !== 'clean-exit') handleGpuFallback();
});

// 上次 GPU 进程崩溃过 → 本次以软渲染「安全模式」启动，并立即复位标记：
// 下次启动恢复硬件加速。GPU 再次崩溃会再次进入安全模式（自愈循环），
// 避免崩溃一次就永久卡在软渲染（透明窗口在软渲染下会整窗不可见）。
if (readRawSettings().gpuFallback) {
  app.disableHardwareAcceleration();
  app.commandLine.appendSwitch('disable-gpu');
  writeRawSettings({ ...readRawSettings(), gpuFallback: false });
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
  '.webm': 'video/webm',
  '.mp4': 'video/mp4',
  '.gif': 'image/gif',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.flac': 'audio/flac',
  '.m4a': 'audio/mp4',
};

// ES Module 无法从 file:// 加载（origin 为 null 会被 CORS 拦截），
// 因此注册 app:// 自定义协议托管本地资源，同时兼容 CSP 的 'self'。
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
  // res:// 托管 userData 下的热加载素材（外部角色 / 自定义音效包）
  {
    scheme: 'res',
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true },
  },
]);

function serveFile(root, rawPath) {
  const filePath = path.resolve(root, rawPath);
  const rootPrefix = root.endsWith(path.sep) ? root : root + path.sep;
  if (filePath !== root && !filePath.startsWith(rootPrefix)) {
    return new Response('Forbidden', { status: 403 }); // 防目录穿越（resolve + sep，避免兄弟目录前缀命中）
  }
  try {
    const data = fs.readFileSync(filePath);
    const type = MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
    return new Response(data, { headers: { 'Content-Type': type } });
  } catch {
    return new Response('Not Found', { status: 404 });
  }
}

function registerAppProtocol() {
  protocol.handle('app', (request) => {
    const rawPath = decodeURIComponent(new URL(request.url).pathname).replace(/^\/+/, '') || 'index.html';
    return serveFile(path.resolve(__dirname), rawPath);
  });
  protocol.handle('res', (request) => {
    const rawPath = decodeURIComponent(new URL(request.url).pathname).replace(/^\/+/, '') || 'index.html';
    return serveFile(app.getPath('userData'), rawPath);
  });
}

// ---- 主进程子系统 ----
const { ProviderStore } = require('./electron/providers');
const { ChatStore } = require('./electron/chatStore');
const llm = require('./electron/llm');
const { startAgentLink, DEFAULT_PORT } = require('./electron/agentLink');
const screenMod = require('./electron/screen');
const { startCollision } = require('./electron/collision');
const { checkUpdate } = require('./electron/updater');
const hotAssets = require('./electron/hotAssets');

let win = null;
let chatWin = null;
let tray = null;
let refreshTrayMenuFn = null;
let balanceCache = { at: 0, result: null };
const BALANCE_TTL_MS = 30 * 1000;

let providers = null; // ProviderStore
let chatStore = null; // ChatStore
let agentServer = null;
let collisionCtl = null;
let stopProactive = null;
let screenMatch = { matchesWhitelist: () => false }; // 共享 ESM 模块加载后替换
const chatStreams = new Map(); // requestId → {abort, acc, sessionId}
const notifySeen = new Map(); // 系统通知去重

function clampOpacity(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 100;
  return Math.min(100, Math.max(10, Math.round(n)));
}

function applyOpacity(pct) {
  if (!win || win.isDestroyed()) return;
  win.setOpacity(clampOpacity(pct) / 100);
}

function applyClickThrough(on) {
  if (!win || win.isDestroyed()) return;
  if (on) win.setIgnoreMouseEvents(true, { forward: true });
  else win.setIgnoreMouseEvents(false);
}

function sendToPet(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}
function sendToChat(channel, payload) {
  if (chatWin && !chatWin.isDestroyed()) chatWin.webContents.send(channel, payload);
}

// ---- 单实例锁：同 userData 双开时聚焦已有窗口并退出新实例 ----
// 注意：app.quit() 不会取消已注册的 whenReady 回调，所以整个启动流程必须放在锁的保护分支里，
// 否则第二个实例会在 quit 后照样创建窗口而存活（曾经导致 5 个实例共存）。
// 多开宠物（--pet-name）使用独立 userData，锁互不影响。
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.exit(0); // 比 quit() 更果断：不跑任何生命周期回调
} else {
  app.on('second-instance', () => {
    if (win) {
      if (!win.isVisible()) win.show();
      win.moveTop();
      win.focus();
    }
  });
  app.whenReady().then(bootstrap);
}

const settingsPath = () => path.join(app.getPath('userData'), 'settings.json');

const DEFAULT_SETTINGS = {
  apiKey: '',
  refreshMinutes: 5,
  lowBalanceThreshold: 20,
  balanceChangeThreshold: 1, // 余额变动提醒阈值（¥ ）
  offpeakBoost: true, // 低价时段按设定间隔，高价时段 ×3 降频
  alwaysOnTop: true,
  autoStart: false,
  model: 'deepseek-v4-flash',
  skin: 'char_main',
  panelOpen: true,
  miniMode: false,
  animationsPaused: false,
  soundEnabled: true,
  windowBounds: null, // {x, y, width, height}
  gpuFallback: false, // GPU 进程曾崩溃 → 下次以软渲染启动
  clickThrough: false, // 鼠标穿透：点击落到下层窗口
  lockPosition: false, // 锁定位置；按住 Shift 仍可拖
  opacity: 100, // 窗口不透明度 10–100
  // ---- 对标 dsh-pet 的新增能力 ----
  animSpeed: 1, // 动画播放倍速 1.0–2.0
  notifications: false, // 系统通知（任务完成/失败、余额告警）
  fullscreenHide: false, // 检测到真全屏应用时自动隐藏
  captureProtect: false, // 窗口捕获保护（防截屏/录屏；关闭即 OBS 可捕获）
  proactiveSense: false, // 主动识屏陪伴（白名单应用切换时冒泡关怀）
  senseWhitelist: [], // 识屏白名单（子串或 * 通配）
  musicSing: false, // 检测到后台音乐时自动唱歌
  agentServer: true, // Agent 联动 HTTP 服务
  agentToken: '', // Agent 鉴权 token（空 = 不鉴权，仅监听 127.0.0.1）
  updateRepo: '', // 检查更新的 GitHub 仓库（user/repo）
  chatFollow: false, // 聊天窗跟随桌宠
  chatBounds: null,
  agentSystemPrompt: '', // Agent 快速问答 / 识屏陪伴的人设（空 = 内置小猫默认）
};

// ---- API Key 安全存储：safeStorage 加密落盘，不可用时降级明文并标记 ----
function encryptionAvailable() {
  try {
    return safeStorage.isEncryptionAvailable();
  } catch {
    return false;
  }
}

function loadSettings() {
  let raw = {};
  try {
    raw = JSON.parse(fs.readFileSync(settingsPath(), 'utf8'));
  } catch {
    /* 首次运行 */
  }
  const s = { ...DEFAULT_SETTINGS, ...raw };
  s.keyEncrypted = false;
  if (s.apiKeyEnc) {
    try {
      s.apiKey = safeStorage.decryptString(Buffer.from(s.apiKeyEnc, 'base64'));
      s.keyEncrypted = true;
    } catch {
      s.apiKey = ''; // 解密失败（如换机/换用户），当作未设置
    }
  }
  // 明文 Key 自动迁移为密文
  if (s.apiKey && !s.apiKeyEnc && encryptionAvailable()) {
    raw.apiKeyEnc = safeStorage.encryptString(s.apiKey).toString('base64');
    raw.apiKeyPlain = false;
    delete raw.apiKey;
    saveSettings(raw);
    s.apiKeyEnc = raw.apiKeyEnc;
    s.keyEncrypted = true;
  }
  return s;
}

function saveSettings(s) {
  fs.writeFileSync(settingsPath(), JSON.stringify(s, null, 2));
}

// 把 bounds 限制在目标显示器的 workArea 内（防拔副屏后窗口不可见）
function clampBounds(b) {
  const wa = screen.getDisplayMatching({ x: b.x, y: b.y, width: b.width, height: b.height }).workArea;
  const width = Math.min(b.width, wa.width);
  const height = Math.min(b.height, wa.height);
  return {
    x: Math.min(Math.max(b.x, wa.x), wa.x + wa.width - width),
    y: Math.min(Math.max(b.y, wa.y), wa.y + wa.height - height),
    width,
    height,
  };
}

function createWindow() {
  const s = loadSettings();
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  const isMini = !!s.miniMode;
  const size = isMini ? { width: 300, height: 68 } : { width: 660, height: 470 };
  // 统一按右下角锚点恢复位置（与 set-mini 的锚定逻辑一致）
  let pos = { x: width - size.width - 40, y: height - size.height - 40 };
  if (s.windowBounds) {
    pos = {
      x: s.windowBounds.x + s.windowBounds.width - size.width,
      y: s.windowBounds.y + s.windowBounds.height - size.height,
    };
  }
  const b = clampBounds({ ...pos, ...size });
  win = new BrowserWindow({
    width: b.width,
    height: b.height,
    x: b.x,
    y: b.y,
    transparent: true,
    frame: false,
    resizable: false,
    alwaysOnTop: s.alwaysOnTop,
    skipTaskbar: true,
    hasShadow: false,
    title: PET_NAME ? `DeepSeek Pet · ${PET_NAME}` : 'DeepSeek Pet',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadURL('app://./index.html' + (process.env.PET_MINI ? '?mini=1' : ''));
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  applyClickThrough(s.clickThrough);
  applyOpacity(s.opacity);
  win.setContentProtection(Boolean(s.captureProtect));
  win.on('hide', () => {
    if (!win.isDestroyed()) win.webContents.send('win-visibility', false);
  });
  win.on('show', () => {
    if (!win.isDestroyed()) win.webContents.send('win-visibility', true);
  });
}

// ---------- 聊天窗（对标 dsh-pet 聊天工作台） ----------
function createChatWindow() {
  if (chatWin && !chatWin.isDestroyed()) {
    chatWin.show();
    chatWin.focus();
    return;
  }
  const s = loadSettings();
  const bounds = s.chatBounds || { width: 880, height: 620 };
  chatWin = new BrowserWindow({
    width: bounds.width || 880,
    height: bounds.height || 620,
    x: bounds.x,
    y: bounds.y,
    minWidth: 640,
    minHeight: 460,
    title: 'DeepSeek Pet · AI 聊天',
    autoHideMenuBar: true,
    backgroundColor: '#f4f7ff',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  chatWin.loadURL('app://./chat.html');
  chatWin.on('close', () => {
    saveSettings({ ...loadSettings(), chatBounds: chatWin.getBounds() });
  });
  chatWin.on('closed', () => {
    chatWin = null;
  });
}

// 聊天窗跟随桌宠（对标 dsh-pet「跟随桌宠移动」）
let followTimer = null;
function setChatFollow(on) {
  clearInterval(followTimer);
  followTimer = null;
  if (!on) return;
  followTimer = setInterval(() => {
    if (!chatWin || chatWin.isDestroyed() || !win || win.isDestroyed()) return;
    const pet = win.getBounds();
    const chat = chatWin.getBounds();
    const wa = screen.getDisplayMatching(pet).workArea;
    let x = pet.x + pet.width + 12;
    if (x + chat.width > wa.x + wa.width) x = pet.x - chat.width - 12; // 右侧放不下换左边
    const y = Math.min(Math.max(pet.y + (pet.height - chat.height) / 2, wa.y), wa.y + wa.height - chat.height);
    chatWin.setPosition(Math.round(Math.max(wa.x, x)), Math.round(y));
  }, 400);
}

// ---------- 系统通知（dsh-pet 没做成的，Electron 原生 Toast 可以） ----------
function showSystemNotification(title, body) {
  if (!Notification.isSupported()) return;
  const key = `${title}|${body}`;
  const last = notifySeen.get(key) || 0;
  if (Date.now() - last < 30_000) return; // 30s 去重，避免刷屏
  notifySeen.set(key, Date.now());
  try {
    new Notification({ title, body, silent: false, icon: path.join(__dirname, 'assets', 'icon.ico') }).show();
  } catch {
    /* 通知失败不影响主流程 */
  }
}

// ---------- 全屏自动隐藏（对标 dsh-pet：区分真全屏与最大化） ----------
let autoHiddenByFullscreen = false;
function startFullscreenWatcher() {
  setInterval(async () => {
    const s = loadSettings();
    if (!s.fullscreenHide) {
      if (autoHiddenByFullscreen) {
        autoHiddenByFullscreen = false;
        if (win && !win.isDestroyed()) win.show();
      }
      return;
    }
    const fullscreen = await screenMod.isForegroundFullscreen();
    if (fullscreen && win && win.isVisible() && !autoHiddenByFullscreen) {
      win.hide();
      autoHiddenByFullscreen = true;
    } else if (!fullscreen && autoHiddenByFullscreen) {
      autoHiddenByFullscreen = false;
      win.show();
    }
  }, 2000);
}

// ---------- Agent 事件路由 ----------
function routeAgentEvent(event) {
  if (event.type === 'chat') {
    // Agent 聊天事件：走激活 Provider 生成一句回答，气泡显示
    handleAgentChat(event.text);
    return;
  }
  if (event.type === 'task' && event.status === 'success' && loadSettings().notifications) {
    showSystemNotification('DeepSeek Pet', event.title || '任务完成');
  }
  if (event.type === 'task' && event.status === 'error' && loadSettings().notifications) {
    showSystemNotification('DeepSeek Pet 出错啦', event.title || event.detail || '任务失败');
  }
  sendToPet('agent-event', event);
}

async function handleAgentChat(text) {
  const s = loadSettings();
  const cfg = providers.resolveForCall(null);
  sendToPet('agent-event', { type: 'task', status: 'thinking', title: '正在思考你的问题 🤔', detail: 'Agent 快速对话' });
  if (!cfg.apiKey) {
    sendToPet('agent-event', { type: 'say', text: '先在聊天窗设置里填好 Provider 的 API Key，我才能开口说话呀～', level: 'warn' });
    sendToPet('agent-event', { type: 'task', status: 'error', title: '未配置 AI Provider', detail: '打开聊天窗 → 设置' });
    return;
  }
  try {
    const answer = await llm.chatOnce({
      baseUrl: cfg.baseUrl,
      apiKey: cfg.apiKey,
      model: cfg.model,
      systemPrompt: s.agentSystemPrompt || '你是用户的桌面宠物小猫，回答简短可爱，50字以内。',
      messages: [{ role: 'user', content: text }],
      maxTokens: 300,
    });
    sendToPet('agent-event', { type: 'task', status: 'idle' });
    sendToPet('agent-event', { type: 'say', text: answer, level: 'success' });
  } catch (e) {
    sendToPet('agent-event', { type: 'task', status: 'error', title: 'AI 请求失败 ⚠️', detail: String(e.message || e).slice(0, 120) });
  }
}

// ---------- 聊天流式请求 ----------
function startChatStream({ requestId, sessionId, messages, providerId, model, systemPrompt }) {
  const cfg = providers.resolveForCall(providerId);
  if (!cfg.apiKey) {
    sendToChat('chat-delta', { requestId, sessionId, error: '该 Provider 未配置 API Key', done: true });
    return;
  }
  let acc = '';
  const handle = llm.streamChat(
    {
      baseUrl: cfg.baseUrl,
      apiKey: cfg.apiKey,
      model: model || cfg.model,
      messages,
      systemPrompt,
    },
    (chunk) => {
      if (chunk.delta) acc += chunk.delta;
      sendToChat('chat-delta', { requestId, sessionId, ...chunk });
      if (chunk.done) {
        chatStreams.delete(requestId);
        if (acc && !chunk.error && sessionId) {
          try {
            chatStore.finalizeAssistant(sessionId, acc);
          } catch {
            /* 持久化失败不阻断 */
          }
        }
      }
    },
  );
  chatStreams.set(requestId, handle);
}

// ---------- 保存窗口位置（合并进 settings.json） ----------
function persistBounds() {
  if (!win || win.isDestroyed()) return;
  const s = loadSettings();
  saveSettings({ ...s, windowBounds: win.getBounds() });
}
let boundsSaveTimer = null;
function persistBoundsDebounced() {
  clearTimeout(boundsSaveTimer);
  boundsSaveTimer = setTimeout(persistBounds, 1000); // 拖动结束防抖 1s
}

// ---------- 多实例：由托盘 / 右键菜单触发 ----------
function spawnPetInstance() {
  const name = `kitty-${Date.now().toString(36).slice(-4)}`;
  const args = app.isPackaged ? [`--pet-name=${name}`] : [app.getAppPath(), `--pet-name=${name}`];
  spawn(process.execPath, args, { detached: true, stdio: 'ignore' }).unref();
}

function createTray() {
  const icon = nativeImage
    .createFromPath(path.join(__dirname, 'assets', 'char_main.png'))
    .resize({ width: 18, height: 18 });
  tray = new Tray(icon);
  tray.setToolTip(PET_NAME ? `DeepSeek Pet · ${PET_NAME}` : 'DeepSeek Pet');

  const buildMenu = () => {
    const s = loadSettings();
    const petLabel = PET_NAME ? `（${PET_NAME}）` : '';
    return Menu.buildFromTemplate([
      {
        label: `打开面板${petLabel}`,
        click: () => {
          win.show();
          win.webContents.send('panel-open');
        },
      },
      { label: '显示 / 隐藏', click: () => (win.isVisible() ? win.hide() : win.show()) },
      { label: 'AI 聊天窗', click: () => createChatWindow() },
      {
        label: '迷你模式',
        type: 'checkbox',
        checked: !!s.miniMode,
        click: () => win.webContents.send('tray-toggle-mini'),
      },
      {
        label: '暂停动画',
        type: 'checkbox',
        checked: !!s.animationsPaused,
        click: (item) => win.webContents.send('toggle-animations', item.checked),
      },
      {
        label: '鼠标穿透',
        type: 'checkbox',
        checked: !!s.clickThrough,
        click: () => win.webContents.send('tray-toggle-through'),
      },
      {
        label: '锁定位置',
        type: 'checkbox',
        checked: !!s.lockPosition,
        click: () => win.webContents.send('tray-toggle-lock'),
      },
      {
        label: '🐣 生一只小猫（多开）',
        click: () => spawnPetInstance(),
      },
      { label: '检查更新', click: () => win.webContents.send('tray-check-update') },
      {
        label: '关于',
        click: () => {
          dialog.showMessageBox({
            type: 'info',
            title: '关于 DeepSeek Pet',
            message: `DeepSeek Pet v${app.getVersion()}${PET_NAME ? ` · ${PET_NAME}` : ''}`,
            detail: '你的 DeepSeek API 桌面小管家\n实时余额 · AI 聊天 · 识屏陪伴 · Agent 联动',
            buttons: ['好的'],
          });
        },
      },
      { type: 'separator' },
      { label: '退出', click: () => app.quit() },
    ]);
  };

  const refreshTrayMenu = () => tray.setContextMenu(buildMenu());
  refreshTrayMenu();
  refreshTrayMenuFn = refreshTrayMenu;
  tray.on('click', () => (win.isVisible() ? win.hide() : win.show()));
}

// ---- DeepSeek 余额查询 ----
function fetchBalance(apiKey) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: 'api.deepseek.com',
        path: '/user/balance',
        method: 'GET',
        headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
        timeout: 10000,
      },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, body: JSON.parse(data) });
          } catch {
            reject(new Error('响应解析失败'));
          }
        });
      },
    );
    req.on('timeout', () => req.destroy(new Error('请求超时')));
    req.on('error', reject);
    req.end();
  });
}

function bootstrap() {
  registerAppProtocol();
  createWindow();
  createTray();

  providers = new ProviderStore({ userData: app.getPath('userData'), safeStorage });
  chatStore = new ChatStore(app.getPath('userData'));

  // 共享 ESM 模块（主动识屏白名单匹配）
  import(pathToFileURL(path.join(__dirname, 'src', 'shared', 'screenMatch.mjs')).href)
    .then((m) => {
      screenMatch = m;
    })
    .catch(() => {
      screenMatch = { matchesWhitelist: () => false };
    });

  // 识屏/唱歌等需要渲染层获取媒体流：授予 display-media（音频 loopback 仅 Windows）
  session.defaultSession.setDisplayMediaRequestHandler((_options, callback) => {
    desktopCapturer
      .getSources({ types: ['screen'] })
      .then((sources) => {
        callback({ video: sources[0], audio: 'loopback' });
      })
      .catch(() => callback({}));
  });

  ipcMain.handle('get-settings', () => loadSettings());
  ipcMain.handle('get-version', () => app.getVersion());
  ipcMain.handle('get-instance', () => ({ name: PET_NAME || 'main', multi: Boolean(PET_NAME) }));

  ipcMain.handle('save-settings', (_e, s) => {
    const cur = loadSettings();
    const merged = { ...cur, ...s };
    // 持久化副本：API Key 只存密文；safeStorage 不可用时降级明文并标记 apiKeyPlain
    const toSave = { ...merged };
    delete toSave.keyEncrypted;
    if (s.apiKey !== undefined) {
      balanceCache = { at: 0, result: null };
      if (encryptionAvailable() && s.apiKey) {
        toSave.apiKeyEnc = safeStorage.encryptString(s.apiKey).toString('base64');
        toSave.apiKeyPlain = false;
        delete toSave.apiKey;
      } else {
        toSave.apiKey = s.apiKey;
        toSave.apiKeyPlain = true;
        delete toSave.apiKeyEnc;
      }
      merged.keyEncrypted = !toSave.apiKeyPlain && !!s.apiKey;
    } else {
      // 未改动 Key：保持磁盘上的存储形态，不带出明文/密文之外的冗余字段
      delete toSave.apiKey;
      if (!cur.apiKeyPlain && cur.apiKeyEnc) toSave.apiKeyEnc = cur.apiKeyEnc;
      toSave.apiKeyPlain = !!cur.apiKeyPlain;
      if (cur.apiKeyPlain) toSave.apiKey = cur.apiKey;
    }
    if (s.opacity !== undefined) {
      merged.opacity = clampOpacity(s.opacity);
      toSave.opacity = merged.opacity;
    }
    if (s.animSpeed !== undefined) {
      merged.animSpeed = Math.min(2, Math.max(1, Number(s.animSpeed) || 1));
      toSave.animSpeed = merged.animSpeed;
    }
    if (Array.isArray(s.senseWhitelist)) {
      merged.senseWhitelist = s.senseWhitelist.map((x) => String(x).slice(0, 80)).filter(Boolean).slice(0, 20);
      toSave.senseWhitelist = merged.senseWhitelist;
    }
    if (s.agentToken !== undefined) toSave.agentToken = String(s.agentToken).slice(0, 128);
    if (s.updateRepo !== undefined) toSave.updateRepo = String(s.updateRepo).trim().slice(0, 100);
    saveSettings(toSave);
    if (s.alwaysOnTop !== undefined) win.setAlwaysOnTop(!!s.alwaysOnTop);
    if (s.clickThrough !== undefined) applyClickThrough(!!s.clickThrough);
    if (s.opacity !== undefined) applyOpacity(merged.opacity);
    if (s.captureProtect !== undefined && win && !win.isDestroyed()) {
      win.setContentProtection(Boolean(s.captureProtect));
    }
    if (s.autoStart !== undefined) {
      // 开发环境需要通过 electron 二进制启动并传入应用路径；打包后 exe 自身即入口，不能传 args
      const loginOpts = { openAtLogin: !!s.autoStart, path: process.execPath };
      if (!app.isPackaged) loginOpts.args = [app.getAppPath(), ...(PET_NAME ? [`--pet-name=${PET_NAME}`] : [])];
      app.setLoginItemSettings(loginOpts);
    }
    if (refreshTrayMenuFn) refreshTrayMenuFn(); // 托盘勾选项同步
    return merged;
  });
  ipcMain.handle('fetch-balance', async () => {
    const s = loadSettings();
    if (!s.apiKey) return { demo: true };
    if (balanceCache.result && Date.now() - balanceCache.at < BALANCE_TTL_MS) {
      return { ...balanceCache.result, cached: true };
    }
    try {
      const r = await fetchBalance(s.apiKey);
      let result;
      if (r.status === 200) result = { demo: false, data: r.body };
      else if (r.status === 401 || r.status === 403) result = { demo: false, error: 'Key 无效', errorType: 'auth' };
      else if (r.status === 429) result = { demo: false, error: '请求过频', errorType: 'rate' };
      else result = { demo: false, error: `API 返回 ${r.status}`, errorType: 'other' };
      if (!result.error) balanceCache = { at: Date.now(), result };
      return result;
    } catch (e) {
      return { demo: false, error: '网络异常', errorType: 'network', detail: e.message };
    }
  });

  // 价格表外置：项目根 prices.json，缺失时用内置默认并标记 fallback
  ipcMain.handle('get-prices', () => {
    const DEFAULT_PRICES = {
      'deepseek-v4-flash': {
        label: 'V4 Flash',
        normal: { hit: 0.014, miss: 0.44, out: 1.32 },
        offpeak: { hit: 0.007, miss: 0.22, out: 0.66 },
      },
      'deepseek-v4-pro': {
        label: 'V4 Pro',
        normal: { hit: 0.044, miss: 1.32, out: 3.96 },
        offpeak: { hit: 0.022, miss: 0.66, out: 1.98 },
      },
    };
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(__dirname, 'prices.json'), 'utf8'));
      return { prices: raw, fallback: false };
    } catch {
      return { prices: DEFAULT_PRICES, fallback: true };
    }
  });

  // 外链白名单：DeepSeek 官方域名 + GitHub（更新/发布页）
  ipcMain.on('open-external', (_e, url) => {
    if (typeof url !== 'string') return;
    if (/^https:\/\/([a-z0-9-]+\.)*deepseek\.com\//.test(url) || /^https:\/\/(github\.com|cdn\.jsdelivr\.net)\//.test(url)) {
      shell.openExternal(url);
    }
  });
  ipcMain.on('win-move', (_e, { dx, dy }) => {
    if (!win || win.isDestroyed()) return;
    const [x, y] = win.getPosition();
    win.setPosition(x + dx, y + dy);
    persistBoundsDebounced(); // 拖动结束 1s 后落盘
  });
  ipcMain.handle('get-geom', () => {
    if (!win || win.isDestroyed()) return null;
    const bounds = win.getBounds();
    return { bounds, workArea: screen.getDisplayMatching(bounds).workArea };
  });
  ipcMain.on('win-set-pos', (_e, { x, y }) => {
    if (!win || win.isDestroyed()) return;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    win.setPosition(Math.round(x), Math.round(y));
    persistBoundsDebounced();
  });
  ipcMain.on('set-mini', (_e, on) => {
    const wa = screen.getDisplayMatching(win.getBounds()).workArea;
    const b = win.getBounds();
    let nb;
    if (on) {
      nb = { x: b.x + b.width - 300, y: b.y + b.height - 68, width: 300, height: 68 };
    } else {
      nb = { x: b.x + b.width - 660, y: b.y + b.height - 470, width: 660, height: 470 };
    }
    nb.x = Math.min(Math.max(nb.x, wa.x), wa.x + wa.width - nb.width);
    nb.y = Math.min(Math.max(nb.y, wa.y), wa.y + wa.height - nb.height);
    win.setBounds(nb);
    persistBoundsDebounced();
  });
  ipcMain.on('win-hide', () => win.hide());
  ipcMain.on('set-ignore-mouse', (_e, on) => {
    if (!win || win.isDestroyed()) return;
    const s = loadSettings();
    if (!s.clickThrough) {
      applyClickThrough(false);
      return;
    }
    if (on) win.setIgnoreMouseEvents(true, { forward: true });
    else win.setIgnoreMouseEvents(false);
  });
  ipcMain.on('quit', () => app.quit());

  // ---------- 系统通知 / 识屏 / 更新 ----------
  ipcMain.on('notify', (_e, { title, body }) => {
    if (typeof title !== 'string' || typeof body !== 'string') return;
    showSystemNotification(title.slice(0, 60), body.slice(0, 200));
  });
  ipcMain.handle('foreground-window', () => screenMod.getForegroundWindow());
  ipcMain.handle('screen-ask', async (_e, { question }) => {
    const cfg = providers.resolveForCall(null, { vision: true });
    if (!cfg.apiKey) {
      return { ok: false, error: '请先在 AI 聊天窗 → 设置里配置 Provider 的 API Key' };
    }
    try {
      const text = await screenMod.askScreen(llm, cfg, { question });
      return { ok: true, text };
    } catch (e) {
      return { ok: false, error: String(e.message || e).slice(0, 200) };
    }
  });
  ipcMain.handle('update-check', async () => {
    const s = loadSettings();
    return checkUpdate({ repo: s.updateRepo, currentVersion: app.getVersion() });
  });

  // ---------- Provider 管理 ----------
  ipcMain.handle('providers-list', () => providers.list());
  ipcMain.handle('providers-upsert', (_e, p) => {
    if (typeof p !== 'object' || p === null) return providers.list();
    return providers.upsert({
      id: typeof p.id === 'string' ? p.id : undefined,
      name: p.name,
      baseUrl: p.baseUrl,
      model: p.model,
      visionModel: p.visionModel,
      apiKey: typeof p.apiKey === 'string' ? p.apiKey : undefined,
    });
  });
  ipcMain.handle('providers-remove', (_e, id) => providers.remove(typeof id === 'string' ? id : ''));
  ipcMain.handle('providers-set-active', (_e, id) => providers.setActive(typeof id === 'string' ? id : ''));

  // ---------- 聊天会话 ----------
  ipcMain.handle('chat-list', () => chatStore.list());
  ipcMain.handle('chat-create', (_e, opts) => chatStore.create(typeof opts === 'object' && opts ? opts : {}));
  ipcMain.handle('chat-get', (_e, id) => (typeof id === 'string' ? chatStore.get(id) : null));
  ipcMain.handle('chat-update', (_e, { id, patch }) => {
    if (typeof id !== 'string' || typeof patch !== 'object' || patch === null) return null;
    return chatStore.update(id, patch);
  });
  ipcMain.handle('chat-delete', (_e, id) => chatStore.remove(typeof id === 'string' ? id : ''));
  ipcMain.handle('chat-delete-many', (_e, ids) => {
    if (!Array.isArray(ids)) return false;
    return chatStore.removeMany(ids.filter((x) => typeof x === 'string'));
  });
  ipcMain.handle('chat-clear', (_e, id) => chatStore.clearMessages(typeof id === 'string' ? id : ''));

  ipcMain.handle('chat-send', (_e, { sessionId, content }) => {
    if (typeof sessionId !== 'string' || typeof content !== 'string' || !content.trim()) {
      return { ok: false, error: '参数不完整' };
    }
    const s = chatStore.get(sessionId);
    if (!s) return { ok: false, error: '会话不存在' };
    chatStore.appendMessage(sessionId, { role: 'user', content: content.trim() });
    const fresh = chatStore.get(sessionId);
    const history = fresh.messages.slice(-30).map((m) => ({ role: m.role, content: m.content }));
    const requestId = `r-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    startChatStream({
      requestId,
      sessionId,
      messages: history,
      providerId: fresh.providerId,
      model: fresh.model,
      systemPrompt: fresh.systemPrompt,
    });
    return { ok: true, requestId, session: { ...fresh, messages: fresh.messages.slice(-1) } };
  });
  ipcMain.on('chat-abort', (_e, requestId) => {
    const h = chatStreams.get(requestId);
    if (h) {
      h.abort();
      chatStreams.delete(requestId);
    }
  });

  // ---------- 快速对话气泡（桌宠顶上的迷你输入） ----------
  ipcMain.handle('quick-chat', (_e, { text }) => {
    const t = typeof text === 'string' ? text.trim().slice(0, 1000) : '';
    if (!t) return { ok: false, error: 'empty' };
    const requestId = `q-${Date.now().toString(36)}`;
    const cfg = providers.resolveForCall(null);
    const s = loadSettings();
    if (!cfg.apiKey) {
      sendToPet('quick-chat-delta', { requestId, error: '先去聊天窗配置 Provider 的 API Key 吧～', done: true });
      return { ok: true, requestId };
    }
    const handle = llm.streamChat(
      {
        baseUrl: cfg.baseUrl,
        apiKey: cfg.apiKey,
        model: cfg.model,
        systemPrompt: s.agentSystemPrompt || '你是用户的桌面宠物小猫，用软萌的语气简短回答（60字内），可以带emoji。',
        messages: [{ role: 'user', content: t }],
      },
      (chunk) => {
        sendToPet('quick-chat-delta', { requestId, ...chunk });
      },
    );
    chatStreams.set(requestId, handle);
    return { ok: true, requestId };
  });

  // ---------- 聊天窗控制 ----------
  ipcMain.on('chat-open-window', () => createChatWindow());
  ipcMain.on('chat-close-window', () => {
    if (chatWin && !chatWin.isDestroyed()) chatWin.close();
  });
  ipcMain.handle('chat-set-follow', (_e, on) => {
    const merged = { ...loadSettings(), chatFollow: Boolean(on) };
    saveSettings(merged);
    setChatFollow(Boolean(on));
    return merged.chatFollow;
  });
  ipcMain.handle('chat-window-bounds', (_e, bounds) => {
    if (chatWin && !chatWin.isDestroyed() && typeof bounds === 'object' && bounds !== null) {
      const b = chatWin.getBounds();
      const width = Number(bounds.width) > 200 ? Number(bounds.width) : b.width;
      const height = Number(bounds.height) > 200 ? Number(bounds.height) : b.height;
      chatWin.setBounds({ ...b, width: Math.round(width), height: Math.round(height) });
      return true;
    }
    return false;
  });

  // ---------- 热加载素材 ----------
  ipcMain.handle('characters-list', () => hotAssets.listCharacters(app.getPath('userData')));
  ipcMain.handle('soundpacks-list', () => hotAssets.listSoundPack(app.getPath('userData')));
  ipcMain.on('open-sounds-folder', () => {
    const dir = hotAssets.soundsRoot(app.getPath('userData'));
    fs.mkdirSync(dir, { recursive: true });
    shell.openPath(dir);
  });
  ipcMain.on('open-characters-folder', () => {
    const dir = hotAssets.charactersRoot(app.getPath('userData'));
    fs.mkdirSync(dir, { recursive: true });
    shell.openPath(dir);
  });

  // ---------- 多开碰撞 ----------
  ipcMain.on('collision-velocity', (_e, { x, y }) => {
    if (collisionCtl) collisionCtl.setVelocity(x, y);
  });
  ipcMain.on('spawn-pet', () => spawnPetInstance());

  // ---------- Agent 联动服务 ----------
  const s0 = loadSettings();
  if (s0.agentServer !== false) {
    // PET_PORT 环境变量可改端口（多实例测试用；与已安装版共存时避免抢 27890）
    startAgentLink({
      port: Number(process.env.PET_PORT) || DEFAULT_PORT,
      token: s0.agentToken,
      onEvent: routeAgentEvent,
      onLog: (msg) => console.log(`[agent-link] ${msg}`),
    }).then((server) => {
      agentServer = server;
    });
  }

  // ---------- 主动识屏陪伴 ----------
  stopProactive = screenMod.startProactiveWatcher({
    loadSettings,
    llm,
    resolveProvider: (id) => providers.resolveForCall(id),
    matchesWhitelist: (title, patterns) => screenMatch.matchesWhitelist(title, patterns),
    onCare: (line, fg) => {
      sendToPet('agent-event', { type: 'say', text: line, level: 'normal', meta: { from: 'proactive', app: fg?.process } });
    },
  });

  // ---------- 多开碰撞物理 ----------
  startCollision({
    instanceId: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    instanceName: PET_NAME || 'main',
    getBounds: () => (win && !win.isDestroyed() ? win.getBounds() : null),
    setWindowBounds: (x, y) => {
      if (win && !win.isDestroyed()) win.setPosition(x, y);
    },
    onHit: ({ impulseX, impulseY, peerName }) => {
      sendToPet('collision-hit', { impulseX, impulseY, peerName });
    },
  })
    .then((ctl) => {
      collisionCtl = ctl;
    })
    .catch(() => {
      collisionCtl = null; // 端口耗尽（>6 只猫）或共享模块加载失败时放弃碰撞
    });

  startFullscreenWatcher();

  // 热加载素材变化 → 通知渲染层刷新角色/音效
  hotAssets.watchHotAssets(app.getPath('userData'), () => {
    sendToPet('hot-assets-changed', { at: Date.now() });
  });
}

app.on('before-quit', () => {
  persistBounds(); // 退出前保存窗口位置
  if (agentServer) agentServer.close();
  if (stopProactive) stopProactive();
  if (collisionCtl) collisionCtl.stop();
  for (const h of chatStreams.values()) {
    try {
      h.abort();
    } catch {
      /* 已中止 */
    }
  }
  chatStreams.clear();
});

app.on('window-all-closed', () => {
  // 宠物常驻托盘，不退出
});
