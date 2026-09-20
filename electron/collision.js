/**
 * 多开碰撞物理（主进程）：实例间通过 UDP gossip 互报位置（固定小端口段，
 * 每实例绑定段内第一个空闲端口），30Hz 用共享物理解算重叠并推开自己，
 * 同时把冲量发给渲染层（飞行中叠加到抛掷速度，落地音效 + 惊讶表情）。
 */
const dgram = require('dgram');
const path = require('path');
const { pathToFileURL } = require('url');

// 共享物理模块是 ESM（.mjs），CJS 主进程通过动态 import 加载
const sharedReady = import(pathToFileURL(path.join(__dirname, '../src/shared/collisionPhysics.mjs')).href);

const PORT_BASE = 27891;
const PORT_COUNT = 6; // 最多 6 只猫同屏
const TICK_MS = 33; // ~30Hz 物理
const GOSSIP_MS = 100; // 状态广播间隔
const PEER_TTL_MS = 1200;
const HIT_NOTIFY_COOLDOWN = 280;

function pickPort(socket) {
  return new Promise((resolve, reject) => {
    let idx = 0;
    const tryNext = () => {
      if (idx >= PORT_COUNT) {
        reject(new Error('no free port'));
        return;
      }
      const port = PORT_BASE + idx++;
      socket.once('error', function onError(e) {
        socket.removeListener('error', onError);
        if (e.code === 'EADDRINUSE') tryNext();
        else reject(e);
      });
      socket.bind(port, '127.0.0.1', () => {
        socket.removeAllListeners('error');
        resolve(port);
      });
    };
    tryNext();
  });
}

/**
 * @param {object} ctx
 *   getBounds() → {x,y,width,height}
 *   setWindowBounds(x,y)  碰撞位移直接改窗口位置（飞行中也可，位置覆盖是帧级的）
 *   onHit({impulseX, impulseY, peerName})  通知渲染层
 *   instanceId, instanceName
 * @returns {Promise<object>} 控制器（物理循环在共享模块加载完成后才启动）
 */
async function startCollision({ getBounds, setWindowBounds, onHit, instanceId, instanceName }) {
  const { resolveAabbCollision } = await sharedReady;
  const sock = dgram.createSocket({ type: 'udp4', reuseAddr: false });
  const peers = new Map(); // id → {x,y,w,h,name,port,last}
  let myPort = 0;
  let vel = { x: 0, y: 0 }; // 渲染层上报的速度（拖拽/飞行），用于冲量计算
  let lastNotify = 0;
  let stopped = false;

  try {
    myPort = await pickPort(sock);
  } catch (e) {
    try {
      sock.close();
    } catch {
      /* 未绑定 */
    }
    throw e; // 端口耗尽：本实例放弃碰撞，由调用方降级
  }

  sock.on('message', (buf) => {
    try {
      const msg = JSON.parse(buf.toString('utf8'));
      if (msg.id === instanceId || msg.t !== 's') return;
      const p = peers.get(msg.id) || {};
      peers.set(msg.id, {
        x: msg.x,
        y: msg.y,
        w: msg.w,
        h: msg.h,
        vx: msg.vx || 0,
        vy: msg.vy || 0,
        name: msg.name || 'peer',
        port: p.port || msg.port || 0,
        last: Date.now(),
      });
    } catch {
      /* 非 JSON 包忽略 */
    }
  });

  const send = (obj) => {
    const data = Buffer.from(JSON.stringify({ ...obj, id: instanceId, name: instanceName, port: myPort }));
    for (let i = 0; i < PORT_COUNT; i++) {
      const port = PORT_BASE + i;
      if (port === myPort) continue;
      try {
        sock.send(data, port, '127.0.0.1');
      } catch {
        /* 单点失败忽略 */
      }
    }
  };

  const prune = () => {
    const now = Date.now();
    for (const [id, p] of peers) {
      if (now - p.last > PEER_TTL_MS) peers.delete(id);
    }
  };

  const physics = setInterval(() => {
    if (stopped) return;
    prune();
    const me = getBounds();
    if (!me) return;
    const rect = { x: me.x, y: me.y, w: me.width, h: me.height, vx: vel.x, vy: vel.y };
    let hitInfo = null;
    for (const p of peers.values()) {
      const res = resolveAabbCollision(rect, p);
      if (!res) continue;
      rect.x += res.pushA.x;
      rect.y += res.pushA.y;
      rect.vx += res.impulseA.x;
      rect.vy += res.impulseA.y;
      // 反冲邻居（轻量：仅位移提示，邻居收到后自行做位置修正）
      try {
        sock.send(
          Buffer.from(
            JSON.stringify({
              t: 'p',
              id: instanceId,
              pushX: res.pushB.x,
              pushY: res.pushB.y,
              impX: res.impulseB.x,
              impY: res.impulseB.y,
            }),
          ),
          p.port || PORT_BASE,
          '127.0.0.1',
        );
      } catch {
        /* 忽略 */
      }
      if (Math.abs(res.impulseA.x) + Math.abs(res.impulseA.y) > 0.5) {
        hitInfo = { impulseX: res.impulseA.x, impulseY: res.impulseA.y, peerName: p.name };
      }
    }
    if (hitInfo && Date.now() - lastNotify > HIT_NOTIFY_COOLDOWN) {
      lastNotify = Date.now();
      onHit(hitInfo);
    }
    const changed = rect.x !== me.x || rect.y !== me.y;
    if (changed) setWindowBounds(Math.round(rect.x), Math.round(rect.y));
    vel.x = rect.vx;
    vel.y = rect.vy;
  }, TICK_MS);

  const gossip = setInterval(() => {
    if (stopped) return;
    const me = getBounds();
    if (!me) return;
    send({ t: 's', x: me.x, y: me.y, w: me.width, h: me.height, vx: vel.x, vy: vel.y });
  }, GOSSIP_MS);

  return {
    /** 渲染层每帧上报自身速度（拖拽 / 抛掷中），用于碰撞冲量 */
    setVelocity(x, y) {
      vel.x = Number(x) || 0;
      vel.y = Number(y) || 0;
    },
    /** 处理邻居发来的反冲包 */
    handlePush(msg) {
      const me = getBounds();
      if (!me) return;
      setWindowBounds(Math.round(me.x + msg.pushX), Math.round(me.y + msg.pushY));
      vel.x += Number(msg.impX) || 0;
      vel.y += Number(msg.impY) || 0;
      if (Date.now() - lastNotify > HIT_NOTIFY_COOLDOWN) {
        lastNotify = Date.now();
        onHit({ impulseX: msg.impX, impulseY: msg.impY, peerName: 'peer' });
      }
    },
    isPush(msg) {
      return msg && msg.t === 'p';
    },
    stop() {
      stopped = true;
      clearInterval(physics);
      clearInterval(gossip);
      try {
        sock.close();
      } catch {
        /* 已关闭 */
      }
    },
  };
}

module.exports = { startCollision, PORT_BASE, PORT_COUNT };
