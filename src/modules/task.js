/**
 * TaskManager —— 桌宠「工作状态」统一状态机。
 *
 * 与现有 mood / idle / 台词气泡完全解耦：
 * - 台词气泡（bubble.js）继续负责互动台词、时段提醒；
 * - 本模块只描述「当前正在干什么活」，由 taskBubble 渲染 HUD，
 *   由 taskAnim 驱动立绘。
 *
 * 对外只暴露 updateTask / getTask / subscribe / DeepSeek 模板。
 * 未来接 AI Agent：在请求开始 / 进度 / 结束处调用 updateTask 即可。
 */
import { state } from './state.js';

/** 允许的状态。idle 表示无任务；thinking/working 视为进行中，HUD 保持显示。 */
export const TASK_STATUSES = ['idle', 'thinking', 'working', 'success', 'error'];

const ACTIVE = new Set(['thinking', 'working']);

const DEFAULT_TITLES = {
  idle: '小憩一下 ☕',
  thinking: '正在思考方案 🤔',
  working: '正在生成代码 ⌨️',
  success: '任务完成 🎉',
  error: '出现错误 ⚠️',
};

function emptyTask() {
  return {
    status: 'idle',
    title: DEFAULT_TITLES.idle,
    progress: null, // 0–100；null 表示该状态不展示进度条
    detail: '',
    startTime: null,
    meta: {}, // 扩展字段：model / remain / spent 等，模板用
  };
}

const listeners = new Set();
let current = emptyTask();

function notify() {
  for (const fn of listeners) {
    try {
      fn(current);
    } catch (err) {
      console.error('[TaskManager] listener error', err);
    }
  }
}

function clampProgress(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function normalizeStatus(s) {
  return TASK_STATUSES.includes(s) ? s : 'working';
}

/**
 * 统一入口。任意外部模块（余额查询、未来的 Agent、测试菜单）都走这里。
 *
 * @param {object} patch
 * @param {string}  [patch.status]     idle | thinking | working | success | error
 * @param {string}  [patch.title]
 * @param {number|null} [patch.progress]
 * @param {string}  [patch.detail]
 * @param {object}  [patch.meta]
 * @param {boolean} [patch.resetTimer] 为 true 时重置 startTime（新任务开始）
 */
export function updateTask(patch = {}) {
  const nextStatus = patch.status !== undefined ? normalizeStatus(patch.status) : current.status;
  const starting = current.status === 'idle' && nextStatus !== 'idle';
  const becomingActive = ACTIVE.has(nextStatus) && !ACTIVE.has(current.status);
  const restarting = patch.resetTimer === true || becomingActive;

  if (nextStatus === 'idle') {
    current = emptyTask();
    state.task = current;
    notify();
    return current;
  }

  const next = {
    status: nextStatus,
    title: patch.title !== undefined ? String(patch.title) : current.title || DEFAULT_TITLES[nextStatus],
    progress: patch.progress !== undefined ? clampProgress(patch.progress) : current.progress,
    detail: patch.detail !== undefined ? String(patch.detail) : current.detail,
    meta: patch.meta !== undefined ? { ...current.meta, ...patch.meta } : { ...current.meta },
    startTime: current.startTime,
  };

  if (!next.title) next.title = DEFAULT_TITLES[nextStatus];
  if (starting || restarting || !next.startTime) next.startTime = Date.now();
  if (nextStatus === 'success' && next.progress == null) next.progress = 100;

  current = next;
  state.task = current;
  notify();
  return current;
}

export function getTask() {
  return current;
}

export function isTaskActive() {
  return ACTIVE.has(current.status);
}

export function subscribe(fn) {
  if (typeof fn !== 'function') return () => {};
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function elapsedMs() {
  return current.startTime ? Date.now() - current.startTime : 0;
}

export function fmtElapsed(ms = elapsedMs()) {
  const t = Math.max(0, Math.floor(ms / 1000));
  const p = (n) => String(n).padStart(2, '0');
  return `${p(Math.floor(t / 60))}:${p(t % 60)}`;
}

// ---------- DeepSeek 专属模板（未来 Agent 也可直接复用） ----------

/** 调用模型：title + 模型名 + 进度。 */
export function taskDeepSeekCall({ model, progress, title } = {}) {
  const m = model || state.settings.model || 'deepseek-v4-flash';
  return updateTask({
    status: 'working',
    title: title || '正在请求 DeepSeek',
    progress: progress ?? 0,
    detail: `模型: ${m}`,
    meta: { kind: 'ds-call', model: m },
    resetTimer: progress == null || progress === 0,
  });
}

/** 查询余额：展示剩余；今日消耗未知时不显示。 */
export function taskBalanceQuery({ remain, spent, progress } = {}) {
  const remainText = remain == null ? '--' : `¥${Number(remain).toFixed(1)}`;
  const spentPart = spent == null ? '' : ` · 今日消耗 ¥${Number(spent).toFixed(1)}`;
  return updateTask({
    status: 'working',
    title: '💰 API 余额',
    progress: progress ?? null,
    detail: `剩余 ${remainText}${spentPart}`,
    meta: { kind: 'ds-balance', remain, spent },
  });
}

/** 低价提醒卡片（success 终态，HUD 停留 3 秒后淡出）。 */
export function taskOffpeak({ remainMinutes } = {}) {
  const mins = remainMinutes == null ? '--' : String(Math.max(0, Math.round(remainMinutes)));
  return updateTask({
    status: 'success',
    title: '🔥 当前低价时间',
    progress: null,
    detail: `剩余 ${mins} 分钟`,
    meta: { kind: 'ds-offpeak', remainMinutes },
  });
}
