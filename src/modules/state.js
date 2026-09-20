/**
 * 渲染层共享状态与常量（被所有模块依赖，自身不依赖任何模块）
 */

export const $ = (id) => document.getElementById(id);

// DeepSeek 官方高峰时段（Peak）：仅工作日（周一至周五）UTC 01:00–04:00 与 06:00–10:00。
// 其余时间（含周末全天、工作日午间 12:00–14:00 与夜间 18:00–次日 09:00）均为低谷（Off-peak，半价）。
// 换算北京时间（UTC+8）：工作日 09:00–12:00 与 14:00–18:00 为高价，其余为低价。
// 判断统一基于 UTC，避免本地时区歧义。
export const PEAK_RANGES_UTC = [
  [60, 240], // 01:00–04:00 UTC
  [360, 600], // 06:00–10:00 UTC
];

// 未配置 API Key 时展示的演示数据
export const DEMO = { total: 117.85, topped: 100.0, granted: 17.85 };

export const CONSOLE_URL = 'https://platform.deepseek.com/usage';

// prices.json 缺失时的内置兜底价格（原价 / 低价时段折扣价，单位 USD / 1M tokens，与 DeepSeek 官方一致）
export const DEFAULT_PRICES = {
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

export const state = {
  settings: {},
  prices: DEFAULT_PRICES,
  animationsPaused: false,
  prevIsLow: null, // 时段跳变检测（null = 尚未初始化）
  prevBalance: parseFloat(localStorage.getItem('lastBalance') || 'NaN'),
  balanceHistory: JSON.parse(localStorage.getItem('balanceHistory') || '[]'),
  queryCount: parseInt(localStorage.getItem('queryCount') || '0', 10),
  affection: parseInt(localStorage.getItem('affection') || '0', 10),
  lastMilestone: parseInt(localStorage.getItem('lastMilestone') || '0', 10),
  lastErrorType: null, // 同一错误只弹一次气泡
  mood: 'happy', // happy | bored | sleepy | tsundere
  facing: 'right', // 朝向：right | left（拖拽/游走/转身时翻转）
  windowVisible: true,
  task: { status: 'idle', title: '', progress: null, detail: '', startTime: null, meta: {} },
};
