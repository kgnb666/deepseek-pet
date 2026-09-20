/**
 * 音效模块：Web Audio API 实时合成轻快提示音（无外部文件依赖），
 * 支持自定义音效包热覆盖：userData/sounds/<event>.mp3|wav|ogg|flac
 * （对标 dsh-pet 自定义点击音效包，经 res:// 协议加载）。
 */
import { state } from './state.js';
import { api } from './api.js';

let ctx = null;
let soundPack = {}; // event → res:// URL

/** 拉取音效包（启动与 hot-assets-changed 时调用） */
export async function reloadSoundPack() {
  try {
    soundPack = (await api.soundpacksList()) || {};
  } catch {
    soundPack = {};
  }
}

function playPacked(event) {
  const url = soundPack[event];
  if (!url) return false;
  try {
    const audio = new Audio(url);
    audio.volume = 0.9;
    audio.play().catch(() => {});
    return true;
  } catch {
    return false;
  }
}

function getCtx() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

function tone(ac, { freq, type = 'sine', delay = 0, dur = 0.15, vol = 0.08, slideTo }) {
  const t0 = ac.currentTime + delay;
  const osc = ac.createOscillator();
  const g = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(1, slideTo), t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(vol, t0 + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g);
  g.connect(ac.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.05);
}

/** 统一入口：优先播自定义音效包，缺省回退合成音 */
function synth(event, fn) {
  if (state.settings.soundEnabled === false) return;
  if (event && playPacked(event)) return;
  const ac = getCtx();
  if (!ac) return;
  fn(ac);
}

/** 点击互动：一声软"啵" + 上扬双音"叮"，带轻微随机音高避免单调 */
export function playInteract() {
  synth('click', (ac) => {
    const r = 0.94 + Math.random() * 0.12;
    tone(ac, { freq: 540 * r, type: 'triangle', dur: 0.09, vol: 0.13, slideTo: 680 * r });
    tone(ac, { freq: 1180 * r, type: 'sine', delay: 0.06, dur: 0.2, vol: 0.09 });
    tone(ac, { freq: 1760 * r, type: 'sine', delay: 0.06, dur: 0.12, vol: 0.04 });
  });
}

/** 摸头：更高更亮 */
export function playPatHead() {
  synth('pat-head', (ac) => {
    const r = 0.96 + Math.random() * 0.08;
    tone(ac, { freq: 720 * r, type: 'triangle', dur: 0.08, vol: 0.12, slideTo: 980 * r });
    tone(ac, { freq: 1480 * r, type: 'sine', delay: 0.05, dur: 0.16, vol: 0.07 });
  });
}

/** 摸肚子：中音软噗 */
export function playPatBelly() {
  synth('pat-belly', (ac) => {
    tone(ac, { freq: 320, type: 'sine', dur: 0.14, vol: 0.12, slideTo: 240 });
    tone(ac, { freq: 640, type: 'triangle', delay: 0.04, dur: 0.1, vol: 0.06 });
  });
}

/** 拉尾巴：低音滑落 */
export function playPatTail() {
  synth('pat-tail', (ac) => {
    tone(ac, { freq: 420, type: 'square', dur: 0.08, vol: 0.05, slideTo: 260 });
    tone(ac, { freq: 180, type: 'sine', delay: 0.05, dur: 0.16, vol: 0.08 });
  });
}

/** 双击摸头：三连叮 */
export function playDoublePat() {
  synth(null, (ac) => {
    [880, 1100, 1320].forEach((f, i) => {
      tone(ac, { freq: f, type: 'sine', delay: i * 0.07, dur: 0.14, vol: 0.09 });
    });
  });
}

/** 连点眩晕：快速上行音阶 */
export function playCombo() {
  synth(null, (ac) => {
    [523, 659, 784, 1046].forEach((f, i) => {
      tone(ac, { freq: f, type: 'triangle', delay: i * 0.06, dur: 0.12, vol: 0.1 });
    });
  });
}

/** 投喂：咀嚼感短音 */
export function playFeed() {
  synth('feed', (ac) => {
    tone(ac, { freq: 180, type: 'square', dur: 0.07, vol: 0.06 });
    tone(ac, { freq: 240, type: 'square', delay: 0.09, dur: 0.07, vol: 0.05 });
    tone(ac, { freq: 880, type: 'sine', delay: 0.2, dur: 0.18, vol: 0.07 });
  });
}

