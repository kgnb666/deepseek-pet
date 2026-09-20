import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSemver, compareSemver, isNewerVersion } from '../src/shared/semver.mjs';

test('解析各种版本写法', () => {
  assert.deepEqual(parseSemver('1.2.3'), [1, 2, 3]);
  assert.deepEqual(parseSemver('v2.0.0'), [2, 0, 0]);
  assert.deepEqual(parseSemver('V1.10.0'), [1, 10, 0]);
  assert.deepEqual(parseSemver('1.2.3-beta.1'), [1, 2, 3]);
  assert.equal(parseSemver('abc'), null);
  assert.equal(parseSemver('1.2'), null);
});

test('比较：主/次/修订逐位比较', () => {
  assert.equal(compareSemver('2.0.0', '1.9.9'), 1);
  assert.equal(compareSemver('1.10.0', '1.9.0'), 1);
  assert.equal(compareSemver('1.2.4', '1.2.3'), 1);
  assert.equal(compareSemver('1.2.3', '1.2.3'), 0);
  assert.equal(compareSemver('1.2.3', '1.2.4'), -1);
});

test('不可解析版本视为相等（不误报更新）', () => {
  assert.equal(compareSemver('abc', '1.0.0'), 0);
  assert.equal(isNewerVersion('abc', '1.0.0'), false);
});

test('isNewerVersion', () => {
  assert.equal(isNewerVersion('1.11.0', '1.10.0'), true);
  assert.equal(isNewerVersion('1.10.0', '1.10.0'), false);
  assert.equal(isNewerVersion('1.9.9', '1.10.0'), false);
});
