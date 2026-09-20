import { test } from 'node:test';
import assert from 'node:assert/strict';
import { offpeakInfo, fmtCountdown } from '../src/shared/offpeak.mjs';

test('工作日 UTC 07:00（北京 15:00）为高价时段', () => {
  // 2026-09-07 是周一；UTC 07:00 落在 06:00–10:00 高峰
  const r = offpeakInfo(new Date('2026-09-07T07:00:00Z'));
  assert.equal(r.isLow, false);
  assert.ok(r.remainMs > 0);
});

test('工作日 UTC 05:00（北京 13:00 午休）为低价时段', () => {
  const r = offpeakInfo(new Date('2026-09-07T05:00:00Z'));
  assert.equal(r.isLow, true);
});

test('周末全天为低价时段', () => {
  // 2026-09-05 周六、2026-09-06 周日
  assert.equal(offpeakInfo(new Date('2026-09-05T08:00:00Z')).isLow, true);
  assert.equal(offpeakInfo(new Date('2026-09-06T02:00:00Z')).isLow, true);
});

test('高价时段结束点应为当天 10:00 UTC', () => {
  const r = offpeakInfo(new Date('2026-09-07T07:00:00Z'));
  const end = new Date('2026-09-07T10:00:00Z');
  assert.equal(Math.abs(r.remainMs - (end - new Date('2026-09-07T07:00:00Z'))) < 1000, true);
});

test('低价时段指向下一个工作日高峰起点', () => {
  // 周五 UTC 12:00 → 下一个高峰是下周一 01:00 UTC
  const r = offpeakInfo(new Date('2026-09-11T12:00:00Z'));
  const nextMondayPeak = new Date('2026-09-14T01:00:00Z');
  assert.ok(Math.abs(r.remainMs - (nextMondayPeak - new Date('2026-09-11T12:00:00Z'))) < 1000);
});

test('fmtCountdown 格式化', () => {
  assert.equal(fmtCountdown(0), '00:00:00');
  assert.equal(fmtCountdown(3661000), '01:01:01');
  assert.equal(fmtCountdown(-5), '00:00:00');
});
