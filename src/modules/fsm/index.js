/**
 * PetBrain —— FSM 组合根 / 渲染适配层。
 *
 * 职责：把状态机的抽象状态翻译成具体表现——
 *   立绘（含素材别名回退 + 热加载探测）、帧动画清单、气泡台词、
 *   游走（WALK）、特效（成功撒花/警报摇晃/伸懒腰）、退出回调。
 * 不负责：HUD 文案（task.js 权威）、音效（sound.js 由各反馈自行播放）。
 *
 * 用户活动跟踪也在这里：任意点击/右键重置空闲，点宠物触发 PETTING（Hover 带冷却），
 * 空闲 ≥60s 开启 FSM 待机行为循环（权重来自生活状态引擎 lifeState）。
 */
import { PetStateMachine } from './PetStateMachine.mjs';
import { FrameAnimator } from './FrameAnimator.js';
import { createAnimPlayer } from './animPlayer.js';
import { $, state } from '../state.js';
import { setPose, spawnHearts, spawnSparkles, petShake } from '../pet.js';
import { showBubble } from '../bubble.js';
import { wanderWalk, cancelWander } from '../wander.js';
import { getLifeState, IDLE_POOLS } from '../lifeState.js';
import { isExternalSkin } from '../characters.js';

// ---------- 状态 → 立绘别名（优先专属素材，缺文件自动回退；素材就位即生效） ----------
// ---------- 状态 → 立绘别名（优先 24fps 动画片段，缺文件自动回退；素材热探测） ----------
const STATE_POSES = {
  IDLE: ['char_main'],
  WALK: ['anim_walk', 'char_walk', 'char_main'],
  REST: ['anim_rest', 'char_lie'],
  ROLL: ['anim_roll'],
  STRETCH: ['anim_stretch', 'char_main'],
  PETTING: ['anim_petting', 'char_happy'],
  LOADING: ['anim_loading', 'char_loading', 'char_work'],
  CODING: ['anim_coding', 'char_work'],
  DEBUGGING: ['anim_debug', 'char_debug', 'char_work'],
  THINKING: ['anim_think', 'char_think', 'char_work'],
  SUCCESS: ['anim_success', 'char_success', 'char_happy'],
  ALERT: ['anim_alert', 'char_alert'],
  REFUSE: ['anim_refuse', 'char_refuse', 'char_angry'],
  GOODBYE: ['anim_goodbye', 'char_goodbye', 'char_happy'],
};

// ---------- 状态 → 气泡台词 ----------
const STATE_LINES = {
  WALK: ['出去走走～🐾', '跟着主人的脚步移动！'],
  REST: ['趴下休息一会儿…💤', '地板有点凉，但是好舒服～'],
  ROLL: ['打滚卖萌中～熟练地滚了一圈 🐳', '看我的无敌旋风滚！'],
  LOADING: ['正在加载中…有点困困的 😪'],
  CODING: ['认真写码中，别打扰我哦 ⌨️'],
  DEBUGGING: ['咦，有报错？我来查一查 🔍'],
  THINKING: ['让我想想…🤔'],
  SUCCESS: ['搞定啦！报告完成 🎉'],
  ALERT: ['⚠️ 警报！余额或错误率异常！'],
  REFUSE: ['哼，连接断掉了，人家不理你啦 😤'],
  GOODBYE: ['拜拜～主人再见 👋'],
};

const IDLE_DELAY = 60_000;
const HOVER_COOLDOWN = 8_000;
const KNOWN_BUILTIN_POSES = [
  'char_main',
  'char_happy',
  'char_work',
  'char_sleep',
  'char_angry',
  'char_shy',
  'char_surprise',
  'char_blink',
  'char_sign',
  'char_alert',
  'char_lie',
  'anim_roll',
];

let fsm = null;
let animator = null;
let animPlayer = null;
let lastActivity = Date.now();
let lastPettingAt = 0;
const knownPoses = new Set(KNOWN_BUILTIN_POSES);

// ---------- 立绘解析 ----------

/** 启动时探测别名素材是否存在（后台加载，成功即加入可用集 → 素材热补货免改码） */
function probePoses() {
  for (const list of Object.values(STATE_POSES)) {
    for (const name of list) {
      if (knownPoses.has(name)) continue;
      const img = new Image();
      img.onload = () => knownPoses.add(name);
      img.src = `app://./assets/${name}.webp`;
    }
  }
}

function pickPose(key) {
  const aliases = STATE_POSES[key] || [];
  if (isExternalSkin(state.settings.skin)) return aliases[0] || 'char_main';
  for (const alias of aliases) {
    if (knownPoses.has(alias)) return alias;
  }
  return aliases[aliases.length - 1] || state.settings.skin || 'char_main';
}

// ---------- 状态渲染 ----------

