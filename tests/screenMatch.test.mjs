import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchesWhitelist } from '../src/shared/screenMatch.mjs';

test('子串匹配（大小写不敏感）', () => {
  assert.equal(matchesWhitelist('Visual Studio Code - README.md', ['code']), true);
  assert.equal(matchesWhitelist('chrome 新标签页', ['Chrome']), true);
  assert.equal(matchesWhitelist('知乎 - 有问题就会有答案', ['知乎']), true);
});

test('* 通配符', () => {
  assert.equal(matchesWhitelist('知乎', ['*乎*']), true);
  assert.equal(matchesWhitelist('Edge', ['C*']), false);
  assert.equal(matchesWhitelist('Code', ['C*']), true);
});

test('空输入 / 空白名单不匹配', () => {
  assert.equal(matchesWhitelist('', ['code']), false);
  assert.equal(matchesWhitelist('anything', []), false);
  assert.equal(matchesWhitelist('anything', undefined), false);
  assert.equal(matchesWhitelist('anything', ['  ']), false);
});

test('任一命中即命中', () => {
  assert.equal(matchesWhitelist('Notepad', ['code', 'pad']), true);
});
