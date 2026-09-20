/**
 * PetState —— 桌宠状态枚举与元数据（纯数据，无 DOM）。
 *
 * tier 优先级：数字越大越"紧急"，高 tier 可打断低 tier，低 tier 不能打断高 tier：
 *   0 常驻基础态（自动循环） < 1 互动态 < 2 异步功能态（持续到任务结束）
 *   < 3 系统事件态（播完自动回退） < 4 终态（告别动画，锁定状态机）
 * kind:
 *   loop     常驻循环态：停留 duration 后由 pickIdle 策略随机切到其他基础态
 *   temp     临时态：停留 duration 后自动回退 fallback（默认 IDLE）
 *   hold     驻留态：无定时器，直到外部 changeState 改写（成功/失败事件驱动）
 *   terminal 终态：播完 duration 后触发 'exit' 事件（退出客户端）
 */
export const PET_STATES = {
  // ---- 常驻基础态（tier 0，自动循环） ----
  IDLE: { tier: 0, kind: 'loop', duration: 5000, fallback: null },
  WALK: { tier: 0, kind: 'temp', duration: 12000, fallback: 'IDLE' },
  REST: { tier: 0, kind: 'temp', duration: 6000, fallback: 'IDLE' },
  ROLL: { tier: 0, kind: 'temp', duration: 2200, fallback: 'IDLE' },
  STRETCH: { tier: 0, kind: 'temp', duration: 1300, fallback: 'IDLE' },
  // ---- 互动态（tier 1，点击/悬停触发） ----
  PETTING: { tier: 1, kind: 'temp', duration: 2600, fallback: 'IDLE' },
  // ---- 异步功能态（tier 2，任务驱动，驻留） ----
  LOADING: { tier: 2, kind: 'hold' },
  CODING: { tier: 2, kind: 'hold' },
  DEBUGGING: { tier: 2, kind: 'hold' },
  THINKING: { tier: 2, kind: 'hold' },
  // ---- 结果反馈/系统事件态（tier 3，播完自动回退） ----
  SUCCESS: { tier: 3, kind: 'temp', duration: 3200, fallback: 'IDLE' },
  ALERT: { tier: 3, kind: 'temp', duration: 4200, fallback: 'IDLE' },
  REFUSE: { tier: 3, kind: 'temp', duration: 4200, fallback: 'IDLE' },
  // ---- 终态（tier 4） ----
  GOODBYE: { tier: 4, kind: 'terminal', duration: 1800 },
};

export const DEFAULT_STATE = 'IDLE';

export const STATE_KEYS = Object.keys(PET_STATES);
export const BASE_STATES = ['IDLE', 'WALK', 'REST', 'ROLL', 'STRETCH'];
export const FUNCTIONAL_STATES = ['LOADING', 'CODING', 'DEBUGGING', 'THINKING'];
export const SYSTEM_STATES = ['SUCCESS', 'ALERT', 'REFUSE', 'GOODBYE'];

export function isPetState(key) {
  return typeof key === 'string' && Object.prototype.hasOwnProperty.call(PET_STATES, key);
}