/** 换肤：亮晶晶琶音 */
export function playSkin() {
  synth(null, (ac) => {
    [659, 784, 988, 1318].forEach((f, i) => {
      tone(ac, { freq: f, type: 'sine', delay: i * 0.05, dur: 0.16, vol: 0.07 });
    });
  });
}

/** 起床：上扬 */
export function playWake() {
  synth(null, (ac) => {
    tone(ac, { freq: 392, type: 'triangle', dur: 0.16, vol: 0.1, slideTo: 784 });
    tone(ac, { freq: 1174, type: 'sine', delay: 0.14, dur: 0.2, vol: 0.06 });
  });
}

/** 休眠：下行摇篮 */
export function playSleep() {
  synth(null, (ac) => {
    tone(ac, { freq: 523, type: 'sine', dur: 0.22, vol: 0.07, slideTo: 392 });
    tone(ac, { freq: 392, type: 'sine', delay: 0.18, dur: 0.28, vol: 0.05, slideTo: 262 });
  });
}

/** 警告 / 余额骤降：低沉嗡鸣 */
export function playWarn() {
  synth('warn', (ac) => {
    tone(ac, { freq: 220, type: 'sawtooth', dur: 0.18, vol: 0.06, slideTo: 140 });
    tone(ac, { freq: 160, type: 'square', delay: 0.12, dur: 0.16, vol: 0.04 });
  });
}

/** 低价开始 / 庆祝：大调琶音 */
export function playCelebrate() {
  synth('celebrate', (ac) => {
    [523, 659, 784, 1046, 1318].forEach((f, i) => {
      tone(ac, { freq: f, type: 'sine', delay: i * 0.07, dur: 0.2, vol: 0.08 });
    });
  });
}

/** 按下即时反馈：极短的软"噗"（对标 dsh-pet：按下即有声，确认点击后才播完整音） */
export function playPress() {
  synth('press', (ac) => {
    const r = 0.94 + Math.random() * 0.12;
    tone(ac, { freq: 300 * r, type: 'sine', dur: 0.06, vol: 0.09, slideTo: 210 * r });
  });
}

/** 抓起拖拽：快速上扬"咦" */
export function playGrab() {
  synth('grab', (ac) => {
    tone(ac, { freq: 380, type: 'triangle', dur: 0.1, vol: 0.1, slideTo: 620 });
    tone(ac, { freq: 920, type: 'sine', delay: 0.07, dur: 0.12, vol: 0.05 });
  });
}

/** 转身：短促气垫"咻" */
export function playTurn() {
  synth(null, (ac) => {
    const r = 0.95 + Math.random() * 0.1;
    tone(ac, { freq: 500 * r, type: 'triangle', dur: 0.07, vol: 0.07, slideTo: 900 * r });
  });
}

/** 弹弓发射：强力上行 + 尾音（tier 0-3 力度档，音高随档位上扬） */
export function playLaunch(tier = 2) {
  const p = 1 + tier * 0.12;
  synth('launch', (ac) => {
    tone(ac, { freq: 240 * p, type: 'sawtooth', dur: 0.16, vol: 0.08, slideTo: 900 * p });
    tone(ac, { freq: 1320 * p, type: 'sine', delay: 0.12, dur: 0.22, vol: 0.07 });
    tone(ac, { freq: 1760 * p, type: 'sine', delay: 0.16, dur: 0.14, vol: 0.04 });
  });
}

/** 碰撞"咚"（多开碰碰车） */
export function playBonk() {
  synth('bonk', (ac) => {
    tone(ac, { freq: 170, type: 'square', dur: 0.1, vol: 0.11, slideTo: 85 });
    tone(ac, { freq: 420, type: 'triangle', delay: 0.05, dur: 0.08, vol: 0.05 });
  });
}

/** Agent 联动事件音（走音效包 'agent'，缺省轻"叮"） */
export function playAgentEvent() {
  synth('agent', (ac) => {
    tone(ac, { freq: 980, type: 'sine', dur: 0.09, vol: 0.06, slideTo: 1240 });
  });
}

/** 开关切换：短促"嗒" */
export function playToggle() {
  synth('toggle', (ac) => {
    tone(ac, { freq: 760, type: 'triangle', dur: 0.06, vol: 0.08, slideTo: 980 });
  });
}
