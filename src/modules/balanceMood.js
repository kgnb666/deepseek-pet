/**
 * 余额分档心情（对标 dsh-pet「余额分档动画」）：余额跨档时切换姿势 + 台词。
 * 分档逻辑在 src/shared/balanceTiers.mjs（纯函数，含测试）。
 */
import { state } from './state.js';
import { showBubble } from './bubble.js';
import { setPose, spawnHearts } from './pet.js';
import { tierFor } from '../shared/balanceTiers.mjs';
import { playCelebrate, playWarn } from './sound.js';

let lastTierKey = null;
let lastTierIndex = null;

/** 每次余额刷新后调用；跨档时播报 */
export function updateBalanceTier(total, { quiet = false } = {}) {
  void quiet;
  const tier = tierFor(total);
  const prevKey = lastTierKey;
  const prevIndex = lastTierIndex;
  lastTierKey = tier.key;
  lastTierIndex = tier.index;
  if (prevKey === null || prevKey === tier.key) return tier;
  if (state.animationsPaused) return tier;

  const up = tier.index > prevIndex;
  setPose(tier.pose, 5000);
  if (up) {
    playCelebrate();
    spawnHearts(5);
  } else {
    playWarn();
  }
  const line = tier.lines[Math.floor(Math.random() * tier.lines.length)];
  showBubble(
    `${up ? '📈' : '📉'} <b>${tier.label}</b><br>${line}`,
    up ? 'success' : 'warn',
    6000,
  );
  return tier;
}
