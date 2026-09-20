/**
 * 窗口拖动 + 抛掷物理：PointerCapture；松手速度足够则惯性飞行，撞到屏幕边缘反弹。
 * 对标 dsh-pet：
 * - 按下即反馈（petOnPress 压扁 + 轻音），确认点击/拖拽后各播完整反馈；
 * - 抓起有姿态（char_surprise + 悬空扑腾），拖拽中朝向随手方向翻转；
 * - 弹弓：拖拽中按住右键蓄力（aim），松手 ×2.6 倍发射。
 */
import { $, state } from './state.js';
import { api } from './api.js';
import {
  markActivity,
  petOnClick,
  petOnPress,
  petOnDragEnd,
  petOnBounce,
  setFacing,
  getFacing,
  setPose,
  spawnSparkles,
} from './pet.js';
import { playGrab, playLaunch, playPress, playBonk } from './sound.js';

const MOVEMENT_THRESHOLD = 3;
const FLING_MIN = 14;
const FRICTION = 0.935;
const RESTITUTION = 0.64;
const STOP_SPEED = 1.6;
const SLING_TIERS = [1.8, 2.4, 3.0, 3.7]; // 弹弓四档倍率（对标 dsh-pet 甩出力度四档）
const SLING_MIN = 26; // 弹弓最低初速

function slingTier(dist) {
  return dist < 70 ? 0 : dist < 150 ? 1 : dist < 280 ? 2 : 3;
}

let drag = null;
let flingRaf = null;
let aim = false; // 弹弓蓄力中（拖拽时按住了右键）
// 飞行速度提到模块级：多开碰撞的冲量要叠加进来
const fling = { active: false, vx: 0, vy: 0 };

/** 多开碰撞：叠加邻居冲量到当前飞行速度 */
export function applyImpulse(x, y) {
  if (!fling.active) return;
  fling.vx += x;
  fling.vy += y;
}

function startDrag(e, el) {
  if (state.settings.lockPosition && !e.shiftKey) return;
  cancelFling();
  el.setPointerCapture(e.pointerId);
  drag = {
    x: e.screenX,
    y: e.screenY,
    sx0: e.screenX,
    sy0: e.screenY,
    moved: false,
    el,
    isPet: el.id === 'pet-wrap',
    pid: e.pointerId,
    vx: 0,
    vy: 0,
    t: performance.now(),
  };
}

/** 首次越过移动阈值：抓起反馈（dsh-pet drag 状态） */
function onGrabStart() {
  if (!drag?.isPet) return;
  const p = $('pet');
  if (p) p.classList.remove('squish'); // 按压动画让位给抓起姿态
  const w = $('pet-wrap');
  if (w) w.classList.add(aim ? 'aim' : 'grabbed');
  setPose('char_surprise');
  playGrab();
}

function endGrabVisual() {
  const w = $('pet-wrap');
  if (w) w.classList.remove('grabbed', 'aim');
}

function cancelFling() {
  if (flingRaf) cancelAnimationFrame(flingRaf);
  flingRaf = null;
  fling.active = false;
  api.collisionVelocity(0, 0);
  const w = $('pet-wrap');
  if (w) {
    w.classList.remove('throw');
    w.style.removeProperty('--spin');
  }
}

async function startFling(vx, vy) {
  cancelFling();
  const geom = await api.getGeom();
  if (!geom) {
    petOnDragEnd();
    return;
  }
  let { x, y, width, height } = geom.bounds;
  const wa = geom.workArea;
  const w = $('pet-wrap');
  if (w) w.classList.add('throw');
  let spin = 0;
  fling.active = true;
  fling.vx = vx;
  fling.vy = vy;

  const step = () => {
    fling.vx *= FRICTION;
    fling.vy *= FRICTION;
    vx = fling.vx;
    vy = fling.vy;
    x += vx;
    y += vy;
    let bounced = false;
    if (x <= wa.x) {
      x = wa.x;
      vx = Math.abs(vx) * RESTITUTION;
      bounced = true;
    } else if (x + width >= wa.x + wa.width) {
      x = wa.x + wa.width - width;
      vx = -Math.abs(vx) * RESTITUTION;
      bounced = true;
    }
    if (y <= wa.y) {
      y = wa.y;
      vy = Math.abs(vy) * RESTITUTION;
      bounced = true;
    } else if (y + height >= wa.y + wa.height) {
      y = wa.y + wa.height - height;
      vy = -Math.abs(vy) * RESTITUTION;
      bounced = true;
    }
    spin += vx * 0.35;
    if (w) w.style.setProperty('--spin', `${spin.toFixed(1)}deg`);
    api.setWindowPos(Math.round(x), Math.round(y));
    api.collisionVelocity(fling.vx, fling.vy); // 多开碰撞用
    if (bounced) petOnBounce();
    if (Math.hypot(vx, vy) < STOP_SPEED) {
      cancelFling();
      petOnDragEnd();
      return;
    }
    flingRaf = requestAnimationFrame(step);
  };
  flingRaf = requestAnimationFrame(step);
}

