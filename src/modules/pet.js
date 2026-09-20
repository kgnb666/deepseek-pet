/**
 * 宠物状态机与动画：姿势、心情、好感度、分部位点击、投喂、空闲行为
 */
import { $, state } from './state.js';
import { showBubble, hideBubble, replayBubbles } from './bubble.js';
import { api } from './api.js';
import {
  playPatHead,
  playPatBelly,
  playPatTail,
  playDoublePat,
  playCombo,
  playFeed,
  playCelebrate,
  playWarn,
  playSleep,
  playWake,
  playPress,
} from './sound.js';
import { cancelWander } from './wander.js';
import { recordFeed } from './easterEgg.js';
import { resolvePose, isExternalSkin, reloadCharacters, onCharactersChanged, getCharacters } from './characters.js';
import { buildRigLayers } from './rig.js';

const IDLE_DELAY = 60 * 1000;
const BORED_DELAY = 90 * 1000;
const SULK_DELAY = 180 * 1000;
const BLINK_MIN = 3000;
const BLINK_MAX = 6000;
const IDLE_CHECK_INTERVAL = 5000;
const INACTIVE_DELAY = 30 * 1000; // 30s 无交互降帧省电（对标 dsh-pet 闲置降帧）
const DBL_MS = 280;
const COMBO_WINDOW = 1000;
const COMBO_NEED = 5;
const MILESTONES = [
  { n: 10, line: '好感度 10！小鲸鱼记住主人了 🐳' },
  { n: 30, line: '好感度 30～摸头许可已发放 💙' },
  { n: 50, line: '好感度 50！今天也要一起写代码哦' },
  { n: 100, line: '好感度 100！！你是我最重要的人 💗' },
  { n: 200, line: '好感度 200…一辈子都陪着主人 ✨' },
];

const BORED_LINES = ['有点无聊呢…陪我玩一会儿嘛～', '主人是不是把我忘了？哼', '戳戳我嘛，我又不会咬人 🐳'];
const SULK_LINES = ['哼，才不要理你呢…', '转过去就不给你看脸！', '再不理我真的要睡觉了'];
const HEAD_LINES = ['摸头杀是犯规的！💙', '头发乱了啦…不过可以再摸一下', '嘿嘿，再摸摸～'];
const BELLY_LINES = ['肚子软软的对吧～', '小鲸鱼说好痒 🐳', '再戳要痒死啦！'];
const TAIL_LINES = ['尾巴不是拉环哦！', '小鲸鱼：请轻拿轻放 🐳', '哎！尾巴被抓住了～'];
const DIZZY_LINES = ['头晕晕的…转圈圈 💫', '停一下停一下！我要飞起来了', '哇啊——天旋地转～'];
const DBL_LINES = ['双击摸头！开心加倍 💗', '这么热情，我都害羞了～', '摸摸摸摸——好幸福！'];
const FEED_LINES = ['小鱼干！谢谢主人 🐟', '嚼嚼嚼…好吃！', '再来一条嘛～就一条'];
const TSUNDERE_CLICK = ['哼，才不是因为想你才转过来的…', '才、才没有想你呢！', '…好吧，原谅你了'];

export const INTERACTIONS = [
  '主人，摸摸头～💙',
  '今天也要加油写代码哦！',
  '低价时段跑任务最划算啦～',
  '小鲸鱼说它想你了 🐳',
  '记得多喝水，休息一下眼睛～',
];

let lastActivity = Date.now();
let clickTimer = null;
let pendingClicks = 0;
let combo = 0;
let comboTimer = null;
let busyUntil = 0;

function wrapEl() {
  return $('pet-wrap');
}

function busy() {
  return Date.now() < busyUntil;
}

function setBusy(ms) {
  busyUntil = Date.now() + ms;
}

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function isNight() {
  const h = new Date().getHours();
  return h >= 23 || h < 6;
}

