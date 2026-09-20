/**
 * 轻量事件总线：状态机与动画控制器共用的通知机制。
 * 回调异常互不影响（逐个 try/catch），返回 off 函数便于清理。
 */
export class Emitter {
  constructor() {
    this._handlers = new Map();
  }

  /** 订阅事件，返回取消订阅函数 */
  on(event, fn) {
    if (typeof fn !== 'function') return () => {};
    if (!this._handlers.has(event)) this._handlers.set(event, new Set());
    this._handlers.get(event).add(fn);
    return () => this.off(event, fn);
  }

  off(event, fn) {
    this._handlers.get(event)?.delete(fn);
  }

  emit(event, payload) {
    const set = this._handlers.get(event);
    if (!set) return;
    for (const fn of [...set]) {
      try {
        fn(payload);
      } catch (err) {
        console.error(`[Emitter] ${event} handler error`, err);
      }
    }
  }
}
