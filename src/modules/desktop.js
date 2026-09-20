/**
 * 桌面体感：鼠标穿透（空区穿透、角色/面板可点）、锁定位置、不透明度同步。
 * 对标 dsh-pet：穿透不丢交互热区；锁定后按住 Shift 仍可拖。
 */
import { state } from './state.js';
import { api } from './api.js';
import { showBubble } from './bubble.js';

const HIT =
  '#pet-wrap, #mini-bar, #panel:not(.hidden), #ctx-menu:not(.hidden), #bubble:not(.hidden), #task-hud:not(.hidden), #quick-chat:not(.hidden), button, input, a, .ctx-item, .tab';

let lastIgnore = null;

function isHit(target) {
  return target instanceof Element && Boolean(target.closest(HIT));
}

function syncIgnore(e) {
  if (!state.settings.clickThrough) {
    if (lastIgnore !== false) {
      api.setIgnoreMouse(false);
      lastIgnore = false;
    }
    return;
  }
  const ignore = !isHit(e.target);
  if (ignore === lastIgnore) return;
  lastIgnore = ignore;
  api.setIgnoreMouse(ignore);
}

export function applyBodyFlags() {
  document.body.classList.toggle('click-through', !!state.settings.clickThrough);
  document.body.classList.toggle('locked', !!state.settings.lockPosition);
}

export async function toggleClickThrough() {
  const next = !state.settings.clickThrough;
  state.settings = await api.saveSettings({ clickThrough: next });
  lastIgnore = null;
  api.setIgnoreMouse(next);
  applyBodyFlags();
  showBubble(
    next ? '已开启鼠标穿透<br>点角色仍可互动，空区点到下层窗口' : '已关闭鼠标穿透',
    'normal',
    2800,
  );
}

export async function toggleLockPosition() {
  const next = !state.settings.lockPosition;
  state.settings = await api.saveSettings({ lockPosition: next });
  applyBodyFlags();
  showBubble(next ? '位置已锁定<br>按住 Shift 仍可拖动' : '位置已解锁，可以拖啦', 'normal', 2800);
}

export function initDesktop() {
  applyBodyFlags();
  if (state.settings.clickThrough) {
    api.setIgnoreMouse(true);
    lastIgnore = true;
  }
  document.addEventListener('pointermove', syncIgnore, true);
  document.addEventListener('pointerdown', syncIgnore, true);
}
