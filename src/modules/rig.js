/**
 * 自动骨骼 rig（穷人的 Live2D）：加载立绘 PNG，按 alpha 通道做连通域分析，
 * 找出与主体不相连的"可动部件"——呆毛（顶部小块）、鲸鱼跟班（左下小块）、
 * 尾巴（右侧大块，若与身体不相连）——抠成独立图层并给出挂载参数。
 * 渲染层把这些图层叠回原位并施加独立摆动，平设立绘立刻"活"起来。
 * 纯函数 + 图片解码，不依赖具体 DOM 结构。
 */

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`rig: image load failed ${src}`));
    img.src = src;
  });
}

/**
 * @param {string} srcUrl 立绘地址（app://）
 * @param {object} [opts] { displayHeight=300, minArea=60 }
 * @returns {Promise<{layers: Array<{key:string,dataUrl:string,dx:number,bottom:number,width:number,height:number}>}|null>}
 *  dx：图层中心相对立绘中心的水平偏移（显示像素，已按缩放换算）
 *  bottom：图层底边距立绘底边的高度（显示像素）
 */
export async function buildRigLayers(srcUrl, { displayHeight = 300, minArea = 60 } = {}) {
  let img;
  try {
    img = await loadImage(srcUrl);
  } catch {
    return null;
  }
  const W = img.width;
  const H = img.height;
  if (!W || !H || W * H > 4_000_000) return null;
  const scale = displayHeight / H;

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, W, H).data;
  const alphaAt = (x, y) => data[(y * W + x) * 4 + 3];

  // ---- 连通域标记（4 邻接 BFS，栈用 Int32Array 防爆栈） ----
  const labels = new Int32Array(W * H);
  const queue = new Int32Array(W * H);
  const comps = [null];
  let label = 0;
  for (let start = 0; start < W * H; start++) {
    if (labels[start] !== 0 || alphaAt(start % W, (start / W) | 0) < 8) continue;
    label += 1;
    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    labels[start] = label;
    let minX = W;
    let maxX = 0;
    let minY = H;
    let maxY = 0;
    let area = 0;
    while (head < tail) {
      const p = queue[head++];
      const x = p % W;
      const y = (p / W) | 0;
      area += 1;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (x > 0 && labels[p - 1] === 0 && alphaAt(x - 1, y) >= 8) {
        labels[p - 1] = label;
        queue[tail++] = p - 1;
      }
      if (x < W - 1 && labels[p + 1] === 0 && alphaAt(x + 1, y) >= 8) {
        labels[p + 1] = label;
        queue[tail++] = p + 1;
      }
      if (y > 0 && labels[p - W] === 0 && alphaAt(x, y - 1) >= 8) {
        labels[p - W] = label;
        queue[tail++] = p - W;
      }
      if (y < H - 1 && labels[p + W] === 0 && alphaAt(x, y + 1) >= 8) {
        labels[p + W] = label;
        queue[tail++] = p + W;
      }
    }
    comps.push({ id: label, area, minX, maxX, minY, maxY, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2 });
  }

  // ---- 主体 = 最大连通域；其余为候选部件 ----
  let bodyIdx = 1;
  for (let i = 2; i < comps.length; i++) {
    if (comps[i].area > comps[bodyIdx].area) bodyIdx = i;
  }
  const imageArea = W * H;
  const layers = [];

  const cropToDataUrl = (comp) => {
    const pad = 2;
    const x = Math.max(0, comp.minX - pad);
    const y = Math.max(0, comp.minY - pad);
    const w = Math.min(W, comp.maxX + pad) - x;
    const h = Math.min(H, comp.maxY + pad) - y;
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const cc = c.getContext('2d');
    cc.drawImage(canvas, x, y, w, h, 0, 0, w, h); // 从已含 alpha 的画布裁切
    return {
      dataUrl: c.toDataURL('image/png'),
      dx: (x + w / 2 - W / 2) * scale,
      bottom: (H - (y + h)) * scale,
      width: w * scale,
      height: h * scale,
    };
  };

  for (let i = 1; i < comps.length; i++) {
    if (i === bodyIdx) continue;
    const c = comps[i];
    if (c.area < minArea || c.area > imageArea * 0.2) continue;
    const relArea = c.area / imageArea;
    let key = null;
    // 呆毛：顶部区域的小块
    if (c.minY < H * 0.18 && relArea < 0.04) key = 'ahoge';
    // 鲸鱼跟班：左下角的中块
    else if (c.cy > H * 0.75 && c.cx < W * 0.4 && relArea < 0.12) key = 'whale';
    // 尾巴：右侧中下部的大块
    else if (c.cx > W * 0.55 && c.cy > H * 0.5 && relArea < 0.25) key = 'tail';
    if (!key) continue;
    layers.push({ key, ...cropToDataUrl(c) });
  }
  // 同类只留一块（面积最大的）
  const best = {};
  for (const l of layers) {
    if (!best[l.key] || l.width * l.height > best[l.key].width * best[l.key].height) best[l.key] = l;
  }
  const result = Object.values(best);
  return result.length ? { layers: result } : null;
}
