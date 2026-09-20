/**
 * 语义化版本比较（纯函数）：检查更新时比较 GitHub Release tag 与当前版本。
 */

/** @returns {number[]|null} [major, minor, patch] 或 null（无法解析） */
export function parseSemver(v) {
  if (typeof v !== 'string') return null;
  const m = v.trim().replace(/^v/i, '').match(/^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/);
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/** @returns {-1|0|1} a<b → -1；a>b → 1；相等或不可解析 → 0 */
export function compareSemver(a, b) {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  if (!pa || !pb) return 0;
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] < pb[i] ? -1 : 1;
  }
  return 0;
}

/** candidate 是否比 current 更新 */
export function isNewerVersion(candidate, current) {
  return compareSemver(candidate, current) > 0;
}
