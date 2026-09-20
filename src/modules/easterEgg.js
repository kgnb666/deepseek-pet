/**
 * 彩蛋 + 投喂统计：
 * - 连续快速点击宠物 9 次（超过眩晕阈值）触发「欧鲸鲸」彩蛋：鲸鱼雨 + 专属台词；
 * - 投喂 / 彩蛋次数持久化，在统计页展示（模拟「吃垃圾文件」的趣味计数）。
 */
import { $, state } from './state.js';
import { showBubble } from './bubble.js';
import { playCelebrate } from './sound.js';

const EGG_CLICKS = 9;
const EGG_WINDOW_MS = 3000;
const EGG_COOLDOWN_MS = 60 * 1000;

const EGG_LINES = [
  '🐳🐳🐳 欧鲸鲸降临！<br>今日运势：<b>大吉</b>，写啥都没 bug！',
  '鲸鱼王出现了！<br>主人今天会被幸运砸中 ✨',
  '欧鲸鲸显灵～<br>余额翻倍（bushi），好运翻倍！💥',
];

let clicks = 0;
let windowStart = 0;
let lastEggAt = 0;

function spawnWhales(n = 12) {
  const zone = $('pet-zone');
  for (let i = 0; i < n; i++) {
    const w = document.createElement('span');
    w.className = 'whale-rain';
    w.textContent = Math.random() < 0.7 ? '🐳' : '💙';
    w.style.left = `${30 + Math.random() * 240}px`;
    w.style.animationDelay = `${i * 0.12}s`;
    w.style.fontSize = `${16 + Math.random() * 18}px`;
    zone.appendChild(w);
    setTimeout(() => w.remove(), 3200);
  }
}

/** 投喂统计（pet.js feedPet 调用） */
export function recordFeed() {
  const n = parseInt(localStorage.getItem('feedCount') || '0', 10) + 1;
  localStorage.setItem('feedCount', String(n));
  renderFeedingStats();
}

export function renderFeedingStats() {
  const el = $('stat-feeding');
  if (!el) return;
  const feed = parseInt(localStorage.getItem('feedCount') || '0', 10);
  const egg = parseInt(localStorage.getItem('eggCount') || '0', 10);
  const sings = parseInt(localStorage.getItem('singCount') || '0', 10);
  el.textContent = `🐟 ${feed} 次 ｜ 🎁 彩蛋 ${egg} 次 ｜ 🎵 陪唱 ${sings} 次`;
}

function triggerEgg() {
  const now = Date.now();
  if (now - lastEggAt < EGG_COOLDOWN_MS) return;
  lastEggAt = now;
  const n = parseInt(localStorage.getItem('eggCount') || '0', 10) + 1;
  localStorage.setItem('eggCount', String(n));
  playCelebrate();
  spawnWhales();
  showBubble(EGG_LINES[Math.floor(Math.random() * EGG_LINES.length)], 'success', 7000);
  renderFeedingStats();
}

export function initEasterEgg() {
  $('pet-zone')?.addEventListener('pointerdown', () => {
    const now = Date.now();
    if (now - windowStart > EGG_WINDOW_MS) {
      clicks = 0;
      windowStart = now;
    }
    clicks += 1;
    if (clicks >= EGG_CLICKS) {
      clicks = 0;
      triggerEgg();
    }
  });
  renderFeedingStats();
  void state;
}
