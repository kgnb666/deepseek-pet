/**
 * FrameAnimator —— 帧动画控制器（唯一接触 DOM 的动画层）。
 *
 * 双模式：
 *  - playSequence(frames, opts)  序列帧：逐帧切换 <img> 的 src（透明 PNG/WebP 序列）
 *  - playSheet(cfg, opts)        雪碧图：按帧宽高步进 background-position（专用图层 #pet-sheet）
 *
 * 约束：
 *  - 与 setPose 共用 #pet 元素；play 前 stop() 恢复底层立绘；
 *  - 播放参数由 FSM 状态元数据/动画清单（assets/animations/<STATE>.json）驱动；
 *  - 序列帧预加载，单帧失败即中止并回调 onError，由上层回退到静态姿势。
 */
export class FrameAnimator {
  constructor({ imgEl, sheetEl, getPaused = () => false } = {}) {
    this.imgEl = imgEl;
    this.sheetEl = sheetEl;
    this.getPaused = getPaused;
    this._timer = null;
    this.playing = false;
    this._mode = null;
    this._failedUrls = new Set(); // 404 记忆，避免重复请求
  }

  /** 序列帧播放。返回 false 表示资源不可用（未开始播放）。 */
  async playSequence(frames, { fps = 8, loop = false, displayHeight = 0, onDone, onError } = {}) {
    if (!this.imgEl || !Array.isArray(frames) || frames.length === 0) return false;
    const urls = frames.filter((f) => typeof f === 'string' && !this._failedUrls.has(f));
    if (urls.length === 0) return false;
    const ok = await this._preload(urls);
    if (!ok) {
      onError?.('frames failed to load');
      return false;
    }
    this._begin('sequence', displayHeight);
    let i = 0;
    const tick = () => {
      if (this.getPaused()) return; // 暂停动画时冻结在当前帧
      this.imgEl.src = urls[i];
      i += 1;
      if (i >= urls.length) {
        if (loop) {
          i = 0;
        } else {
          this._finish();
          onDone?.(true);
        }
      }
    };
    tick();
    this._timer = setInterval(tick, Math.max(33, 1000 / fps));
    return true;
  }

  /**
   * 雪碧图播放。
   * @param {object} cfg {image, frameWidth, frameHeight, count, columns?} 列数缺省 = count（单行）
   */
  playSheet(cfg, { fps = 10, loop = false, onDone, onError } = {}) {
    if (!this.sheetEl || !cfg?.image || !(cfg.count > 0) || !(cfg.frameWidth > 0) || !(cfg.frameHeight > 0)) {
      onError?.('invalid sheet config');
      return false;
    }
    if (this._failedUrls.has(cfg.image)) {
      onError?.('sheet failed to load');
      return false;
    }
    const cols = cfg.columns > 0 ? cfg.columns : cfg.count;
    this._begin('sheet');
    this.imgEl.classList.add('hidden');
    this.sheetEl.classList.remove('hidden');
    this.sheetEl.style.backgroundImage = `url("${cfg.image}")`;
    this.sheetEl.style.width = `${cfg.frameWidth}px`;
    this.sheetEl.style.height = `${cfg.frameHeight}px`;
    // 原始帧尺寸大于显示区（300px 高）时整体缩放，底部锚定
    if (cfg.scale && cfg.scale !== 1) {
      this.sheetEl.style.transformOrigin = '50% 100%';
      this.sheetEl.style.transform = `translateX(-50%) scale(${cfg.scale})`;
    } else {
      this.sheetEl.style.transform = 'translateX(-50%)';
    }
    let i = 0;
    const tick = () => {
      if (this.getPaused()) return;
      const col = i % cols;
      const row = Math.floor(i / cols);
      this.sheetEl.style.backgroundPosition = `-${col * cfg.frameWidth}px -${row * cfg.frameHeight}px`;
      i += 1;
      if (i >= cfg.count) {
        if (loop) {
          i = 0;
        } else {
          this._finish();
          onDone?.(true);
        }
      }
    };
    tick();
    this._timer = setInterval(tick, Math.max(33, 1000 / fps));
    return true;
  }

  /** 停止播放并恢复静态立绘显示 */
  stop() {
    this._finish();
  }

  // ---------- 内部 ----------

  _begin(mode, displayHeight = 0) {
    clearInterval(this._timer);
    this._timer = null;
    this.playing = true;
    this._mode = mode;
    if (mode === 'sequence') {
      this.sheetEl?.classList.add('hidden');
      this.imgEl?.classList.remove('hidden');
      // 序列帧是整幅画布（含锚点以下区域）：按清单指定高度显示，使脚底锚点与静态立绘基线对齐
      if (displayHeight > 0 && this.imgEl) {
        this._prevHeight = this.imgEl.style.height;
        this.imgEl.style.height = `${displayHeight}px`;
      }
      // 帧内已烘焙接触阴影，隐藏 CSS 地面阴影避免叠影
      document.body.classList.add('anim-baked-shadow');
    }
  }

  _finish() {
    clearInterval(this._timer);
    this._timer = null;
    this.playing = false;
    this._mode = null;
    if (this.imgEl && this._prevHeight !== undefined) {
      this.imgEl.style.height = this._prevHeight;
      this._prevHeight = undefined;
    }
    document.body.classList.remove('anim-baked-shadow');
    if (this.sheetEl && this.imgEl) {
      this.sheetEl.classList.add('hidden');
      this.imgEl.classList.remove('hidden');
    }
  }

  /** 预加载全部帧；任一失败记入黑名单并返回 false */
  _preload(urls) {
    return Promise.all(
      urls.map(
        (url) =>
          new Promise((resolve) => {
            const img = new Image();
            img.onload = () => resolve(true);
            img.onerror = () => {
              this._failedUrls.add(url);
              resolve(false);
            };
            img.src = url;
          }),
      ),
    ).then((results) => results.every(Boolean));
  }
}