/**
 * FSM 感知门控：眨眼/心情等低优先级视觉只有在基础态（IDLE/WALK）才允许改姿势，
 * 避免覆盖功能态/系统态（CODING/ALERT…）的立绘。FSM 未就绪时保持旧行为。
 */
function fsmVisualGate() {
  const brain = window.petFSM;
  if (!brain) return true;
  return brain.tier === 0 && (brain.state === 'IDLE' || brain.state === 'WALK');
}

function playAnim(cls, ms) {
  const w = wrapEl();
  if (!w) return;
  w.classList.remove(cls);
  void w.offsetWidth;
  w.classList.add(cls);
  setTimeout(() => w.classList.remove(cls), ms);
}

// ---------- 朝向 ----------
// 对标 dsh-pet 的 turn 状态：默认朝右，拖拽/游走/转身时翻转。
// --flip 挂在 #pet-wrap 上，立绘 bob 与 rig 图层共同继承。
export function setFacing(dir) {
  state.facing = dir === 'left' ? 'left' : 'right';
  const w = wrapEl();
  if (w) w.style.setProperty('--flip', state.facing === 'left' ? '-1' : '1');
}

export function getFacing() {
  return state.facing || 'right';
}

// ---------- 姿势 ----------
function spriteUrl(name) {
  return `assets/${name}.webp`;
}

function applyCharScale(skin) {
  const w = wrapEl();
  if (!w) return;
  if (!isExternalSkin(skin)) {
    w.style.removeProperty('--char-scale');
    return;
  }
  const id = skin.slice(4);
  const char = getCharacters().find((c) => c.id === id);
  if (char && char.scale !== 1) w.style.setProperty('--char-scale', String(char.scale));
  else w.style.removeProperty('--char-scale');
}

/**
 * 切换姿势。内置皮肤走 assets/ 静态图 + CSS 动画；
 * 外部角色（ext:<id>）解析 character.json，webm/mp4 透明视频用 <video> 播放。
 */
export function setPose(name, ms = 0) {
  const img = $('pet');
  const video = $('pet-video');
  if (!img) return;
  const skin = state.settings.skin || 'char_main';
  img.dataset.pose = name;
  const resolved = resolvePose(skin, name);
  applyCharScale(skin);
  if (resolved) {
    if (resolved.video) {
      img.classList.add('hidden');
      if (video) {
        video.classList.remove('hidden');
        if (video.getAttribute('src') !== resolved.url) {
          video.src = resolved.url;
          video.play().catch(() => {});
        }
      }
    } else {
      img.classList.remove('hidden');
      img.src = resolved.url;
      if (video) {
        video.pause();
        video.classList.add('hidden');
      }
    }
  } else {
    img.classList.remove('hidden');
    img.src = spriteUrl(name);
    if (video) {
      video.pause();
      video.classList.add('hidden');
    }
  }
  if (ms > 0) {
    setTimeout(() => {
      setPose(skin);
    }, ms);
  }
  void syncRigLayers(name === skin ? skin : null);
}

// ---------- 自动骨骼 rig（呆毛/鲸鱼/尾巴独立图层） ----------
const rigCache = new Map(); // spriteUrl → rig 规格
let rigDom = [];
let rigBuiltFor = null;

function mountRig(spec) {
  rigDom.forEach((el) => el.remove());
  rigDom = [];
  if (!spec) return;
  const wrap = wrapEl();
  if (!wrap) return;
  for (const l of spec.layers) {
    const img = document.createElement('img');
    img.src = l.dataUrl;
    img.className = `pet-layer pet-layer-${l.key}`;
    img.draggable = false;
    img.alt = '';
    img.style.setProperty('--dx', `${l.dx.toFixed(1)}px`);
    img.style.bottom = `${l.bottom.toFixed(1)}px`;
    img.style.width = `${l.width.toFixed(1)}px`;
    wrap.appendChild(img);
    rigDom.push(img);
  }
}

