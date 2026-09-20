/**
 * Agent 联动协议（纯函数）：Agent 通过本地 HTTP 服务投递事件，
 * 渲染层消费。此处做事件规范化与校验，主进程 / 测试共用。
 *
 * 事件类型：
 * - task:  {type:'task', status, title?, progress?, detail?}
 * - say:   {type:'say', text, ms?, level?}
 * - chat:  {type:'chat', text}            → 交给默认 Provider 回答，气泡流式显示
 * - mood:  {type:'mood', value}           → happy|bored|sleepy|tsundere
 * - pose:  {type:'pose', name, ms?}       → 切换立绘（内置皮肤或已加载角色姿势名）
 * - think: {type:'think', on}             → 思考中的 Thinking 指示（HUD thinking 态）
 * - state: {type:'state', value, duration?, fallback?} → 直接驱动桌宠 FSM
 */

export const AGENT_EVENT_TYPES = ['task', 'say', 'chat', 'mood', 'pose', 'think', 'state'];
export const TASK_STATUSES = ['idle', 'thinking', 'working', 'success', 'error'];
export const MOODS = ['happy', 'bored', 'sleepy', 'tsundere'];
export const SAY_LEVELS = ['normal', 'success', 'warn'];
// 与 src/modules/fsm/PetState.mjs 的 PET_STATES 键保持同步（有同步测试守护）
export const AGENT_STATE_KEYS = [
  'IDLE',
  'WALK',
  'REST',
  'ROLL',
  'STRETCH',
  'PETTING',
  'LOADING',
  'CODING',
  'DEBUGGING',
  'THINKING',
  'SUCCESS',
  'ALERT',
  'REFUSE',
  'GOODBYE',
];

const MAX_TEXT = 2000;
const MAX_TITLE = 200;
const MAX_DETAIL = 500;
const MAX_POSE_MS = 60_000;
const MAX_SAY_MS = 120_000;

function asTrimmedString(v, max) {
  if (v === undefined || v === null) return undefined;
  const s = String(v).trim();
  if (!s) return undefined;
  return s.slice(0, max);
}

function clampProgress(v) {
  if (v === undefined || v === null || v === '') return undefined;
  const n = Number(v);
  if (!Number.isFinite(n)) return undefined;
  return Math.max(0, Math.min(100, Math.round(n)));
}

/**
 * 规范化一个 Agent 事件。
 * @returns {{ok: true, event: object} | {ok: false, error: string}}
 */
export function normalizeAgentEvent(raw) {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, error: 'event must be a JSON object' };
  }
  const type = raw.type;
  if (!AGENT_EVENT_TYPES.includes(type)) {
    return { ok: false, error: `unknown type "${type}" (expected one of ${AGENT_EVENT_TYPES.join('|')})` };
  }

  switch (type) {
    case 'task': {
      const status = TASK_STATUSES.includes(raw.status) ? raw.status : undefined;
      if (!status) return { ok: false, error: `task.status must be one of ${TASK_STATUSES.join('|')}` };
      const event = { type, status };
      const title = asTrimmedString(raw.title, MAX_TITLE);
      const detail = asTrimmedString(raw.detail, MAX_DETAIL);
      const progress = clampProgress(raw.progress);
      if (title !== undefined) event.title = title;
      if (detail !== undefined) event.detail = detail;
      if (progress !== undefined) event.progress = progress;
      return { ok: true, event };
    }
    case 'say':
    case 'chat': {
      const text = asTrimmedString(raw.text ?? raw.content, MAX_TEXT);
      if (!text) return { ok: false, error: `${type}.text is required` };
      const event = { type, text };
      if (type === 'say') {
        if (SAY_LEVELS.includes(raw.level)) event.level = raw.level;
        if (raw.ms !== undefined) {
          const n = Number(raw.ms);
          if (Number.isFinite(n) && n >= 0) event.ms = Math.min(MAX_SAY_MS, Math.round(n));
        }
      }
      return { ok: true, event };
    }
    case 'mood': {
      if (!MOODS.includes(raw.value)) {
        return { ok: false, error: `mood.value must be one of ${MOODS.join('|')}` };
      }
      return { ok: true, event: { type, value: raw.value } };
    }
    case 'pose': {
      const name = asTrimmedString(raw.name, 80);
      if (!name) return { ok: false, error: 'pose.name is required' };
      const event = { type, name };
      if (raw.ms !== undefined) {
        const n = Number(raw.ms);
        if (Number.isFinite(n) && n > 0) event.ms = Math.min(MAX_POSE_MS, Math.round(n));
      }
      return { ok: true, event };
    }
    case 'think': {
      // 缺省视为 off（收回思考指示），传真值才点亮
      const on = raw.on === undefined ? false : Boolean(raw.on);
      return { ok: true, event: { type, on } };
    }
    case 'state': {
      // 直接驱动桌宠 FSM（高优先级强制切换）
      if (!AGENT_STATE_KEYS.includes(raw.value)) {
        return { ok: false, error: `state.value must be one of ${AGENT_STATE_KEYS.join('|')}` };
      }
      const event = { type, value: raw.value };
      if (raw.duration !== undefined) {
        const n = Number(raw.duration);
        if (Number.isFinite(n) && n > 0) event.duration = Math.min(MAX_SAY_MS, Math.round(n));
      }
      if (AGENT_STATE_KEYS.includes(raw.fallback)) event.fallback = raw.fallback;
      return { ok: true, event };
    }
    default:
      return { ok: false, error: 'unreachable' };
  }
}

/** 把请求体（JSON 或 JSONL）解析为事件数组。 */
export function parseEventBody(body) {
  const text = String(body ?? '').trim();
  if (!text) return { ok: false, error: 'empty body' };
  if (text.startsWith('{')) {
    // 可能是单个 JSON 对象，也可能是 JSONL（每行一个对象）
    const lines = text.split('\n').filter((l) => l.trim());
    if (lines.length === 1) return { ok: true, events: [JSON.parse(lines[0])] };
    return { ok: true, events: lines.map((l) => JSON.parse(l)) };
  }
  if (text.startsWith('[')) return { ok: true, events: JSON.parse(text) };
  return { ok: false, error: 'body must be JSON object / array / JSONL' };
}
