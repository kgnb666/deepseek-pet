import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveAabbCollision, isMoving } from '../src/shared/collisionPhysics.mjs';

test('不相交返回 null', () => {
  const a = { x: 0, y: 0, w: 100, h: 100 };
  const b = { x: 200, y: 0, w: 100, h: 100 };
  assert.equal(resolveAabbCollision(a, b), null);
});

test('水平重叠沿 X 轴分离', () => {
  const a = { x: 0, y: 0, w: 100, h: 100, vx: 5, vy: 0 };
  const b = { x: 60, y: 0, w: 100, h: 100, vx: 0, vy: 0 };
  const r = resolveAabbCollision(a, b);
  assert.equal(r.nx, 1); // a 在左，法线 a→b 为 +x
  assert.equal(r.ny, 0);
  assert.ok(r.pushA.x < 0); // a 被往左推
  assert.ok(r.pushB.x > 0); // b 被往右推
  assert.ok(Math.abs(r.pushA.x) + Math.abs(r.pushB.x) >= 40); // 覆盖重叠量 40
  assert.ok(r.impulseA.x < 0); // a 向右运动被反弹减速
});

test('垂直重叠沿 Y 轴分离', () => {
  const a = { x: 0, y: 0, w: 100, h: 100 };
  const b = { x: 0, y: 80, w: 100, h: 100 };
  const r = resolveAabbCollision(a, b);
  assert.equal(r.ny, 1);
  assert.equal(r.nx, 0);
  assert.ok(r.pushA.y < 0 && r.pushB.y > 0);
});

test('总分离量等于重叠深度', () => {
  const a = { x: 0, y: 0, w: 100, h: 100 };
  const b = { x: 90, y: 0, w: 100, h: 100 };
  const r = resolveAabbCollision(a, b);
  assert.ok(Math.abs(Math.abs(r.pushA.x) + Math.abs(r.pushB.x) - 10) < 1e-9);
});

test('isMoving 阈值判断', () => {
  assert.equal(isMoving(0, 0), false);
  assert.equal(isMoving(0.001, 0), false);
  assert.equal(isMoving(1, 0), true);
});