function showLine(key, type = 'normal') {
  const lines = STATE_LINES[key];
  if (!lines || state.animationsPaused) return;
  showBubble(lines[Math.floor(Math.random() * lines.length)], type, 3600);
}

function render(to, from) {
  if (state.animationsPaused) return; // 暂停动画：状态照常流转，视觉冻结
  if (from === 'WALK' && to !== 'WALK') cancelWander();
  const skin = state.settings.skin || 'char_main';

  switch (to) {
    case 'IDLE':
      setPose(skin);
      break;
    case 'WALK': {
      if (state.settings.lockPosition || document.body.classList.contains('mini')) {
        fsm?.changeState('IDLE', { force: true });
        break;
      }
      setPose(pickPose('WALK'));
      showLine('WALK');
      wanderWalk().then(() => {
        if (fsm?.state === 'WALK') fsm.changeState('IDLE', { force: true });
      });
      break;
    }
    case 'REST':
      setPose(pickPose('REST'));
      showLine('REST');
      break;
    case 'ROLL':
      setPose('anim_roll');
      showLine('ROLL');
      spawnHearts(3);
      break;
    case 'STRETCH':
      setPose(pickPose('STRETCH')); // anim_stretch 帧动画；缺素材时回退静态（不再叠加 CSS 拉伸）
      break;
    case 'PETTING':
      setPose(pickPose('PETTING'));
      break;
    case 'LOADING':
    case 'CODING':
    case 'DEBUGGING':
    case 'THINKING':
      setPose(pickPose(to));
      showLine(to);
      break;
    case 'SUCCESS':
      setPose(pickPose('SUCCESS'));
      spawnHearts(6);
      spawnSparkles(8);
      showLine('SUCCESS', 'success');
      break;
    case 'ALERT':
    case 'REFUSE':
      setPose(pickPose(to));
      petShake();
      showLine(to, 'warn');
      break;
    case 'GOODBYE':
      setPose(pickPose('GOODBYE'));
      showLine('GOODBYE', 'success');
      break;
    default:
      break;
  }
  animPlayer.onStateChange(from, to); // 三段式帧动画编排（清单存在时接管显示）
}

// ---------- 待机策略：生活状态引擎权重 → FSM 基础态 ----------

function pickIdleByMood() {
  const ls = getLifeState({
    taskStatus: 'idle',
    balance: Number.isFinite(state.prevBalance) ? state.prevBalance : null,
  });
  const pool = ls.pool || IDLE_POOLS.normal;
  const weights = { REST: pool.nap + pool.lie, ROLL: pool.roll, STRETCH: pool.stretch, WALK: pool.charm };
  let r = Math.random();
  for (const [key, w] of Object.entries(weights)) {
    if (r < w) return key;
    r -= w;
  }
  return 'REST';
}

// ---------- 初始化 ----------

export function initPetFSM(deps = {}) {
  if (fsm) return fsm;
  animator = new FrameAnimator({
    imgEl: $('pet'),
    sheetEl: $('pet-sheet'),
    getPaused: () => state.animationsPaused,
  });
  animPlayer = createAnimPlayer({ animator, getState: () => fsm?.state });
  fsm = new PetStateMachine({ pickIdle: pickIdleByMood });
  fsm.on('change', ({ from, to }) => render(to, from));
  fsm.on('reenter', ({ state: s }) => render(s, s));
  fsm.on('exit', () => deps.onExit?.());
  probePoses();

  // 用户活动跟踪：任意点击/右键重置空闲并打断基础态
  const mark = (e) => {
    lastActivity = Date.now();
    fsm.notifyUserActivity();
    // 点到宠物本体 → 摸头互动（互动态；拖拽的抓起表现会在其后覆盖立绘）
    if (
      e &&
      e.type === 'pointerdown' &&
      e.target instanceof Element &&
      e.target.closest('#pet-wrap') &&
      fsm.tier === 0
    ) {
      lastPettingAt = Date.now();
      fsm.changeState('PETTING');
    }
  };
  document.addEventListener('pointerdown', mark, true);
  document.addEventListener('contextmenu', mark, true);
  document.addEventListener(
    'pointermove',
    (e) => {
      if (e.target instanceof Element && e.target.closest('#pet-zone')) lastActivity = Date.now();
    },
    true,
  );

  // Hover 摸头（带冷却，避免 hover 刷屏）
  $('pet-wrap')?.addEventListener('pointerenter', () => {
    if (fsm.tier > 0 || Date.now() - lastPettingAt < HOVER_COOLDOWN) return;
    lastPettingAt = Date.now();
    fsm.changeState('PETTING');
  });

  // 空闲检测：≥60s 无操作开启待机行为循环（由 FSM 自动循环基础态）
  setInterval(() => {
    if (document.body.classList.contains('mini')) return;
    fsm.setAutoCycle(Date.now() - lastActivity > IDLE_DELAY);
  }, 5000);

  return fsm;
}

export function getPetFSM() {
  return fsm;
}
