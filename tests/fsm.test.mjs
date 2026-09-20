import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PetStateMachine } from '../src/modules/fsm/PetStateMachine.mjs';
import { PET_STATES, STATE_KEYS, BASE_STATES, FUNCTIONAL_STATES, SYSTEM_STATES } from '../src/modules/fsm/PetState.mjs';

/** 手动时钟：确定性驱动 FSM 定时器（箭头字段保证 this 绑定） */
class ManualClock {
  t = 0;
  jobs = new Map(); // id → {at, fn}
  seq = 0;
  schedule = (fn, ms) => {
    const id = ++this.seq;
    this.jobs.set(id, { at: this.t + ms, fn });
    return id;
  };
  cancel = (id) => {
    this.jobs.delete(id);
  };
  now = () => this.t;
  /** 推进时间，按到期顺序执行到期任务 */
  advance = (ms) => {
    const target = this.t + ms;
    for (;;) {
      let dueId = null;
      let dueAt = Infinity;
      for (const [id, job] of this.jobs) {
        if (job.at <= target && job.at < dueAt) {
          dueId = id;
          dueAt = job.at;
        }
      }
      if (dueId === null) break;
      const { fn } = this.jobs.get(dueId);
      this.jobs.delete(dueId);
      this.t = Math.max(this.t, dueAt);
      fn();
    }
    this.t = target;
  };
}

function makeFSM(overrides = {}) {
  const clock = new ManualClock();
  const fsm = new PetStateMachine({ schedule: clock.schedule, cancel: clock.cancel, now: clock.now, ...overrides });
  return { clock, fsm };
}

test('状态枚举完整性：四大类共 14 态', () => {
  assert.equal(STATE_KEYS.length, 14);
  for (const s of BASE_STATES) assert.ok(PET_STATES[s], `缺基础态 ${s}`);
  for (const s of FUNCTIONAL_STATES) assert.equal(PET_STATES[s].tier, 2, `${s} 应为功能态 tier2`);
  for (const s of SYSTEM_STATES.filter((x) => x !== 'GOODBYE')) assert.equal(PET_STATES[s].tier, 3);
  assert.equal(PET_STATES.GOODBYE.kind, 'terminal');
});

test('初始为 IDLE；未知状态被拒绝', () => {
  const { fsm } = makeFSM();
  assert.equal(fsm.state, 'IDLE');
  const r = fsm.changeState('NOPE');
  assert.equal(r.ok, false);
  assert.equal(fsm.state, 'IDLE');
});

test('默认循环：IDLE 5s → pickIdle 策略 → 临时态 → 到期回 IDLE → 再循环', () => {
  let pickCount = 0;
  const picks = ['REST', 'ROLL'];
  const { clock, fsm } = makeFSM({ pickIdle: () => picks[pickCount++ % picks.length] });
  fsm.setAutoCycle(true);

  clock.advance(5000); // IDLE 到期
  assert.equal(fsm.state, 'REST');
  clock.advance(6000); // REST 6s 到期 → 回 IDLE
  assert.equal(fsm.state, 'IDLE');
  clock.advance(5000); // IDLE 再到期 → ROLL
  assert.equal(fsm.state, 'ROLL');
  clock.advance(2200); // ROLL 2.2s → IDLE
  assert.equal(fsm.state, 'IDLE');
});

test('高优先级打断：ALERT 立即中断 CODING，到期自动回 IDLE', () => {
  const { clock, fsm } = makeFSM();
  const events = [];
  fsm.on('change', (e) => events.push(e));

  fsm.changeState('CODING');
  assert.equal(fsm.state, 'CODING');
  clock.advance(10_000); // 功能态驻留：不被时间打断
  assert.equal(fsm.state, 'CODING');

  const r = fsm.changeState('ALERT'); // tier3 > tier2 → 立即打断
  assert.equal(r.ok, true);
  assert.equal(fsm.state, 'ALERT');
  assert.equal(events.at(-1).interrupted, true);

  clock.advance(4200); // ALERT 4.2s → 回 IDLE
  assert.equal(fsm.state, 'IDLE');
});

test('低优先级请求被拒绝：CODING 期间不能切 REST', () => {
  const { fsm } = makeFSM();
  const rejected = [];
  fsm.on('rejected', (e) => rejected.push(e));
  fsm.changeState('CODING');
  const r = fsm.changeState('REST');
  assert.equal(r.ok, false);
  assert.equal(fsm.state, 'CODING');
  assert.equal(rejected.length, 1);
  // force 可破例（回退/明确抢断）
  assert.equal(fsm.changeState('REST', { force: true }).ok, true);
  assert.equal(fsm.state, 'REST');
});