/** 皮肤立绘变化时重建 rig；非皮肤姿势时隐藏图层（部件属于特定立绘） */
export async function syncRigLayers(skinPoseName) {
  const skin = state.settings.skin || 'char_main';
  if (!skinPoseName || isExternalSkin(skin)) {
    rigDom.forEach((el) => (el.style.display = 'none'));
    return;
  }
  const url = spriteUrl(skin);
  if (rigBuiltFor !== url) {
    rigBuiltFor = url;
    let spec = rigCache.get(url);
    if (!spec) {
      spec = await buildRigLayers(url);
      if (spec) rigCache.set(url, spec);
    }
    mountRig(spec);
  }
  rigDom.forEach((el) => (el.style.display = ''));
}

/** 互动冲量：呆毛弹一下（按下/撞墙时调用） */
export function joltRig() {
  const el = document.querySelector('.pet-layer-ahoge');
  if (!el) return;
  el.classList.remove('jolt');
  void el.offsetWidth;
  el.classList.add('jolt');
  setTimeout(() => el.classList.remove('jolt'), 1100);
}

export function initPetSprite() {
  const img = $('pet');
  img.addEventListener('error', () => {
    // 仅对内置素材做 webp→png 兜底（外部 res:// 素材失败直接回主姿势）
    const name = img.dataset.pose || state.settings.skin || 'char_main';
    if (img.src.includes('app://') && !img.src.endsWith('.png')) {
      img.src = `assets/${name}.png`;
    } else {
      setPose(state.settings.skin || 'char_main');
    }
  });
  const avatar = $('mini-avatar');
  avatar.onerror = () => {
    if (!avatar.src.endsWith('.png')) avatar.src = 'assets/avatar.png';
  };
  avatar.src = 'assets/avatar.webp';
  setPose(state.settings.skin || 'char_main');

  // 外部角色热加载：文件变化后按当前皮肤重放姿势
  reloadCharacters();
  onCharactersChanged(() => {
    setPose(state.settings.skin || 'char_main');
  });
}

// ---------- 粒子 ----------
export function spawnHearts(n = 5) {
  const zone = $('pet-zone');
  const emojis = ['💙', '💗', '✨', '💙'];
  for (let i = 0; i < n; i++) {
    const h = document.createElement('span');
    h.className = 'heart';
    h.textContent = emojis[i % emojis.length];
    h.style.left = `${90 + Math.random() * 120}px`;
    h.style.bottom = `${170 + Math.random() * 80}px`;
    h.style.animationDelay = `${i * 0.1}s`;
    zone.appendChild(h);
    setTimeout(() => h.remove(), 2000);
  }
}

export function spawnSparkles(n = 6) {
  const zone = $('pet-zone');
  const emojis = ['✨', '⭐', '🌟', '💫'];
  for (let i = 0; i < n; i++) {
    const s = document.createElement('span');
    s.className = 'sparkle';
    s.textContent = emojis[i % emojis.length];
    s.style.left = `${70 + Math.random() * 160}px`;
    s.style.bottom = `${150 + Math.random() * 100}px`;
    s.style.animationDelay = `${i * 0.07}s`;
    zone.appendChild(s);
    setTimeout(() => s.remove(), 1600);
  }
}

function spawnFood() {
  const zone = $('pet-zone');
  const f = document.createElement('span');
  f.className = 'food';
  f.textContent = pick(['🐟', '🐠', '🍤']);
  f.style.left = `${120 + Math.random() * 60}px`;
  f.style.bottom = '220px';
  zone.appendChild(f);
  setTimeout(() => f.remove(), 900);
}

function spawnCelebrateBits() {
  const zone = $('pet-zone');
  const emojis = ['🎉', '💰', '✨', '🎊', '💙'];
  for (let i = 0; i < 8; i++) {
    const s = document.createElement('span');
    s.className = 'sparkle';
    s.textContent = emojis[i % emojis.length];
    s.style.left = `${50 + Math.random() * 200}px`;
    s.style.bottom = `${140 + Math.random() * 120}px`;
    s.style.animationDelay = `${i * 0.05}s`;
    zone.appendChild(s);
    setTimeout(() => s.remove(), 1800);
  }
}

