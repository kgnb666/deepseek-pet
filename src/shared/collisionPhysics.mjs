/**
 * 多开碰撞物理（纯函数）：AABB 最小平移向量分离 + 沿法线的等质量弹性冲量。
 * 主进程 UDP 收到邻居状态后调用，把分离量直接应用到窗口坐标。
 */

/**
 * 解析两个 AABB 矩形的碰撞。
 * @param {{x:number,y:number,w:number,h:number,vx?:number,vy?:number}} a
 * @param {{x:number,y:number,w:number,h:number,vx?:number,vy?:number}} b
 * @returns {null | {
 *   nx: number, ny: number,       // 法线方向（a → b）
 *   overlap: number,              // 重叠深度
 *   pushA: {x:number,y:number},   // a 需要的位移（负法线方向）
 *   pushB: {x:number,y:number},   // b 需要的位移（正法线方向）
 *   impulseA: {x:number,y:number},// a 的速度增量
 *   impulseB: {x:number,y:number},// b 的速度增量
 * }}
 */
export function resolveAabbCollision(a, b) {
  const overlapX = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const overlapY = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  if (overlapX <= 0 || overlapY <= 0) return null;

  // 法线取重叠更小的轴，方向 a → b
  let nx = 0;
  let ny = 0;
  if (overlapX <= overlapY) {
    nx = a.x + a.w / 2 <= b.x + b.w / 2 ? 1 : -1;
  } else {
    ny = a.y + a.h / 2 <= b.y + b.h / 2 ? 1 : -1;
  }
  const overlap = Math.min(overlapX, overlapY);

  // 沿法线的相对速度（b 相对 a）
  const relVn = (b.vx ?? 0) * nx + (b.vy ?? 0) * ny - ((a.vx ?? 0) * nx + (a.vy ?? 0) * ny);
  const restitution = 0.55;
  // 等质量弹性碰撞：标量冲量 j 施加 +n 给 b、-n 给 a（满足恢复系数边界条件）
  const j = (-(1 + restitution) * relVn) / 2;
  const impulseA = { x: -j * nx, y: -j * ny };
  const impulseB = { x: j * nx, y: j * ny };

  return {
    nx,
    ny,
    overlap,
    pushA: { x: (-nx * overlap) / 2, y: (-ny * overlap) / 2 },
    pushB: { x: (nx * overlap) / 2, y: (ny * overlap) / 2 },
    impulseA,
    impulseB,
  };
}

/** 速度是否明显非零（用于决定是否广播状态） */
export function isMoving(vx, vy, eps = 0.01) {
  return Math.abs(vx) > eps || Math.abs(vy) > eps;
}
