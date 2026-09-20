/**
 * 聊天会话存储（主进程）：多会话、置顶、重命名、批量删除。
 * 持久化到 userData/chats.json，原子写入（tmp + rename）。
 */
const path = require('path');
const fs = require('fs');

const MAX_SESSIONS = 200;
const MAX_MESSAGES = 500;

function storePath(userData) {
  return path.join(userData, 'chats.json');
}

function emptyStore() {
  return { sessions: [] };
}

class ChatStore {
  constructor(userData) {
    this.userData = userData;
    try {
      const raw = JSON.parse(fs.readFileSync(storePath(userData), 'utf8'));
      this.data = raw && Array.isArray(raw.sessions) ? raw : emptyStore();
    } catch {
      this.data = emptyStore();
    }
  }

  persist() {
    const p = storePath(this.userData);
    const tmp = `${p}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    fs.renameSync(tmp, p);
  }

  list() {
    // 置顶优先，其余按更新时间倒序
    const sorted = [...this.data.sessions].sort((a, b) => {
      if (!!b.pinned !== !!a.pinned) return b.pinned ? 1 : -1;
      return (b.updatedAt || 0) - (a.updatedAt || 0);
    });
    return sorted.map(({ messages, ...meta }) => ({ ...meta, messageCount: messages.length }));
  }

  get(id) {
    return this.data.sessions.find((s) => s.id === id) || null;
  }

  create({ title = '新会话', providerId = null, model = null, systemPrompt = '' } = {}) {
    const s = {
      id: `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      title: String(title).slice(0, 60),
      providerId,
      model,
      systemPrompt: String(systemPrompt || ''),
      pinned: false,
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    this.data.sessions.unshift(s);
    if (this.data.sessions.length > MAX_SESSIONS) {
      // 超限时淘汰最久未更新的非置顶会话
      const idx = this.data.sessions
        .map((x, i) => ({ i, x }))
        .filter((o) => !o.x.pinned)
        .sort((a, b) => (a.x.updatedAt || 0) - (b.x.updatedAt || 0))[0];
      if (idx) this.data.sessions.splice(idx.i, 1);
    }
    this.persist();
    return s;
  }

  update(id, patch) {
    const s = this.get(id);
    if (!s) return null;
    if (patch.title !== undefined) s.title = String(patch.title).slice(0, 60) || s.title;
    if (patch.providerId !== undefined) s.providerId = patch.providerId;
    if (patch.model !== undefined) s.model = patch.model;
    if (patch.systemPrompt !== undefined) s.systemPrompt = String(patch.systemPrompt || '');
    if (patch.pinned !== undefined) s.pinned = Boolean(patch.pinned);
    s.updatedAt = Date.now();
    this.persist();
    return s;
  }

  appendMessage(id, msg) {
    const s = this.get(id);
    if (!s) return null;
    const m = {
      role: msg.role === 'assistant' ? 'assistant' : 'user',
      content: String(msg.content || '').slice(0, 100_000),
      ts: msg.ts || Date.now(),
    };
    s.messages.push(m);
    if (s.messages.length > MAX_MESSAGES) s.messages.splice(0, s.messages.length - MAX_MESSAGES);
    s.updatedAt = Date.now();
    // 首条用户消息自动作为会话标题
    if (s.title === '新会话' && m.role === 'user') {
      s.title = m.content.replace(/\s+/g, ' ').slice(0, 24) || s.title;
    }
    this.persist();
    return m;
  }

  /** 把助手消息的最终内容写回（流式期间渲染层自持临时文本） */
  finalizeAssistant(id, content) {
    return this.appendMessage(id, { role: 'assistant', content });
  }

  remove(id) {
    const before = this.data.sessions.length;
    this.data.sessions = this.data.sessions.filter((s) => s.id !== id);
    const changed = this.data.sessions.length !== before;
    if (changed) this.persist();
    return changed;
  }

  /** 批量删除（对标 dsh-pet 批量操作） */
  removeMany(ids) {
    const set = new Set(ids);
    const before = this.data.sessions.length;
    this.data.sessions = this.data.sessions.filter((s) => !set.has(s.id));
    const changed = this.data.sessions.length !== before;
    if (changed) this.persist();
    return changed;
  }

  clearMessages(id) {
    const s = this.get(id);
    if (!s) return null;
    s.messages = [];
    s.updatedAt = Date.now();
    this.persist();
    return s;
  }
}

module.exports = { ChatStore };
