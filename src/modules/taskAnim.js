/**
 * 任务状态 → 立绘/粒子联动。
 * 只在状态变化时触发一次，不打断用户正在进行的点击互动（busy 期间跳过姿势覆盖）。
 */
import { $, state } from './state.js';
import { subscribe } from './task.js';
import { setPose, spawnHearts, spawnSparkles } from './pet.js';

const POSE = {
  thinking: 'char_work',
  working: 'char_work',
  success: 'char_happy',
  error: 'char_surprise',
};

function wrap() {
  return $('pet-wrap');
}

function playWrap(cls, ms) {
  const w = wrap();
  if (!w) return;
  w.classList.remove(cls);
  void w.offsetWidth;
  w.classList.add(cls);
  setTimeout(() => w.classList.remove(cls), ms);
}

function apply(task, prev) {
  if (document.body.classList.contains('animations-paused')) return;
  const w = wrap();
  if (!w) return;

  w.classList.toggle('task-thinking', task.status === 'thinking');
  w.classList.toggle('task-working', task.status === 'working');

  if (prev && prev.status === task.status) return; // 仅进度变化时不重播动作

  if (task.status === 'idle') {
    setPose(state.settings.skin || 'char_main');
    wrap()?.classList.remove('task-thinking', 'task-working');
    return;
  }
  const pose = POSE[task.status];
  if (pose) setPose(pose, task.status === 'success' || task.status === 'error' ? 3200 : 0);

  if (task.status === 'thinking') {
    playWrap('wiggle', 500);
  } else if (task.status === 'working') {
    playWrap('bounce', 480);
  } else if (task.status === 'success') {
    playWrap('bounce', 480);
    spawnHearts(6);
    spawnSparkles(8);
  } else if (task.status === 'error') {
    playWrap('shake', 550);
  }
}

export function initTaskAnim() {
  let prev = null;
  subscribe((task) => {
    apply(task, prev);
    prev = { status: task.status };
  });
}
