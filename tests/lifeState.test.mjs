import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  getLifeState,
  pickIdleAction,
  maybeStateReminder,
  resetLifeStateTimers,
  IDLE_POOLS,
  REMINDER_COOLDOWNS,
} from '../src/modules/lifeState.js';

test('空闲动作池权重和为 1 且五个动作齐全', () => {
  for (const [key, pool] of Object.entries(IDLE_POOLS)) {
    const sum = Object.values(pool).reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(sum - 1) < 1e-9, `${key} 池权重和为 ${sum}`);
    for (const action of ['nap', 'roll', 'charm', 'stretch', 'lie']) {
      assert.ok(action in pool, `${key} 池缺动作 ${action}`);
    }
  }
});

test('任务进行中优先级最高（引擎不抢 taskAnim 的姿势）', () => {
  assert.equal(getLifeState({ taskStatus: 'working', hour: 12, isLow: true }).key, 'task');
  assert.equal(getLifeState({ taskStatus: 'thinking', hour: 2, isLow: true }).key, 'task');
  assert.equal(getLifeState({ taskStatus: 'working' }).pool, null);
});

test('深夜优先于余额/时段判断', () => {
  assert.equal(getLifeState({ hour: 23, isLow: true, balance: 5 }).key, 'night');
  assert.equal(getLifeState({ hour: 2, isLow: false, balance: 500 }).key, 'night');
});

test('余额告急（欠费/低于10）在非深夜时优先于时段', () => {
  assert.equal(getLifeState({ hour: 12, isLow: true, balance: -3 }).key, 'broke');
  assert.equal(getLifeState({ hour: 12, isLow: false, balance: 9.9 }).key, 'broke');
  assert.equal(getLifeState({ hour: 12, isLow: false, balance: 50 }).key, 'peak');
});

test('低价时段 / 余额未知时的兜底', () => {
  assert.equal(getLifeState({ hour: 12, isLow: true, balance: 100 }).key, 'offpeak');
  assert.equal(getLifeState({ hour: 12, isLow: true, balance: null }).key, 'offpeak');
  assert.equal(getLifeState({ hour: 12, isLow: false, balance: null }).key, 'peak');
});

test('pickIdleAction 只返回池内动作', () => {
  for (const pool of Object.values(IDLE_POOLS)) {
    for (let i = 0; i < 300; i++) {
      const pick = pickIdleAction(pool);
      assert.ok(pool[pick] !== undefined, `非法动作 ${pick}`);
    }
  }
});

test('pickIdleAction 极端权重尊重分布', () => {
  const pool = { nap: 0, roll: 0, charm: 1, stretch: 0, lie: 0 };
  for (let i = 0; i < 50; i++) assert.equal(pickIdleAction(pool, Math.random), 'charm');
  // 确定性 rng
  let seq = [0.9, 0.1];
  let idx = 0;
  const rng = () => seq[idx++ % seq.length];
  assert.equal(pickIdleAction(pool, rng), 'charm');
  idx = 0;
});

test('状态举牌：首次触发、随后冷却、任务中不触发', () => {
  resetLifeStateTimers();
  const now = Date.now();
  const offpeak = { key: 'offpeak' };
  const first = maybeStateReminder(offpeak, now);
  assert.ok(first, '首次应触发');
  assert.equal(first.pose, 'char_sign');
  assert.ok(maybeStateReminder(offpeak, now + 1000) === null, '冷却中不应触发');

  resetLifeStateTimers();
  assert.ok(maybeStateReminder({ key: 'task' }, now) === null, '任务中不举牌');
});

test('各状态举牌姿势与素材对应', () => {
  resetLifeStateTimers();
  const now = Date.now();
  assert.equal(maybeStateReminder({ key: 'broke' }, now).pose, 'char_alert');
  resetLifeStateTimers();
  assert.equal(maybeStateReminder({ key: 'peak' }, now).pose, 'char_lie');
  resetLifeStateTimers();
  assert.equal(maybeStateReminder({ key: 'night' }, now).pose, 'char_lie');
  // normal 无举牌配置
  resetLifeStateTimers();
  assert.equal(maybeStateReminder({ key: 'normal' }, now), null);
});

test('冷却配置覆盖所有可举牌状态', () => {
  for (const key of ['broke', 'offpeak', 'peak', 'night']) {
    const [min, max] = REMINDER_COOLDOWNS[key];
    assert.ok(min >= 60_000 && max > min, `${key} 冷却配置不合理`);
  }
});
