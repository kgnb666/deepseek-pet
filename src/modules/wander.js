/**
 * 自主游走（对标 dsh-pet 的 move / turn 状态）：
 * 空闲时随机走向当前显示器 workArea 内的目标点，走路摇晃 + 朝向目标；
 * 到达后东张西望一次。任意交互（markActivity → cancelWander）立即打断。
 * 锁定位置 / 迷你模式 / 暂停动画时不游走。
 */
import { state } from './state.js';
import { api } from './api.js';
import { setFacing } from './pet.js';
import { playTurn } from './sound.js';

const STEP_MS = 33; // ~30fps 步进
const SPEED = 4.2; // 每步像素（≈127 px/s）
const EDGE_MARGIN = 24; // 距屏幕边缘留白
const MIN_DIST = 140; // 目标点最小距离，太短不值得走
const MAX_TRIES = 3; // 随机取点重试次数

let walking = false;
let cancelled = false;

export function isWandering() {
  return walking;
}

export function cancelWander() {
  if (walking) cancelled = true;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function pickTarget(bounds, wa) {
  const minX = wa.x + EDGE_MARGIN;
  const maxX = wa.x + wa.width - bounds.width - EDGE_MARGIN;
  const minY = wa.y + EDGE_MARGIN;
  const maxY = wa.y + wa.height - bounds.height - EDGE_MARGIN;
  if (maxX <= minX || maxY <= minY) return null;
  for (let i = 0; i < MAX_TRIES; i++) {
    const x = minX + Math.random() * (maxX - minX);
    const y = minY + Math.random() * (maxY - minY);
    if (Math.hypot(x - bounds.x, y - bounds.y) >= MIN_DIST) return { x, y };
  }
  return null;
}

/** 到达后东张西望：左右各看一次（dsh-pet：move 播完接 turn） */
async function lookAround() {
  const back = state.facing === 'left' ? 'right' : 'left';
  setFacing(back);
  playTurn();
  await sleep(650);
  if (cancelled) return;
  setFacing(back === 'left' ? 'right' : 'left');
  playTurn();
  await sleep(500);
}

/** 出去走走。返回是否真的完成了一趟游走。 */
export async function wanderWalk() {
  if (walking) return false;
  if (state.animationsPaused || document.body.classList.contains('mini')) return false;
  if (state.settings.lockPosition) return false;
  const geom = await api.getGeom();
  if (!geom) return false;
  const target = pickTarget(geom.bounds, geom.workArea);
  if (!target) return false;

  walking = true;
  cancelled = false;
  let { x, y } = geom.bounds;
  setFacing(target.x < x ? 'left' : 'right');
  // 步态动画由 FSM 的 anim_walk 帧序列驱动，不再叠加 CSS 摇晃

  while (!cancelled) {
    const dx = target.x - x;
    const dy = target.y - y;
    const dist = Math.hypot(dx, dy);
    if (dist <= SPEED) {
      x = target.x;
      y = target.y;
      api.setWindowPos(Math.round(x), Math.round(y));
      break;
    }
    x += (dx / dist) * SPEED;
    y += (dy / dist) * SPEED;
    api.setWindowPos(Math.round(x), Math.round(y));
    await sleep(STEP_MS);
  }

  const arrived = !cancelled;
  if (arrived) await lookAround();
  walking = false;
  cancelled = false;
  return arrived;
}