// ---------- 好感度 ----------
function renderAffection() {
  const el = $('stat-affection');
  if (el) el.textContent = String(state.affection);
}

function addAffection(n) {
  state.affection += n;
  localStorage.setItem('affection', String(state.affection));
  renderAffection();
  const hit = MILESTONES.find((m) => state.affection >= m.n && state.lastMilestone < m.n);
  if (hit) {
    state.lastMilestone = hit.n;
    localStorage.setItem('lastMilestone', String(hit.n));
    spawnSparkles(8);
    spawnHearts(6);
    playCelebrate();
    showBubble(hit.line, 'success', 5000);
  }
}

// ---------- 心情 ----------
function setMood(mood, { announce = true } = {}) {
  if (state.mood === mood) return;
  state.mood = mood;
  const w = wrapEl();
  if (w) w.classList.toggle('sulk', mood === 'tsundere');
  if (!announce || state.animationsPaused) return;
  if (mood === 'tsundere') {
    if (fsmVisualGate()) setPose('char_sleep');
    showBubble(pick(SULK_LINES), 'normal', 4000);
  } else if (mood === 'bored') {
    showBubble(pick(BORED_LINES), 'normal', 3500);
  } else if (mood === 'sleepy') {
    if (fsmVisualGate()) setPose('char_sleep');
    playSleep();
  } else if (w) {
    w.classList.remove('sulk');
  }
}

/** Agent 联动可设置心情（无台词播报，避免打断气泡队列） */
export function setMoodPublic(mood) {
  if (!['happy', 'bored', 'sleepy', 'tsundere'].includes(mood)) return;
  setMood(mood, { announce: false });
}

function sootheIfSulking() {
  if (state.mood !== 'tsundere') return false;
  setMood('happy', { announce: false });
  wrapEl()?.classList.remove('sulk');
  setPose('char_shy', 3000);
  playWake();
  showBubble(pick(TSUNDERE_CLICK), 'success', 4000);
  addAffection(2);
  return true;
}

// ---------- 分部位 ----------
function hitPart(e) {
  const img = $('pet');
  if (!e || !img) return 'body';
  const r = img.getBoundingClientRect();
  if (!r.height) return 'body';
  const y = (e.clientY - r.top) / r.height;
  const x = (e.clientX - r.left) / r.width;
  if (y < 0.38) return 'head';
  if (y > 0.72 || (x > 0.68 && y > 0.48)) return 'tail';
  return 'belly';
}

function reactPart(part) {
  const pet = $('pet');
  pet.classList.remove('pat');
  void pet.offsetWidth;
  pet.classList.add('pat');
  if (part === 'head') {
    playPatHead();
    spawnHearts(5);
    addAffection(2);
    setPose('char_happy', 2500);
    showBubble(pick(HEAD_LINES), 'success', 3200);
  } else if (part === 'tail') {
    playPatTail();
    spawnSparkles(4);
    addAffection(1);
    playAnim('wiggle', 500);
    showBubble(pick(TAIL_LINES), 'normal', 3200);
  } else {
    playPatBelly();
    spawnHearts(3);
    addAffection(1);
    setPose('char_happy', 2200);
    showBubble(pick(BELLY_LINES), 'success', 3200);
  }
}

function triggerDizzy() {
  combo = 0;
  setBusy(1600);
  playCombo();
  playAnim('dizzy', 1400);
  spawnSparkles(8);
  spawnHearts(4);
  addAffection(5);
  setPose('char_happy', 2500);
  showBubble(pick(DIZZY_LINES), 'success', 4000);
}

function handleDoubleClick() {
  if (sootheIfSulking()) return;
  setBusy(800);
  playDoublePat();
  playAnim('bounce', 500);
  spawnHearts(8);
  spawnSparkles(6);
  addAffection(3);
  setPose('char_shy', 3000);
  showBubble(pick(DBL_LINES), 'success', 3500);
}

