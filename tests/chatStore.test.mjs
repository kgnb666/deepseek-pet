import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ChatStore } from '../electron/chatStore.js';

function tmpUserData() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'dsp-chats-'));
}

let dir;
beforeEach(() => {
  dir = tmpUserData();
});

test('创建会话并持久化', () => {
  const store = new ChatStore(dir);
  const s = store.create({ title: '新会话' });
  assert.ok(s.id);
  const store2 = new ChatStore(dir); // 重新加载验证持久化
  assert.equal(store2.list().length, 1);
});

test('首条用户消息自动作为标题', () => {
  const store = new ChatStore(dir);
  const s = store.create();
  store.appendMessage(s.id, { role: 'user', content: '帮我写个快速排序算法谢谢' });
  assert.equal(store.get(s.id).title, '帮我写个快速排序算法谢谢');
});

test('置顶会话排在最前，其余按更新时间倒序', () => {
  const store = new ChatStore(dir);
  const a = store.create({ title: 'A' });
  const b = store.create({ title: 'B' });
  const c = store.create({ title: 'C' });
  store.update(b.id, { pinned: true });
  store.appendMessage(a.id, { role: 'user', content: 'hi' }); // a 更新时间最新
  const titles = store.list().map((s) => s.title);
  assert.deepEqual(titles, ['B', 'A', 'C']);
  void c;
});

test('批量删除', () => {
  const store = new ChatStore(dir);
  const ids = [store.create().id, store.create().id, store.create().id];
  store.removeMany(ids.slice(0, 2));
  assert.equal(store.list().length, 1);
  assert.equal(store.get(ids[2]).id, ids[2]);
});

test('清空消息保留会话', () => {
  const store = new ChatStore(dir);
  const s = store.create();
  store.appendMessage(s.id, { role: 'user', content: 'hello' });
  store.appendMessage(s.id, { role: 'assistant', content: 'hi' });
  store.clearMessages(s.id);
  assert.equal(store.get(s.id).messages.length, 0);
});

test('消息条数上限裁剪', () => {
  const store = new ChatStore(dir);
  const s = store.create();
  for (let i = 0; i < 505; i++) {
    store.appendMessage(s.id, { role: 'user', content: `m${i}` });
  }
  assert.ok(store.get(s.id).messages.length <= 500);
  assert.equal(store.get(s.id).messages.at(-1).content, 'm504');
});
