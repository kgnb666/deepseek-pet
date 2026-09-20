/**
 * Agent 联动协议（主进程 HTTP 服务，对标 dsh-pet 的 Agent 联动）：
 * 监听 127.0.0.1，接收 Agent（Claude hooks / ZCode / 任意脚本）投递的事件，
 * 规范化后转发给桌宠渲染层。协议详见 docs/AGENT_PROTOCOL.md。
 */
const http = require('http');
const path = require('path');
const { pathToFileURL } = require('url');

// 共享协议模块是 ESM（.mjs），CJS 主进程通过动态 import 加载
const sharedReady = import(pathToFileURL(path.join(__dirname, '../src/shared/agentProtocol.mjs')).href);

const DEFAULT_PORT = 27890;

async function createAgentServer({ port, token, onEvent, onLog }) {
  const { normalizeAgentEvent, parseEventBody } = await sharedReady;
  const log = onLog || (() => {});

  const server = http.createServer((req, res) => {
    const cors = {
      'Access-Control-Allow-Origin': 'null',
      'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Agent-Token',
      'Content-Type': 'application/json; charset=utf-8',
    };
    if (req.method === 'OPTIONS') {
      res.writeHead(204, cors);
      res.end();
      return;
    }

    // 鉴权：未设置 token 时跳过；支持 header 或 ?token=
    if (token) {
      const urlToken = new URL(req.url, 'http://x').searchParams.get('token');
      if (req.headers['x-agent-token'] !== token && urlToken !== token) {
        res.writeHead(401, cors);
        res.end(JSON.stringify({ ok: false, error: 'invalid token' }));
        return;
      }
    }

    if (req.method === 'GET' && (req.url === '/' || req.url.startsWith('/health'))) {
      res.writeHead(200, cors);
      res.end(JSON.stringify({ ok: true, service: 'deepseek-pet-agent', protocol: 'v1' }));
      return;
    }

    if (req.method !== 'POST') {
      res.writeHead(405, cors);
      res.end(JSON.stringify({ ok: false, error: 'POST only' }));
      return;
    }

    let body = '';
    req.on('data', (c) => {
      body += c;
      if (body.length > 1024 * 512) req.destroy(); // 512KB 上限
    });
    req.on('end', () => {
      let parsed;
      try {
        parsed = parseEventBody(body);
      } catch (e) {
        res.writeHead(400, cors);
        res.end(JSON.stringify({ ok: false, error: `bad JSON: ${e.message}` }));
        return;
      }
      if (!parsed.ok) {
        res.writeHead(400, cors);
        res.end(JSON.stringify({ ok: false, error: parsed.error }));
        return;
      }
      const accepted = [];
      const rejected = [];
      for (const raw of parsed.events) {
        const n = normalizeAgentEvent(raw);
        if (n.ok) {
          // 便捷路由：POST /task 等端点在 body 里不带 type 时已由事件本身描述
          onEvent(n.event);
          accepted.push(n.event.type);
        } else {
          rejected.push({ error: n.error });
        }
      }
      log(`accepted=${accepted.length} rejected=${rejected.length}`);
      res.writeHead(200, cors);
      res.end(JSON.stringify({ ok: rejected.length === 0, accepted: accepted.length, rejected }));
    });
  });

  return {
    listen() {
      return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, '127.0.0.1', () => {
          log(`listening on 127.0.0.1:${port}`);
          resolve();
        });
      });
    },
    close() {
      try {
        server.close();
      } catch {
        /* 已关闭 */
      }
    },
  };
}

async function startAgentLink({ port, token, onEvent, onLog }) {
  const p = Number(port) || DEFAULT_PORT;
  try {
    const server = await createAgentServer({ port: p, token, onEvent, onLog });
    await server.listen();
    return server;
  } catch {
    onLog?.(`port ${p} busy, agent link disabled for this instance`);
    return null;
  }
}

module.exports = { startAgentLink, DEFAULT_PORT };