/** 弹弓发射：方向取松手瞬时速度，几乎静止时朝面向斜上方发射；拉距决定力度档位 */
function slingshot(vx, vy, tier) {
  const sp = Math.hypot(vx, vy);
  if (sp < 1) {
    vx = getFacing() === 'left' ? -10 : 10;
    vy = -22;
  } else {
    const k = Math.max(SLING_TIERS[tier] ?? 2.4, SLING_MIN / sp);
    vx *= k;
    vy *= k;
  }
  playLaunch(tier);
  spawnSparkles(4 + tier * 2);
  startFling(vx, vy);
}

export function initDrag() {
  const wrap = $('pet-wrap') || $('pet');
  wrap.addEventListener('pointerdown', (e) => {
    if (e.button === 2) {
      // 拖拽中按右键 → 弹弓蓄力（dsh-pet slingshot）
      if (drag?.isPet && !aim) {
        aim = true;
        const w = $('pet-wrap');
        if (w) {
          w.classList.remove('grabbed');
          w.classList.add('aim');
        }
        playPress();
      }
      return;
    }
    if (e.button !== 0) return;
    petOnPress(); // 按下即反馈，之后由 moved 区分点击/拖拽
    startDrag(e, e.currentTarget);
  });
  $('mini-bar').addEventListener('pointerdown', (e) => {
    if (e.button === 0 && e.target.id !== 'mini-expand') startDrag(e, e.currentTarget);
  });

  // 拖拽（尤其蓄力）期间屏蔽右键菜单
  document.addEventListener(
    'contextmenu',
    (e) => {
      if (drag) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    },
    true,
  );

  document.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const now = performance.now();
    const dt = Math.max(8, now - drag.t);
    const dx = e.screenX - drag.x;
    const dy = e.screenY - drag.y;
    if (Math.abs(dx) + Math.abs(dy) > MOVEMENT_THRESHOLD) {
      if (!drag.moved) onGrabStart();
      drag.moved = true;
    }
    if (drag.moved) {
      drag.vx = (dx / dt) * 16.67;
      drag.vy = (dy / dt) * 16.67;
      drag.t = now;
      // 拖拽中朝向随手方向翻转（dsh-pet：拖动转向）
      if (drag.isPet && Math.abs(drag.vx) > 3) setFacing(drag.vx < 0 ? 'left' : 'right');
      api.moveWindow(dx, dy);
      drag.x = e.screenX;
      drag.y = e.screenY;
      if (drag.isPet) api.collisionVelocity(drag.vx, drag.vy); // 拖拽速度上报（碰撞冲量）
      markActivity();
    }
  });

  document.addEventListener('pointerup', (e) => {
    if (!drag) return;
    if (e.button !== 0) return; // 松开右键不结束拖拽（蓄力保持到松左键）
    const vx = drag.vx;
    const vy = drag.vy;
    const moved = drag.moved;
    const wasAim = aim;
    aim = false;
    const mini = document.body.classList.contains('mini');
    try {
      drag.el.releasePointerCapture(drag.pid);
    } catch {
      /* 指针已自动释放 */
    }
    drag = null;
    endGrabVisual();
    markActivity();
    api.collisionVelocity(0, 0); // 松手后速度归零（碰撞用）
    if (!moved && !mini) {
      petOnClick(e);
      return;
    }
    if (moved && !mini && wasAim) {
      const pull = Math.hypot(e.screenX - drag.sx0, e.screenY - drag.sy0);
      slingshot(vx, vy, slingTier(pull));
      return;
    }
    if (moved && !mini && Math.hypot(vx, vy) >= FLING_MIN) {
      startFling(vx, vy);
      return;
    }
    if (moved && !mini) petOnDragEnd();
  });

  // 多开碰撞（对标 dsh-pet「鱼塘碰碰车」）：被撞时咚一声 + 惊讶 + 叠加冲量
  if (window.pet?.on) {
    window.pet.on('collision-hit', ({ impulseX, impulseY }) => {
      playBonk();
      petOnBounce();
      applyImpulse(Number(impulseX) || 0, Number(impulseY) || 0);
    });
  }
}
