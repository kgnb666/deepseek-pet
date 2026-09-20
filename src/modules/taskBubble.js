/**
 * Task HUD —— 宠物头顶的工作状态气泡（独立于台词气泡 #bubble）。
 *
 * 显示规则：
 * - thinking / working：一直显示，进度与已运行时间每秒刷新；
 * - success / error：停留 3s 后 fade out，再把状态收回 idle；
 * - idle 主动展示（小憩）：10s 后自动隐藏；
 * - 迷你模式 / 暂停动画：立即收起。
 *
 * 位置：默认在宠物头顶；靠近窗口上沿时下移，避免裁切。
 */
import { $ } from './state.js';
import { hideBubble } from './bubble.js';
import { getTask, isTaskActive, subscribe, updateTask, fmtElapsed, elapsedMs } from './task.js';

const SUCCESS_HOLD_MS = 3000;
const FADE_MS = 280;
const TICK_MS = 1000;

let hideTimer = null;
let tickTimer = null;
let fading = false;

function el() {
  return $('task-hud');
}

function fillBar(pct) {
  if (pct == null) return '';
  const filled = Math.round((pct / 100) * 8);
  return `${'█'.repeat(filled)}${'░'.repeat(8 - filled)}`;
}

function render(task = getTask()) {
  const root = el();
  if (!root) return;
  $('task-hud-title').textContent = task.title || '';
  $('task-hud-detail').textContent = task.detail || '';
  $('task-hud-detail').classList.toggle('hidden', !task.detail);

  const hasProgress = task.progress != null && task.status !== 'idle';
  const row = $('task-hud-progress');
  row.classList.toggle('hidden', !hasProgress);
  if (hasProgress) {
    $('task-hud-bar').style.width = `${task.progress}%`;
    $('task-hud-pct').textContent = `${fillBar(task.progress)} ${task.progress}%`;
  }

  const showTime = isTaskActive() && task.startTime;
  $('task-hud-time').classList.toggle('hidden', !showTime);
  if (showTime) $('task-hud-time').textContent = `已运行 ${fmtElapsed(elapsedMs())}`;

  root.dataset.status = task.status;
}

function clampToViewport() {
  const root = el();
  if (!root) return;
  root.style.setProperty('--hud-x', '0px');
  root.style.setProperty('--hud-y', '0px');
  const r = root.getBoundingClientRect();
  const pad = 8;
  let shiftY = 0;
  if (r.top < pad) shiftY = pad - r.top;
  const overflowX = r.right - (window.innerWidth - pad);
  const shiftX = overflowX > 0 ? -overflowX : r.left < pad ? pad - r.left : 0;
  root.style.setProperty('--hud-x', `${shiftX}px`);
  root.style.setProperty('--hud-y', `${shiftY}px`);
}

function clearTimers() {
  clearTimeout(hideTimer);
  hideTimer = null;
  fading = false;
}

function startTick() {
  clearInterval(tickTimer);
  tickTimer = setInterval(() => {
    if (!isTaskActive()) return;
    render();
  }, TICK_MS);
}

function stopTick() {
  clearInterval(tickTimer);
  tickTimer = null;
}

function hideNow() {
  const root = el();
  if (!root) return;
  root.classList.remove('show', 'out');
  root.classList.add('hidden');
  stopTick();
}

function fadeOutThenIdle() {
  const root = el();
  if (!root || fading) return;
  fading = true;
  root.classList.remove('show');
  root.classList.add('out');
  hideTimer = setTimeout(() => {
    hideNow();
    fading = false;
    if (getTask().status !== 'idle') updateTask({ status: 'idle' });
  }, FADE_MS);
}

function showHud() {
  const root = el();
  if (!root) return;
  if (document.body.classList.contains('mini') || document.body.classList.contains('animations-paused')) {
    hideNow();
    return;
  }
  root.classList.remove('hidden', 'out');
  // 强制重绘，保证每次从 scale(0) 弹性出现
  void root.offsetWidth;
  root.classList.add('show');
  render();
  requestAnimationFrame(clampToViewport);
  startTick();
}

function scheduleHide(ms) {
  clearTimers();
  hideTimer = setTimeout(fadeOutThenIdle, ms);
}

function onTask(task) {
  if (document.body.classList.contains('mini') || document.body.classList.contains('animations-paused')) {
    hideNow();
    return;
  }
  if (task.status === 'idle') {
    // 外部主动 idle：直接收，不再弹「小憩」卡片（避免循环）
    clearTimers();
    hideNow();
    return;
  }
  if (isTaskActive()) hideBubble(); // 工作 HUD 与台词气泡错开，避免叠在头顶
  showHud();
  if (task.status === 'success' || task.status === 'error') {
    scheduleHide(SUCCESS_HOLD_MS);
  } else if (isTaskActive()) {
    clearTimers(); // 进行中：保持显示
  }
}

export function initTaskBubble() {
  subscribe(onTask);
  window.addEventListener('resize', () => {
    if (el()?.classList.contains('show')) clampToViewport();
  });
}

export function hideTaskHud() {
  clearTimers();
  hideNow();
}