function handleSingleClick(e) {
  if (sootheIfSulking()) return;
  reactPart(hitPart(e));
}

function bumpCombo() {
  combo += 1;
  clearTimeout(comboTimer);
  comboTimer = setTimeout(() => {
    combo = 0;
  }, COMBO_WINDOW);
  return combo;
}

/**
 * 按下即时反馈（对标 dsh-pet：按下即播 press 音 + Q 弹压扁，
 * 之后区分出「确认点击」或「拖拽」再播对应完整反馈）。
 */
export function petOnPress() {
  markActivity();
  if (state.animationsPaused || document.body.classList.contains('mini')) return;
  playPress();
  joltRig();
  const p = $('pet');
  p.classList.remove('squish');
  void p.offsetWidth;
  p.classList.add('squish');
  setTimeout(() => p.classList.remove('squish'), 260);
}

/** 点击宠物：分部位 / 双击加倍 / 连点眩晕 */
export function petOnClick(e) {
  markActivity();
  if (state.animationsPaused || document.body.classList.contains('mini')) return;
  if (busy()) return;

  if (bumpCombo() >= COMBO_NEED) {
    pendingClicks = 0;
    clearTimeout(clickTimer);
    triggerDizzy();
    return;
  }

  pendingClicks += 1;
  clearTimeout(clickTimer);
  // 连点进行中（≥3）不再当成双击，避免和眩晕抢事件
  if (pendingClicks >= 2 && combo < 3) {
    pendingClicks = 0;
    handleDoubleClick();
    return;
  }
  clickTimer = setTimeout(() => {
    pendingClicks = 0;
    handleSingleClick(e);
  }, DBL_MS);
}

export function feedPet() {
  markActivity();
  if (state.animationsPaused) return;
  sootheIfSulking();
  setBusy(900);
  spawnFood();
  playFeed();
  recordFeed();
  playAnim('eat', 800);
  spawnHearts(4);
  addAffection(8);
  setPose('char_happy', 2800);
  showBubble(pick(FEED_LINES), 'success', 3500);
}

export function petOnDragEnd() {
  playAnim('bounce', 480);
  // 拖拽/抛掷期间切过 char_surprise，落地后回到皮肤姿势
  setPose(state.settings.skin || 'char_main');
}

export function petOnBounce() {
  playAnim('shake', 280);
  joltRig();
  setPose('char_surprise', 900);
}

export function reactBalanceDrop(diff = 0, total = 0) {
  playWarn();
  playAnim('shake', 550);
  const big = Math.abs(diff) >= (state.settings.balanceChangeThreshold || 1) * 3;
  setPose(big ? 'char_angry' : 'char_surprise', 4000);
  if (big) spawnSparkles(5);
  void total;
}

export function reactBalanceGain() {
  playCelebrate();
  spawnHearts(6);
  spawnSparkles(4);
  setPose('char_happy', 3500);
}

export function reactLowBalance() {
  playWarn(); // 姿势/摇晃由 FSM 的 ALERT 态负责
}

export function reactRichBalance() {
  playCelebrate();
  spawnCelebrateBits();
  setPose('char_happy', 3200);
}

export function reactOffpeakStart() {
  playCelebrate();
  playAnim('bounce', 500);
  spawnCelebrateBits();
  spawnHearts(5);
  setPose('char_sign', 5000); // 举「低价！」牌（由 char_main 派生的素材）
}

// ---------- 空闲与活动 ----------
// 待机行为循环（REST/ROLL/WALK…）由 FSM（fsm/index.js PetBrain）驱动；
// 本模块只负责心情、好感度与互动反馈。
export function markActivity() {
  lastActivity = Date.now();
  document.body.classList.remove('inactive');
  cancelWander(); // 任意交互立即打断游走（dsh-pet：交互打断 idle 链）
  if (state.mood !== 'happy') setMood('happy', { announce: false });
  wrapEl()?.classList.remove('sulk');
}

