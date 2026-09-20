/**
 * 气泡队列：每条气泡至少展示 3s，连续事件排队播放，不互相覆盖。
 * 超长台词自动分页（对标 dsh-pet 自言自语气泡分页显示）。
 */
import { $, state } from './state.js';

const queue = [];
const MIN_DURATION = 3000;
const GAP = 300; // 气泡之间的呼吸间隔
const PAGE_MAX = 110; // 超过该长度（含标签）自动分页
const PAGE_LINES = 3; // 每页最多行数

let showing = false;
let timer = null;
let pages = [];
let pageIndex = 0;

/** 按 <br> 切行再聚合成分页 */
function splitPages(html) {
  if (html.length <= PAGE_MAX) return [html];
  const lines = html.split(/<br\s*\/?>/i);
  const out = [];
  let cur = '';
  for (const line of lines) {
    if (cur && (cur.length + line.length > PAGE_MAX || cur.split('<br>').length >= PAGE_LINES)) {
      out.push(cur);
      cur = line;
    } else {
      cur = cur ? `${cur}<br>${line}` : line;
    }
  }
  if (cur) out.push(cur);
  return out.length > 1 ? out : [html];
}

export function showBubble(html, type = 'normal', ms = 4000, opts = {}) {
  if (opts.immediate) {
    // 立即展示（如"加载中"），清空等待队列
    queue.length = 0;
    displayBubble(html, type, ms);
    return;
  }
  queue.push({ html, type, ms: ms > 0 ? Math.max(ms, MIN_DURATION) : 0 });
  if (!showing) nextBubble();
}

function renderPage() {
  const more = pageIndex < pages.length - 1 ? '<span class="bubble-more">▾</span>' : '';
  $('bubble-text').innerHTML = pages[pageIndex] + more;
}

function displayBubble(html, type, ms) {
  const b = $('bubble');
  const w = $('pet-wrap');
  clearTimeout(timer);
  pages = splitPages(html);
  pageIndex = 0;
  $('bubble-text').innerHTML = pages[0];
  b.className = `bubble ${type}`;
  if (w) w.classList.add('talking');
  showing = true;
  if (ms > 0) {
    const per = Math.max(2600, ms / pages.length);
    const advance = () => {
      if (pageIndex < pages.length - 1) {
        pageIndex += 1;
        renderPage();
        timer = setTimeout(advance, per);
        return;
      }
      b.classList.add('hidden');
      if (w) w.classList.remove('talking');
      showing = false;
      setTimeout(nextBubble, GAP);
    };
    timer = setTimeout(advance, per);
  } else {
    showing = false; // 常驻气泡（如加载中）不占用队列锁，后续气泡可直接顶掉
  }
}

export function nextBubble() {
  if (state.animationsPaused) return; // 暂停动画时排队等待，恢复后继续
  const item = queue.shift();
  if (item) displayBubble(item.html, item.type, item.ms);
}

/** 暂停动画：立刻收起当前气泡 */
export function hideBubble() {
  clearTimeout(timer);
  showing = false;
  pages = [];
  pageIndex = 0;
  const w = $('pet-wrap');
  if (w) w.classList.remove('talking');
  $('bubble').classList.add('hidden');
}

/** 恢复动画：续播队列 */
export function replayBubbles() {
  setTimeout(nextBubble, GAP);
}
