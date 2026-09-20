/**
 * 节日与天气氛围：按本地日期触发节日皮肤/台词；天气用时段兜底（无需 API）。
 */
const FESTIVALS = [
  { m: 1, d: 1, id: 'newyear', emoji: '🎆', title: '元旦快乐', line: '新的一年，代码也要顺利～🎆', skin: 'char_happy' },
  { m: 2, d: 14, id: 'valentine', emoji: '💝', title: '情人节', line: '今天要多摸摸头才行 💝', skin: 'char_shy' },
  { m: 5, d: 1, id: 'labor', emoji: '🛠️', title: '劳动节', line: '放假也别忘了休息一下哦', skin: 'char_happy' },
  { m: 6, d: 1, id: 'kids', emoji: '🎈', title: '儿童节', line: '今天允许摸鱼！🎈', skin: 'char_happy' },
  { m: 10, d: 1, id: 'national', emoji: '🎉', title: '国庆快乐', line: '节日快乐！低价时段也要盯着～🎉', skin: 'char_happy' },
  { m: 12, d: 24, id: 'xmas-eve', emoji: '🎄', title: '平安夜', line: '平安夜快乐，早点休息～🎄', skin: 'char_happy' },
  { m: 12, d: 25, id: 'xmas', emoji: '🎄', title: '圣诞节', line: '圣诞快乐！小鲸鱼送来祝福 🐳🎄', skin: 'char_happy' },
];

/** 农历节日用公历近似窗口（每年会略偏，作为氛围足够） */
function lunarApprox(now) {
  const md = (now.getMonth() + 1) * 100 + now.getDate();
  // 春节窗口：1/20–2/19
  if (md >= 120 && md <= 219) {
    return { id: 'spring', emoji: '🧧', title: '新春快乐', line: '恭喜发财！代码无 bug～🧧', skin: 'char_happy' };
  }
  // 中秋窗口：9/8–10/6
  if (md >= 908 && md <= 1006) {
    return { id: 'midautumn', emoji: '🥮', title: '中秋快乐', line: '月圆人也圆，今晚早点休息 🥮', skin: 'char_happy' };
  }
  return null;
}

export function getFestival(date = new Date()) {
  const hit = FESTIVALS.find((f) => date.getMonth() + 1 === f.m && date.getDate() === f.d);
  if (hit) return hit;
  return lunarApprox(date);
}

/** 无天气 API 时用时段模拟氛围：清晨/雨季感/晴天/夜晚 */
export function getWeatherMood(date = new Date()) {
  const h = date.getHours();
  const month = date.getMonth() + 1;
  if (h >= 22 || h < 6) return { id: 'night', emoji: '🌙', line: '夜深了，记得关灯保护眼睛～🌙' };
  if (h < 8) return { id: 'dawn', emoji: '🌅', line: '早安！今天也要元气满满 🌅' };
  if (month >= 6 && month <= 8 && h >= 14 && h < 17) {
    return { id: 'summer', emoji: '☀️', line: '夏天热热的，记得多喝水 ☀️' };
  }
  if ((month >= 3 && month <= 5) || month === 9) {
    return { id: 'mild', emoji: '🌤', line: '天气刚刚好，适合写代码 🌤' };
  }
  if (month === 12 || month <= 2) return { id: 'winter', emoji: '❄️', line: '天冷了，小鲸鱼想钻被窝 ❄️🐳' };
  return { id: 'day', emoji: '☁', line: '今天也要保持好心情～' };
}

export function festivalGreeting() {
  const f = getFestival();
  if (!f) return null;
  return `${f.emoji} <b>${f.title}</b><br>${f.line}`;
}
