import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tierFor, TIERS } from '../src/shared/balanceTiers.mjs';

test('共 6 档', () => {
  assert.equal(TIERS.length, 6);
});

test('边界值落档正确', () => {
  assert.equal(tierFor(-5).key, 'debt');
  assert.equal(tierFor(0).key, 'broke');
  assert.equal(tierFor(9.99).key, 'broke');
  assert.equal(tierFor(10).key, 'tight');
  assert.equal(tierFor(49.9).key, 'tight');
  assert.equal(tierFor(50).key, 'cozy');
  assert.equal(tierFor(199).key, 'cozy');
  assert.equal(tierFor(200).key, 'rich');
  assert.equal(tierFor(999).key, 'rich');
  assert.equal(tierFor(1000).key, 'whale');
});

test('非法输入按 0 处理（broke 档）', () => {
  assert.equal(tierFor(NaN).key, 'broke');
  assert.equal(tierFor(undefined).key, 'broke');
});

test('每档都有姿势与台词', () => {
  for (const t of TIERS) {
    assert.ok(t.pose, `${t.key} 缺 pose`);
    assert.ok(t.lines.length >= 2, `${t.key} 台词不足`);
    assert.ok(t.label);
  }
});
