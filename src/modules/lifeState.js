/**
 * 生活状态引擎（纯逻辑，不碰 DOM / IPC，可测试）：
 * 融合四个信号——DeepSeek 时段（低价/高价）、余额档位、是否深夜、当前任务——
 * 得出桌宠的「生活状态」，用于：
 *  1. 空闲动作池的偏好权重（低价爱打滚卖萌、高价/深夜爱趴下打盹、没钱蔫头耷脑）；
 *  2. 周期性「状态举牌」提醒（低价举「低价！」牌、余额告急举「快充值！」牌、深夜趴桌）。
 *
 * pet.js 负责执行（setPose/showBubble），本模块只做决策。
 */
import { offpeakInfo } from '../shared/offpeak.mjs';
import { tierFor } from '../shared/balanceTiers.mjs';

/** 各生活状态下的空闲动作偏好（权重和为 1）。
 *  nap=打盹 roll=打滚卖萌 charm=开心卖萌 stretch=伸懒腰 lie=趴下休息 */
export const IDLE_POOLS = {
  normal: { nap: 0.2, roll: 0.2, charm: 0.22, stretch: 0.16, lie: 0.22 },
  offpeak: { nap: 0.12, roll: 0.34, charm: 0.3, stretch: 0.14, lie: 0.1 },
  peak: { nap: 0.34, roll: 0.08, charm: 0.14, stretch: 0.1, lie: 0.34 },
  night: { nap: 0.26, roll: 0.05, charm: 0.07, stretch: 0.08, lie: 0.54 },
  broke: { nap: 0.2, roll: 0.06, charm: 0.1, stretch: 0.14, lie: 0.5 },
};

/** 状态举牌的最小/最大冷却（ms）：避免机械刷屏 */
export const REMINDER_COOLDOWNS = {
  broke: [4 * 60_000, 6 * 60_000],
  offpeak: [3.5 * 60_000, 5.5 * 60_000],
  peak: [6 * 60_000, 9 * 60_000],
  night: [6 * 60_000, 9 * 60_000],
};

/**
 * 计算当前生活状态。优先级：任务进行中 > 深夜 > 余额告急 > 时段。
 * @param {object} [input]
 * @param {string} [input.taskStatus] 任务状态（thinking/working 视为进行中）
 * @param {number|null} [input.balance] 当前余额（未知传 null，不参与判断）
 * @param {number} [input.hour] 本地小时（默认取当前时间）
 * @param {boolean} [input.isLow] 是否低价时段（默认按当前时间计算）
 * @returns {{key: 'task'|'night'|'broke'|'offpeak'|'peak'|'normal', pool: object|null}}
 */
export function getLifeState(input = {}) {
  const taskStatus = input.taskStatus ?? 'idle';
  if (taskStatus === 'thinking' || taskStatus === 'working') {
    return { key: 'task', pool: null }; // 任务姿势由 taskAnim 驱动，引擎不抢
  }
  const hour = input.hour ?? new Date().getHours();
  const isLow = input.isLow ?? offpeakInfo().isLow;
  if (hour >= 23 || hour < 6) return { key: 'night', pool: IDLE_POOLS.night };
  const tier = input.balance == null ? null : tierFor(input.balance);
  if (tier && (tier.key === 'debt' || tier.key === 'broke')) {
    return { key: 'broke', pool: IDLE_POOLS.broke };
  }
  if (isLow) return { key: 'offpeak', pool: IDLE_POOLS.offpeak };
  return { key: 'peak', pool: IDLE_POOLS.peak };
}

/** 按权重从空闲动作池抽一个动作 */
export function pickIdleAction(pool, rng = Math.random) {
  if (!pool) return 'charm';
  let r = rng();
  for (const [key, w] of Object.entries(pool)) {
    if (r < w) return key;
    r -= w;
  }
  return Object.keys(pool).at(-1);
}

let lastReminderAt = 0;

/** 测试用：重置提醒冷却计时 */
export function resetLifeStateTimers() {
  lastReminderAt = 0;
}

/**
 * 是否该做一次「状态举牌」。冷却带随机抖动，避免机械。
 * @returns {null | {pose: string, ms: number, html: string, type: string}}
 */
export function maybeStateReminder(lifeState, now = Date.now()) {
  const key = lifeState.key;
  const cooldown = REMINDER_COOLDOWNS[key];
  if (!cooldown) return null;
  const [min, max] = cooldown;
  if (now - lastReminderAt < min + Math.random() * (max - min)) return null;
  lastReminderAt = now;
  switch (key) {
    case 'broke':
      return { pose: 'char_alert', ms: 4200, type: 'warn', html: '⚠️ <b>余额告急！</b><br>快充值，不然我要停机啦 🆘' };
    case 'offpeak':
      return { pose: 'char_sign', ms: 4200, type: 'success', html: '蓝牌举起来～<br>现在是<b>低价时段</b>，跑任务最划算 💰' };
    case 'peak':
      return { pose: 'char_lie', ms: 4600, type: 'normal', html: '高价时段…<br>我先趴一会儿，降价了叫我 🕐' };
    case 'night':
      return { pose: 'char_lie', ms: 5000, type: 'normal', html: '夜深了…<br>主人也早点休息呀 🌙' };
    default:
      return null;
  }
}
