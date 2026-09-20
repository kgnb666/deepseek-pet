import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeAgentEvent, parseEventBody } from '../src/shared/agentProtocol.mjs';

test('task 事件：合法状态通过并保留字段', () => {
  const r = normalizeAgentEvent({ type: 'task', status: 'working', title: '构建', progress: 30.4, detail: '编译中' });
  assert.equal(r.ok, true);
  assert.deepEqual(r.event, { type: 'task', status: 'working', title: '构建', progress: 30, detail: '编译中' });
});

test('task 事件：非法状态被拒绝', () => {
  assert.equal(normalizeAgentEvent({ type: 'task', status: 'running' }).ok, false);
  assert.equal(normalizeAgentEvent({ type: 'task' }).ok, false);
});

test('task 事件：progress 钳制到 0–100', () => {
  const r = normalizeAgentEvent({ type: 'task', status: 'working', progress: 999 });
  assert.equal(r.event.progress, 100);
  const r2 = normalizeAgentEvent({ type: 'task', status: 'working', progress: -3 });
  assert.equal(r2.event.progress, 0);
});

test('say 事件：text 必填，level 白名单，ms 有上限', () => {
  assert.equal(normalizeAgentEvent({ type: 'say', text: 'hi' }).ok, true);
  assert.equal(normalizeAgentEvent({ type: 'say' }).ok, false);
  const r = normalizeAgentEvent({ type: 'say', text: 'hi', level: 'success', ms: 999999 });
  assert.equal(r.event.level, 'success');
  assert.equal(r.event.ms, 120000);
  assert.equal(normalizeAgentEvent({ type: 'say', text: 'hi', level: 'xxx' }).event.level, undefined);
});

test('chat 事件：content 也可作为文本字段', () => {
  const r = normalizeAgentEvent({ type: 'chat', content: '你好' });
  assert.equal(r.ok, true);
  assert.equal(r.event.text, '你好');
});

test('mood 事件：只接受四种心情', () => {
  assert.equal(normalizeAgentEvent({ type: 'mood', value: 'happy' }).ok, true);
  assert.equal(normalizeAgentEvent({ type: 'mood', value: 'angry' }).ok, false);
});

test('pose 事件：name 必填，ms 钳制', () => {
  const r = normalizeAgentEvent({ type: 'pose', name: 'char_happy', ms: 99999999 });
  assert.equal(r.ok, true);
  assert.equal(r.event.ms, 60000);
  assert.equal(normalizeAgentEvent({ type: 'pose' }).ok, false);
});

test('think 事件：默认 on=false', () => {
  assert.equal(normalizeAgentEvent({ type: 'think' }).event.on, false);
  assert.equal(normalizeAgentEvent({ type: 'think', on: 1 }).event.on, true);
});

test('未知类型 / 非对象输入被拒绝', () => {
  assert.equal(normalizeAgentEvent({ type: 'boom' }).ok, false);
  assert.equal(normalizeAgentEvent('hi').ok, false);
  assert.equal(normalizeAgentEvent(null).ok, false);
  assert.equal(normalizeAgentEvent([1]).ok, false);
});

test('parseEventBody：对象 / 数组 / JSONL', () => {
  assert.equal(parseEventBody('{"type":"say","text":"a"}').events.length, 1);
  assert.equal(parseEventBody('[{"type":"say","text":"a"}]').events.length, 1);
  const jl = parseEventBody('{"type":"say","text":"a"}\n{"type":"say","text":"b"}');
  assert.equal(jl.events.length, 2);
  assert.equal(parseEventBody('').ok, false);
  assert.equal(parseEventBody('not json').ok, false);
  assert.throws(() => parseEventBody('{"type":'), SyntaxError);
});
