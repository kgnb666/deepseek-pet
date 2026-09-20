/**
 * animPlayer —— 三段式帧动画编排器（路线 A 规格的播放侧）。
 *
 * 清单（assets/animations/<STATE>.json，热加载 + 404 缓存）：
 *   { fps, repeat, displayHeight, segments: { entry?, loop, out? } }
 *   兼容旧格式：{ frames: [...] } 或 { sheet: {...} }
 *
 * 播放链：上一状态 out → 本状态 entry → loop（repeat 次；0 = 驻留无限循环）→（有限链结尾）out。
 * 无缝原理：entry 首帧 = out 末帧 = IDLE loop 首帧 = 标准站姿
 * （由 tools/gen-anim-frames.py 保证，tools/validate-anim-assets.mjs 兜底）。
 * 代际令牌 animGen：每次状态切换递增，过期链自动作废，杜绝竞态。
 */

const ANIM_BASE = 'app://./assets/animations/';

export function createAnimPlayer({ animator, getState }) {
  const manifestCache = new Map();
  let animGen = 0;
  let chainActive = false; // 三段链是否驻留中（被打断时才需要补播 outro）

  async function loadAnimManifest(key) {
    if (manifestCache.has(key)) return manifestCache.get(key);
    let manifest = null;
    try {
      const res = await fetch(`${ANIM_BASE}${key}.json`);
      if (res.ok) {
        const raw = await res.json();
        if (raw && (Array.isArray(raw.frames) || raw.sheet || raw.segments)) manifest = raw;
      }
    } catch {
      manifest = null;
    }
    manifestCache.set(key, manifest);
    return manifest;
  }

  const animUrls = (arr) => arr.map((f) => ANIM_BASE + f);

  /** 播放一段（一次性），resolve(false) 表示资源不可用或被停止 */
  function playSegOnce(frames, fps, displayHeight) {
    return new Promise((resolve) => {
      let settled = false;
      const done = (ok) => {
        if (!settled) {
          settled = true;
          resolve(ok);
        }
      };
      animator
        .playSequence(frames, { fps, loop: false, displayHeight, onDone: done, onError: () => done(false) })
        .then((started) => {
          if (!started) done(false);
        });
    });
  }

  /** 三段式主链：entry → loop×repeat（0 = 无限驻留）→ out（仅有限链） */
  async function runStateAnim(key, manifest, gen) {
    const fps = manifest.fps || 24;
    const dh = manifest.displayHeight || 320;
    const segs = manifest.segments;
    const alive = () => gen === animGen && getState() === key;
    chainActive = true;
    if (Array.isArray(segs.entry) && segs.entry.length) {
      const ok = await playSegOnce(animUrls(segs.entry), fps, dh);
      if (!ok || !alive()) return;
    }
    const repeat = manifest.repeat ?? 0;
    if (repeat === 0) {
      if (!alive()) return;
      animator.playSequence(animUrls(segs.loop), { fps, loop: true, displayHeight: dh });
      return; // 驻留：outro 由 transitionAnim 在被打断时补播
    }
    for (let r = 0; r < repeat; r++) {
      const ok = await playSegOnce(animUrls(segs.loop), fps, dh);
      if (!ok || !alive()) return;
    }
    if (Array.isArray(segs.out) && segs.out.length && alive()) {
      await playSegOnce(animUrls(segs.out), fps, dh);
    }
    chainActive = false; // 链自然走完（out 已播），切换时无需再补
  }

  /** 状态切换编排：补播上一状态 outro（收敛回标准站姿）→ 启动本状态动画 */
  async function transitionAnim(from, to, gen, interrupted) {
    if (interrupted && from && from !== to) {
      const m = await loadAnimManifest(from);
      if (gen !== animGen) return;
      if (m?.segments?.out?.length) {
        await playSegOnce(animUrls(m.segments.out), m.fps || 24, m.displayHeight || 320);
        if (gen !== animGen) return;
      }
    }
    const manifest = await loadAnimManifest(to);
    if (!manifest || gen !== animGen || getState() !== to) return;
    if (manifest.sheet) {
      const s = manifest.sheet;
      const scale = Math.min(1, (300 * 1) / s.frameHeight);
      animator.playSheet(
        { image: ANIM_BASE + s.image, frameWidth: s.frameWidth, frameHeight: s.frameHeight, count: s.count, columns: s.columns, scale },
        { fps: manifest.fps || 10, loop: manifest.loop !== false },
      );
      return;
    }
    if (manifest.segments?.loop?.length) {
      await runStateAnim(to, manifest, gen);
      return;
    }
    if (Array.isArray(manifest.frames) && manifest.frames.length) {
      animator.playSequence(animUrls(manifest.frames), {
        fps: manifest.fps || 8,
        loop: manifest.loop !== false,
      });
    }
  }

  /** render 钩子：状态切换时调用（停旧链 → 编排新链） */
  function onStateChange(from, to) {
    const gen = ++animGen;
    const interrupted = chainActive;
    chainActive = false;
    animator.stop();
    void transitionAnim(from, to, gen, interrupted);
  }

  return { onStateChange };
}