// ---------- 特效（供 FSM PetBrain 驱动） ----------

/** 摇晃（ALERT/REFUSE 态） */
export function petShake() {
  if (state.animationsPaused) return;
  const w = wrapEl();
  if (!w) return;
  w.classList.remove('shake');
  void w.offsetWidth;
  w.classList.add('shake');
  setTimeout(() => w.classList.remove('shake'), 580);
}

function blinkLoop() {
  setTimeout(() => {
    const taskBusy = state.task && (state.task.status === 'thinking' || state.task.status === 'working');
    if (!state.animationsPaused && !document.body.classList.contains('mini') && !busy() && !taskBusy && fsmVisualGate()) {
      const p = $('pet');
      p.classList.remove('blink');
      void p.offsetWidth;
      p.classList.add('blink');
      setPose('char_blink', 220);
    }
    blinkLoop();
  }, BLINK_MIN + Math.random() * (BLINK_MAX - BLINK_MIN));
}

export function setAnimationsPaused(on, persist = true) {
  state.animationsPaused = on;
  document.body.classList.toggle('animations-paused', on);
  if (on) {
    hideBubble();
    const hud = $('task-hud');
    if (hud) {
      hud.classList.remove('show', 'out');
      hud.classList.add('hidden');
    }
  } else {
    markActivity();
    playWake();
    replayBubbles();
  }
  if (persist) api.saveSettings({ animationsPaused: on });
}

function initGaze() {
  const w = wrapEl();
  if (!w) return;
  w.addEventListener('pointerenter', () => {
    if (!state.animationsPaused && state.mood !== 'tsundere') w.classList.add('hover');
  });
  w.addEventListener('pointerleave', () => {
    w.classList.remove('hover');
    w.style.setProperty('--gaze', '0deg');
  });
  document.addEventListener('pointermove', (e) => {
    if (state.animationsPaused || document.body.classList.contains('mini')) return;
    if (w.classList.contains('dizzy') || w.classList.contains('sulk') || busy()) return;
    const r = w.getBoundingClientRect();
    const dx = e.clientX - (r.left + r.width / 2);
    const rot = Math.max(-8, Math.min(8, dx / 38));
    w.style.setProperty('--gaze', `${rot.toFixed(2)}deg`);
  });
}

/** 动画播放倍速（对标 dsh-pet 1.0–2.0x），作用于循环呼吸/走路/说话动画 */
export function applyAnimSpeed() {
  const v = Math.min(2, Math.max(1, Number(state.settings.animSpeed) || 1));
  document.body.style.setProperty('--anim-speed', String(v));
}

export function initPet() {
  initPetSprite();
  initGaze();
  renderAffection();
  applyAnimSpeed();
  blinkLoop();

  setInterval(() => {
    if (state.animationsPaused || document.body.classList.contains('mini') || !state.windowVisible) return;
    if (state.task && (state.task.status === 'thinking' || state.task.status === 'working')) return;
    const idleMs = Date.now() - lastActivity;
    document.body.classList.toggle('inactive', idleMs > INACTIVE_DELAY);
    if (idleMs > SULK_DELAY) setMood('tsundere');
    else if (idleMs > BORED_DELAY) setMood('bored');
    else if (isNight() && idleMs > IDLE_DELAY) setMood('sleepy');

    // 待机行为循环与「状态举牌」由 FSM PetBrain（fsm/index.js）驱动
  }, IDLE_CHECK_INTERVAL);

  document.addEventListener('pointerdown', markActivity, true);
  document.addEventListener('contextmenu', markActivity, true);
  document.addEventListener('pointermove', (e) => {
    if (e.target instanceof Element && e.target.closest('#pet-zone')) markActivity();
  });

  api.on('toggle-animations', (on) => setAnimationsPaused(Boolean(on)));
}