test('同优先级互相替换：THINKING → CODING → LOADING', () => {
  const { fsm } = makeFSM();
  fsm.changeState('THINKING');
  fsm.changeState('CODING');
  assert.equal(fsm.state, 'CODING');
  fsm.changeState('LOADING');
  assert.equal(fsm.state, 'LOADING');
});

test('自定义时长与回退态：SUCCESS 100ms 后回 WALK（而非默认 IDLE）', () => {
  const { clock, fsm } = makeFSM();
  fsm.changeState('SUCCESS', { duration: 100, fallback: 'WALK' });
  clock.advance(99);
  assert.equal(fsm.state, 'SUCCESS');
  clock.advance(1);
  assert.equal(fsm.state, 'WALK');
});

test('changeState 幂等：同态重复调用不重置计时', () => {
  const { clock, fsm } = makeFSM();
  fsm.setAutoCycle(true);
  clock.advance(3000); // IDLE 已走 3s
  const r = fsm.changeState('IDLE'); // 同态无 force → no-op
  assert.equal(r.changed, false);
  clock.advance(2000); // 再走 2s = 5s → 应触发循环
  assert.notEqual(fsm.state, 'IDLE');
});

test('用户活动：基础态立即回 IDLE；功能态不受点击影响；IDLE 计时被重置', () => {
  const { clock, fsm } = makeFSM({ pickIdle: () => 'ROLL' });
  fsm.setAutoCycle(true);

  fsm.changeState('REST');
  fsm.notifyUserActivity();
  assert.equal(fsm.state, 'IDLE');

  // 活动重置 IDLE 计时：持续活动永不进入循环
  for (let i = 0; i < 6; i++) {
    clock.advance(1000);
    fsm.notifyUserActivity();
  }
  assert.equal(fsm.state, 'IDLE');

  // 功能态：点击不打断
  fsm.changeState('THINKING');
  fsm.notifyUserActivity();
  assert.equal(fsm.state, 'THINKING');
});

test('GOODBYE 终态：播完触发 exit 并锁定状态机', () => {
  const { clock, fsm } = makeFSM();
  let exited = false;
  fsm.on('exit', () => (exited = true));
  fsm.changeState('CODING');
  fsm.changeState('GOODBYE'); // tier4 可打断一切
  assert.equal(fsm.state, 'GOODBYE');
  clock.advance(1800);
  assert.equal(exited, true);
  const r = fsm.changeState('IDLE', { force: true });
  assert.equal(r.ok, false); // 终态锁定
  assert.equal(fsm.state, 'GOODBYE');
});

test('setAutoCycle 开/关：关闭后 IDLE 不再轮换，开启不重复重置计时', () => {
  const { clock, fsm } = makeFSM({ pickIdle: () => 'STRETCH' });
  fsm.setAutoCycle(true);
  clock.advance(2000);
  fsm.setAutoCycle(false);
  clock.advance(10_000);
  assert.equal(fsm.state, 'IDLE'); // 关闭：不轮换
  fsm.setAutoCycle(true);
  clock.advance(3000);
  fsm.setAutoCycle(true); // 重复开启不重置计时
  clock.advance(2000); // 共 5s → 触发
  assert.equal(fsm.state, 'STRETCH');
});

test('回退到高占用态的合法性：ALERT 可自定义 fallback 为功能态', () => {
  const { clock, fsm } = makeFSM();
  fsm.changeState('ALERT', { duration: 50, fallback: 'CODING' });
  clock.advance(50);
  assert.equal(fsm.state, 'CODING');
});

test('WALK 到期 12s 上限回 IDLE（游走卡死兜底）', () => {
  const { clock, fsm } = makeFSM();
  fsm.changeState('WALK');
  clock.advance(12_000);
  assert.equal(fsm.state, 'IDLE');
});

test('协议同步：AGENT_STATE_KEYS 与 PET_STATES 键完全一致', async () => {
  const { AGENT_STATE_KEYS: keys } = await import('../src/shared/agentProtocol.mjs');
  assert.deepEqual([...keys].sort(), [...STATE_KEYS].sort());
});
