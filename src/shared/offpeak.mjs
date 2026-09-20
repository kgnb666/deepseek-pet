/**
 * DeepSeek 高峰/低谷时段判断（纯函数，渲染层 / 主进程 / 测试共用）。
 *
 * DeepSeek 官方高峰（Peak）：仅工作日（周一~周五）UTC 01:00–04:00 与 06:00–10:00，
 * 其余时间（含周末全天、工作日午间与夜间）均为低谷（Off-peak，半价）。
 * 换算北京时间（UTC+8）：工作日 09:00–12:00 与 14:00–18:00 为高价，其余为低价。
 * 判断统一基于 UTC，避免本地时区歧义。
 */

export const PEAK_RANGES_UTC = [
  [60, 240], // 01:00–04:00 UTC
  [360, 600], // 06:00–10:00 UTC
];

/**
 * @param {Date} [now]
 * @returns {{isLow: boolean, remainMs: number}} remainMs 为距下一个时段切换点的毫秒数
 */
export function offpeakInfo(now = new Date()) {
  const day = now.getUTCDay(); // 0=周日,1=周一…6=周六
  const mins = now.getUTCHours() * 60 + now.getUTCMinutes();
  const isWeekday = day >= 1 && day <= 5;
  const inPeak = isWeekday && PEAK_RANGES_UTC.some(([s, e]) => mins >= s && mins < e);
  const isLow = !inPeak;

  // 下一个状态切换点：最近的工作日高峰起/止边界（> 当前时刻）
  let boundary = null;
  for (let add = 0; add <= 14; add++) {
    const d = new Date(now);
    d.setUTCDate(d.getUTCDate() + add);
    const dd = d.getUTCDay();
    if (dd < 1 || dd > 5) continue; // 高峰仅存在于工作日
    for (const [s, e] of PEAK_RANGES_UTC) {
      for (const m of [s, e]) {
        const cand = new Date(d);
        cand.setUTCHours(Math.floor(m / 60), m % 60, 0, 0);
        if (cand > now && (!boundary || cand < boundary)) boundary = cand;
      }
    }
  }
  return { isLow, remainMs: boundary ? boundary - now : 0 };
}

/** ms → HH:MM:SS 倒计时 */
export function fmtCountdown(ms) {
  const t = Math.max(0, Math.floor(ms / 1000));
  const p = (n) => String(n).padStart(2, '0');
  return `${p(Math.floor(t / 3600))}:${p(Math.floor((t % 3600) / 60))}:${p(t % 60)}`;
}
