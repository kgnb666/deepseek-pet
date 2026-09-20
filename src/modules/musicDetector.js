/**
 * 音乐检测自动唱歌（对标 dsh-pet「后台音乐检测自动唱歌」）：
 * 通过系统声音 loopback（Windows）拿音频流，音量持续超阈值判定为在放歌，
 * 此时桌宠跟着摇摆 + 冒 ♪ 歌词气泡。默认关闭，设置里开启。
 */
import { state } from './state.js';
import { showBubble } from './bubble.js';
import { setPose } from './pet.js';
import { renderFeedingStats } from './easterEgg.js';

const LOUD_MS = 4000; // 持续多久算在放歌
const SILENCE_MS = 6000; // 安静多久停止唱歌
const COOLDOWN_MS = 5 * 60 * 1000; // 两次唱歌最小间隔
const RMS_ON = 0.045;
const RMS_OFF = 0.012;

const LYRICS = [
  '🎵 啦啦啦～跟着节奏摇摆',
  '🎶 这首歌真好听！',
  '🎵 主人听的什么歌呀～',
  '🎶 摇摆摇摆～摆起来！',
  '🎵 唱歌的小鲸鱼最可爱 🐳',
  '🎶 完全停不下来！',
];

let running = false;
let audioCtx = null;
let raf = null;
let loudSince = 0;
let quietSince = 0;
let singing = false;
let lastSingEnd = 0;
let lyricTimer = null;

function startSinging() {
  singing = true;
  loudSince = Date.now();
  quietSince = 0;
  setPose('char_happy');
  const wrap = document.getElementById('pet-wrap');
  if (wrap) wrap.classList.add('sing');
  const n = parseInt(localStorage.getItem('singCount') || '0', 10) + 1;
  localStorage.setItem('singCount', String(n));
  renderFeedingStats();
  showBubble('检测到音乐！<br>一起唱起来～🎶', 'success', 4000);
  lyricTimer = setInterval(() => {
    if (!singing) return;
    showBubble(LYRICS[Math.floor(Math.random() * LYRICS.length)], 'normal', 3500);
  }, 4500);
}

function stopSinging() {
  singing = false;
  clearInterval(lyricTimer);
  lyricTimer = null;
  lastSingEnd = Date.now();
  const wrap = document.getElementById('pet-wrap');
  if (wrap) wrap.classList.remove('sing');
  setPose(state.settings.skin || 'char_main');
}

async function startDetection() {
  if (running) return;
  running = true;
  try {
    // loopback 音频（Windows）：请求屏幕捕获权限，拿到系统声音
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    });
    stream.getVideoTracks().forEach((t) => t.stop()); // 只要声音
    const audioTracks = stream.getAudioTracks();
    if (audioTracks.length === 0) {
      running = false;
      return; // 非 Windows / 无 loopback：静默放弃
    }
    audioCtx = new AudioContext();
    const src = audioCtx.createMediaStreamSource(new MediaStream(audioTracks));
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 512;
    src.connect(analyser);
    const buf = new Float32Array(analyser.fftSize);

    const tick = () => {
      if (!running) return;
      analyser.getFloatTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
      const rms = Math.sqrt(sum / buf.length);

      if (!singing) {
        if (rms > RMS_ON) {
          if (!loudSince) loudSince = Date.now();
          if (Date.now() - loudSince > LOUD_MS && Date.now() - lastSingEnd > COOLDOWN_MS) startSinging();
        } else {
          loudSince = 0;
        }
      } else if (rms < RMS_OFF) {
        if (!quietSince) quietSince = Date.now();
        if (Date.now() - quietSince > SILENCE_MS) stopSinging();
      } else {
        quietSince = 0;
      }
      raf = requestAnimationFrame(tick);
    };
    tick();

    // 音轨结束（音乐停了）自动清理
    audioTracks[0].addEventListener('ended', () => {
      stopSinging();
      stop();
    });
  } catch {
    running = false; // 用户拒绝授权或环境不支持：静默关闭
  }
}

function stop() {
  running = false;
  stopSinging();
  if (raf) cancelAnimationFrame(raf);
  raf = null;
  if (audioCtx) {
    audioCtx.close().catch(() => {});
    audioCtx = null;
  }
}

/** 按设置启停；设置变更时调用 */
export function syncMusicSing() {
  if (state.settings.musicSing && state.windowVisible && !running) startDetection();
  else if ((!state.settings.musicSing || !state.windowVisible) && running) stop();
}

export function initMusicDetector() {
  if (window.pet?.on) {
    window.pet.on('win-visibility', (visible) => {
      state.windowVisible = Boolean(visible);
      syncMusicSing();
    });
  }
  if (state.settings.musicSing) setTimeout(startDetection, 4000);
}
