/**
 * PetStateMachine —— 桌宠有限状态机核心（纯逻辑，无 DOM，可注入时钟做确定性测试）。
 *
 * 职责：
 *  - 状态切换与优先级仲裁：高 tier 打断低 tier；同 tier 互相替换；低 tier 请求被拒绝；
 *  - 定时器：loop 态到期 → pickIdle 策略随机切换；temp 态到期 → 回退 fallback；
 *    terminal 态到期 → 触发 'exit'（退出动画播完）；
 *  - 活动通知：用户交互时基础态立即回 IDLE 并重置循环计时，功能态/系统态不受点击影响；
 *  - 事件总线：change / interrupt / rejected / exit，供气泡、立绘、HUD 联动。
 *
 * 不负责：渲染、气泡、音效（PetBrain 组合层负责）。
 */
import { PET_STATES, DEFAULT_STATE, isPetState } from './PetState.mjs';
import { Emitter } from './Emitter.mjs';

export class PetStateMachine extends Emitter {
  /**
   * @param {object} [deps]
   * @param {(fn: Function, ms: number) => any} [deps.schedule]  定时器注入（测试用假时钟）
   * @param {(id: any) => void} [deps.cancel]
   * @param {() => number} [deps.now]
   * @param {() => string} [deps.pickIdle]  IDLE 到期后的下一个基础态策略（加权随机）
   */
  constructor(deps = {}) {
    super();
    this.deps = {
      schedule: (fn, ms) => setTimeout(fn, ms),
      cancel: (id) => clearTimeout(id),
      now: () => Date.now(),
      pickIdle: () => 'REST',
      ...deps,
    };
    this.current = DEFAULT_STATE;
    this.enteredAt = this.deps.now();
    this.autoCycle = false; // 用户空闲时才开启待机行为循环（由 PetBrain 驱动）
    this.terminal = false;
    this.fallback = 'IDLE';
    this._timer = null;
  }

  get state() {
    return this.current;
  }

  get meta() {
    return PET_STATES[this.current];
  }

  get tier() {
    return this.meta.tier;
  }

  /**
   * 统一状态切换入口。
   * @param {string} next 目标状态（PetState key）
   * @param {object} [opts]
   * @param {number} [opts.duration]  覆盖默认停留时长（ms）
   * @param {string} [opts.fallback] 覆盖默认回退状态
   * @param {boolean} [opts.force]   无视优先级仲裁（回退定时器/明确抢断用）；同态重入时重置计时
   * @returns {{ok: boolean, changed?: boolean, state: string, from?: string, reason?: string}}
   */
  changeState(next, opts = {}) {
    if (this.terminal) return this._reject(next, 'terminal state locked');
    if (!isPetState(next)) return this._reject(next, 'unknown state');
    const meta = PET_STATES[next];
    const cur = this.meta;
    const same = next === this.current;

    if (same && !opts.force) return { ok: true, changed: false, state: next };
    if (meta.tier < cur.tier && !opts.force) {
      return this._reject(next, `preempted by ${this.current} (tier ${cur.tier} > ${meta.tier})`);
    }

    this._clearTimer();
    const from = this.current;
    this.current = next;
    this.enteredAt = this.deps.now();
    const duration = opts.duration ?? meta.duration ?? 0;
    this.fallback = opts.fallback ?? meta.fallback ?? 'IDLE';

    if (meta.kind === 'terminal') {
      this.terminal = true;
      this._arm(duration, () => {
        this._timer = null;
        this.emit('exit', { from: next, at: this.deps.now() });
      });
    } else if (meta.kind === 'temp' && duration > 0) {
      this._arm(duration, () => this._expire());
    } else if (meta.kind === 'loop' && this.autoCycle && duration > 0) {
      this._arm(duration, () => this._idleCycle());
    }

    if (same && opts.force) {
      this.emit('reenter', { state: next, duration, fallback: this.fallback });
    } else {
      // interrupted：高优先级状态切断了正在进行的低优先级动作
      this.emit('change', {
        from,
        to: next,
        duration,
        fallback: this.fallback,
        interrupted: cur.tier < meta.tier,
        previousKind: cur.kind,
      });
    }
    return { ok: true, changed: true, state: next, from };
  }

  /** 用户交互（点击/拖拽/悬停）：基础态立即回 IDLE；功能态与系统态不受打扰 */
  notifyUserActivity() {
    if (this.terminal) return;
    if (this.tier > 1) return; // 功能态/系统态：点击不打断
    if (this.current !== 'IDLE') {
      this.changeState('IDLE', { force: true });
      return;
    }
    // 已是 IDLE：重置循环计时（用户还在互动，别急着出去玩）
    this._clearTimer();
    this.enteredAt = this.deps.now();
    if (this.autoCycle) {
      this._arm(this.meta.duration ?? 5000, () => this._idleCycle());
    }
  }

  /** 开关待机行为自动循环（用户空闲 ≥60s 时开启）。重复开启不重置已挂的循环计时 */
  setAutoCycle(on) {
    if (this.terminal) return;
    this.autoCycle = Boolean(on);
    if (this.current === 'IDLE' && this.meta.kind === 'loop') {
      if (this.autoCycle) {
        if (!this._timer) this._arm(this.meta.duration ?? 5000, () => this._idleCycle());
      } else {
        this._clearTimer();
      }
    }
  }

  /** 释放（窗口销毁/单测收尾） */
  destroy() {
    this._clearTimer();
    this.terminal = true;
  }

  // ---------- 内部 ----------

  _reject(next, reason) {
    this.emit('rejected', { next, reason, current: this.current });
    return { ok: false, reason, state: this.current };
  }

  _arm(ms, fn) {
    if (ms > 0) this._timer = this.deps.schedule(fn, ms);
  }

  _clearTimer() {
    if (this._timer) {
      this.deps.cancel(this._timer);
      this._timer = null;
    }
  }

  /** temp 态到期：强制回退（fallback 允许从高 tier 回低 tier），时长用目标态默认值 */
  _expire() {
    this._timer = null;
    const to = this.fallback || 'IDLE';
    this.changeState(to, { force: true });
  }

  /** IDLE 到期：按策略随机切到其他基础态 */
  _idleCycle() {
    this._timer = null;
    const next = this.deps.pickIdle();
    // 策略返回的必须是基础态（tier 0），非法值安全落回 REST
    const safe = isPetState(next) && PET_STATES[next].tier === 0 && next !== 'IDLE' ? next : 'REST';
    this.changeState(safe);
  }
}
