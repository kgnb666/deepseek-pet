/**
 * OpenAI 兼容 LLM 客户端（主进程）：
 * - streamChat：SSE 流式对话（聊天窗 / 快速气泡共用）
 * - chatOnce：非流式一次性回答（识屏 / 主动陪伴 / Agent chat 事件用）
 * 仅依赖 node http/https，可配任意 OpenAI 兼容 baseUrl。
 */
const http = require('http');
const https = require('https');
const { URL } = require('url');

function requestJson(urlStr, options, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const mod = u.protocol === 'http:' ? http : https;
    const req = mod.request(
      {
        hostname: u.hostname,
        port: u.port || (u.protocol === 'http:' ? 80 : 443),
        path: u.pathname + u.search,
        method: options.method || 'GET',
        headers: options.headers || {},
        timeout: options.timeout || 60000,
      },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          let parsed = null;
          try {
            parsed = JSON.parse(data);
          } catch {
            /* 非 JSON 响应 */
          }
          resolve({ status: res.statusCode, body: parsed, raw: data });
        });
      },
    );
    req.on('timeout', () => req.destroy(new Error('请求超时')));
    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

/** 规范化 baseUrl：补协议、去尾部斜杠与 /chat/completions 后缀 */
function normalizeBaseUrl(base) {
  let s = String(base || 'https://api.deepseek.com').trim();
  if (!/^https?:\/\//.test(s)) s = `https://${s}`;
  s = s.replace(/\/+$/, '');
  s = s.replace(/\/chat\/completions$/, '');
  return s;
}

function buildMessages(messages, systemPrompt) {
  const list = [];
  if (systemPrompt && String(systemPrompt).trim()) {
    list.push({ role: 'system', content: String(systemPrompt).trim() });
  }
  for (const m of messages) {
    if (!m || (m.role !== 'user' && m.role !== 'assistant')) continue;
    list.push({ role: m.role, content: m.content });
  }
  return list;
}

/**
 * SSE 流式对话。
 * @param {object} opts {baseUrl, apiKey, model, messages, systemPrompt?, temperature?}
 * @param {(chunk:{delta?:string, done?:boolean, error?:string}) => void} onChunk
 * @returns {{abort: () => void}}
 */
function streamChat(opts, onChunk) {
  const base = normalizeBaseUrl(opts.baseUrl);
  const url = `${base}/chat/completions`;
  const payload = JSON.stringify({
    model: opts.model || 'deepseek-chat',
    messages: buildMessages(opts.messages, opts.systemPrompt),
    stream: true,
    temperature: opts.temperature,
  });
  const u = new URL(url);
  const mod = u.protocol === 'http:' ? http : https;
  let aborted = false;

  const req = mod.request(
    {
      hostname: u.hostname,
      port: u.port || 443,
      path: u.pathname + u.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${opts.apiKey || ''}`,
        Accept: 'text/event-stream',
        'Content-Length': Buffer.byteLength(payload),
      },
      timeout: 120000,
    },
    (res) => {
      if (res.statusCode !== 200) {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          let msg = `API 返回 ${res.statusCode}`;
          try {
            const j = JSON.parse(data);
            msg = j?.error?.message || j?.message || msg;
          } catch {
            /* 保留默认消息 */
          }
          onChunk({ error: msg });
          onChunk({ done: true });
        });
        return;
      }
      let buffer = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        if (aborted) return;
        buffer += chunk;
        let idx;
        while ((idx = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, idx).trim();
          buffer = buffer.slice(idx + 1);
          if (!line.startsWith('data:')) continue;
          const data = line.slice(5).trim();
          if (data === '[DONE]') {
            onChunk({ done: true });
            return;
          }
          try {
            const j = JSON.parse(data);
            const delta = j?.choices?.[0]?.delta?.content;
            if (delta) onChunk({ delta });
          } catch {
            /* 忽略无法解析的行 */
          }
        }
      });
      res.on('end', () => {
        if (!aborted) onChunk({ done: true });
      });
      res.on('error', (e) => {
        if (!aborted) {
          onChunk({ error: e.message });
          onChunk({ done: true });
        }
      });
    },
  );
  req.on('timeout', () => req.destroy(new Error('请求超时')));
  req.on('error', (e) => {
    if (!aborted) {
      onChunk({ error: e.message });
      onChunk({ done: true });
    }
  });
  req.write(payload);
  req.end();

  return {
    abort() {
      aborted = true;
      try {
        req.destroy();
      } catch {
        /* 已销毁 */
      }
      onChunk({ done: true });
    },
  };
}

/** 非流式对话（识屏 / 主动陪伴）。返回文本或抛错。 */
async function chatOnce(opts) {
  const base = normalizeBaseUrl(opts.baseUrl);
  const payload = JSON.stringify({
    model: opts.model,
    messages: buildMessages(opts.messages, opts.systemPrompt),
    stream: false,
    temperature: opts.temperature,
    max_tokens: opts.maxTokens,
  });
  const r = await requestJson(
    `${base}/chat/completions`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${opts.apiKey || ''}`,
      },
      timeout: opts.timeout || 60000,
    },
    payload,
  );
  if (r.status !== 200) {
    const msg = r.body?.error?.message || r.body?.message || `API 返回 ${r.status}`;
    throw new Error(msg);
  }
  const text = r.body?.choices?.[0]?.message?.content;
  if (typeof text !== 'string') throw new Error('响应中没有文本内容');
  return text;
}

module.exports = { streamChat, chatOnce, normalizeBaseUrl };
