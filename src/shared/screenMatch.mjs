/**
 * 前台窗口白名单匹配（纯函数）：主动识屏陪伴用。
 * 支持子串匹配与 * 通配符，大小写不敏感。
 * 例：['Code', 'chrome*', '*知乎*']
 */

function toRegex(pattern) {
  const escaped = String(pattern)
    .trim()
    .replace(/[.*+?^${}()|[\]\\]/g, (ch) => (ch === '*' ? '.*' : `\\${ch}`));
  return new RegExp(escaped, 'i');
}

/**
 * @param {string} title 前台窗口标题（含进程名）
 * @param {string[]} patterns 白名单
 * @returns {boolean}
 */
export function matchesWhitelist(title, patterns) {
  if (!title || !Array.isArray(patterns) || patterns.length === 0) return false;
  return patterns.some((p) => {
    if (typeof p !== 'string' || !p.trim()) return false;
    return toRegex(p).test(title);
  });
}
