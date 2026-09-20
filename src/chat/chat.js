/**
 * AI 聊天工作台（对标 dsh-pet 聊天版）：
 * 多会话（置顶/重命名/搜索/批量删除）、多 Provider、SSE 流式输出、
 * 自定义 System Prompt、主题切换、跟随桌宠。
 */
const $ = (id) => document.getElementById(id);

const state = {
  sessions: [],
  activeId: null,
  providers: null,
  batchMode: false,
  batchSelected: new Set(),
  streaming: null, // {requestId, el, text}
  follow: false,
};

const THEME_KEY = 'chatTheme';

// ---------- 渲染工具 ----------
function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Markdown-lite：代码块 / 行内代码 / 粗体，其余按纯文本换行 */
function renderRich(text) {
  const parts = String(text).split(/```/);
  let html = '';
  parts.forEach((part, i) => {
    if (i % 2 === 1) {
      // 代码块：首行可能是语言名
      const body = part.replace(/^[a-zA-Z0-9_-]*\n?/, '');
      html += `<pre><code>${escapeHtml(body)}</code></pre>`;
    } else {
      let seg = escapeHtml(part);
      seg = seg.replace(/`([^`\n]+)`/g, '<code>$1</code>');
      seg = seg.replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>');
      html += seg.replace(/\n/g, '<br>');
    }
  });
  return html;
}

function fmtTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

// ---------- 会话列表 ----------
async function refreshSessions() {
  state.sessions = await window.pet.chatList();
  renderSessionList();
}

function renderSessionList() {
  const list = $('session-list');
  const kw = $('chat-search').value.trim().toLowerCase();
  const shown = state.sessions.filter((s) => !kw || (s.title || '').toLowerCase().includes(kw));
  list.innerHTML = '';
  if (shown.length === 0) {
    list.innerHTML = '<div class="session-empty">还没有会话<br>点上面「＋ 新会话」开始吧</div>';
    return;
  }
  for (const s of shown) {
    const item = document.createElement('div');
    item.className = `session-item${s.id === state.activeId ? ' active' : ''}${state.batchMode ? ' batch-mode' : ''}`;
    item.innerHTML = `
      ${state.batchMode ? `<input type="checkbox" data-batch="${s.id}" ${state.batchSelected.has(s.id) ? 'checked' : ''}/>` : ''}
      ${s.pinned ? '<span class="s-pin">📌</span>' : ''}
      <span class="s-title" title="${escapeHtml(s.title)}">${escapeHtml(s.title)}</span>
      <span class="s-ops">
        <button data-op="pin" title="置顶/取消">${s.pinned ? '📍' : '📌'}</button>
        <button data-op="rename" title="重命名">✏️</button>
        <button data-op="delete" title="删除">🗑️</button>
      </span>`;
    item.addEventListener('click', async (e) => {
      const op = e.target.dataset?.op;
      if (e.target.dataset?.batch !== undefined) {
        if (state.batchSelected.has(s.id)) state.batchSelected.delete(s.id);
        else state.batchSelected.add(s.id);
        return;
      }
      if (op === 'pin') {
        e.stopPropagation();
        await window.pet.chatUpdate(s.id, { pinned: !s.pinned });
        await refreshSessions();
        return;
      }
      if (op === 'rename') {
        e.stopPropagation();
        const name = prompt('重命名会话', s.title);
        if (name && name.trim()) {
          await window.pet.chatUpdate(s.id, { title: name.trim() });
          await refreshSessions();
        }
        return;
      }
      if (op === 'delete') {
        e.stopPropagation();
        if (confirm(`删除会话「${s.title}」？`)) {
          await window.pet.chatDelete(s.id);
          if (state.activeId === s.id) state.activeId = null;
          await refreshSessions();
          await openSession(state.activeId || state.sessions[0]?.id || null);
        }
        return;
      }
      await openSession(s.id);
    });
    list.appendChild(item);
  }
}

async function openSession(id) {
  state.activeId = id;
  state.streaming = null;
  renderSessionList();
  const box = $('messages');
  box.innerHTML = '';
  if (!id) {
    box.innerHTML = '<div class="messages-empty">选一个会话，或新建一个开始聊天 🐳</div>';
    fillSessionSystem();
    return;
  }
  const s = await window.pet.chatGet(id);
  if (!s) {
    box.innerHTML = '<div class="messages-empty">会话不存在</div>';
    return;
  }
  for (const m of s.messages) appendMessage(m.role, m.content, { ts: m.ts, save: false });
  fillSessionSystem();
  scrollBottom();
}

function appendMessage(role, content, { ts, save = false, streaming = false } = {}) {
  const empty = $('messages').querySelector('.messages-empty');
  if (empty) empty.remove();
  const el = document.createElement('div');
  el.className = `msg ${role}`;
  el.innerHTML = `
    <div class="msg-body">${renderRich(content)}${streaming ? '<span class="cursor"></span>' : ''}</div>
    <div class="meta">${fmtTime(ts)}${
      role === 'assistant' && !streaming
        ? '<span class="msg-ops"><button data-op="copy">复制</button></span>'
        : ''
    }</div>`;
  if (!streaming) {
    el.querySelector('[data-op="copy"]')?.addEventListener('click', () => {
      navigator.clipboard.writeText(content);
    });
  }
  $('messages').appendChild(el);
  scrollBottom();
  return el;
}

function scrollBottom() {
  const box = $('messages');
  box.scrollTop = box.scrollHeight;
}

function fillSessionSystem() {
  const s = state.sessions.find((x) => x.id === state.activeId);
  $('session-system').value = '';
  if (!s) return;
  window.pet.chatGet(s.id).then((full) => {
    $('session-system').value = full?.systemPrompt || '';
  });
}

// ---------- 发送 / 流式 ----------
function setSending(on) {
  const btn = $('btn-send');
  btn.textContent = on ? '■ 停止' : '发送';
  btn.classList.toggle('stop', on);
}

async function sendMessage() {
  if (state.streaming) {
    window.pet.chatAbort(state.streaming.requestId);
    finishStreaming({ done: true });
    return;
  }
  const input = $('chat-input');
  const content = input.value.trim();
  if (!content) return;
  if (!state.activeId) {
    const s = await window.pet.chatCreate({});
    state.sessions.unshift(s);
    state.activeId = s.id;
    renderSessionList();
  }
  input.value = '';
  appendMessage('user', content, { ts: Date.now() });
  const r = await window.pet.chatSend(state.activeId, content);
  if (!r.ok) {
    appendMessage('assistant', `⚠️ ${r.error || '发送失败'}`, { ts: Date.now() });
    return;
  }
  setSending(true);
  const el = appendMessage('assistant', '', { streaming: true });
  state.streaming = { requestId: r.requestId, el, text: '' };
  scrollBottom();
}

function applyDelta(chunk) {
  if (!state.streaming || chunk.requestId !== state.streaming.requestId) return;
  if (chunk.delta) {
    state.streaming.text += chunk.delta;
    state.streaming.el.querySelector('.msg-body').innerHTML =
      renderRich(state.streaming.text) + '<span class="cursor"></span>';
    scrollBottom();
  }
  if (chunk.error) {
    const body = state.streaming.el.querySelector('.msg-body');
    body.innerHTML = renderRich(state.streaming.text || '') + `<div class="msg-error">⚠️ ${escapeHtml(chunk.error)}</div>`;
  }
  if (chunk.done) finishStreaming(chunk);
}

function finishStreaming(chunk) {
  if (!state.streaming) return;
  const { el, text } = state.streaming;
  el.querySelector('.msg-body').innerHTML =
    renderRich(text || '') + (chunk?.error ? `<div class="msg-error">⚠️ ${escapeHtml(chunk.error)}</div>` : '');
  el.querySelector('.meta').innerHTML = `${fmtTime(Date.now())}<span class="msg-ops"><button data-op="copy">复制</button></span>`;
  el.querySelector('[data-op="copy"]')?.addEventListener('click', () => navigator.clipboard.writeText(text));
  state.streaming = null;
  setSending(false);
  refreshSessions(); // 标题/时间可能变了
}

// ---------- Provider ----------
async function refreshProviders() {
  state.providers = await window.pet.providersList();
  renderProviderSelect();
  renderProviderEditor();
}

function renderProviderSelect() {
  const sel = $('provider-select');
  sel.innerHTML = '';
  for (const p of state.providers.providers) {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = `${p.name}（${p.model}）`;
    sel.appendChild(opt);
  }
  sel.value = state.providers.activeId;
}

function providerCardHTML(p = {}) {
  return `
    <div class="provider-card" data-pid="${p.id || ''}">
      <div class="pc-row"><input data-f="name" placeholder="名称" value="${escapeHtml(p.name || '')}"/></div>
      <input data-f="baseUrl" placeholder="Base URL（https://api.deepseek.com）" value="${escapeHtml(p.baseUrl || '')}"/>
      <div class="pc-row">
        <input data-f="model" placeholder="对话模型" value="${escapeHtml(p.model || '')}"/>
        <input data-f="visionModel" placeholder="视觉模型(可选)" value="${escapeHtml(p.visionModel || '')}"/>
      </div>
      <input data-f="apiKey" type="password" placeholder="${p.hasKey ? '已配置 Key（留空保持不变）' : 'API Key（sk-…）'}"/>
      ${p.keyEncrypted ? '<div class="hint">🔒 Key 已加密存储</div>' : ''}
      <div class="pc-ops">
        <button data-op="save">保存</button>
        <button data-op="use" ${p.id === state.providers.activeId ? 'disabled' : ''}>${p.id === state.providers.activeId ? '使用中' : '设为默认'}</button>
        <button data-op="del" class="danger">删除</button>
      </div>
    </div>`;
}

function renderProviderEditor() {
  const wrap = $('provider-editor-list');
  wrap.innerHTML = state.providers.providers.map((p) => providerCardHTML(p)).join('');
  wrap.querySelectorAll('.provider-card').forEach((card) => {
    const pid = card.dataset.pid;
    card.querySelector('[data-op="save"]').onclick = async () => {
      const get = (f) => card.querySelector(`[data-f="${f}"]`).value;
      await window.pet.providersUpsert({
        id: pid || undefined,
        name: get('name'),
        baseUrl: get('baseUrl'),
        model: get('model'),
        visionModel: get('visionModel'),
        apiKey: get('apiKey'),
      });
      await refreshProviders();
      renderProviderSelect();
    };
    card.querySelector('[data-op="use"]').onclick = async () => {
      await window.pet.providersSetActive(pid);
      await refreshProviders();
    };
    card.querySelector('[data-op="del"]').onclick = async () => {
      if (confirm('删除该 Provider？')) {
        await window.pet.providersRemove(pid);
        await refreshProviders();
      }
    };
  });
}

// ---------- 初始化 ----------
async function init() {
  document.body.classList.add(localStorage.getItem(THEME_KEY) || 'theme-blue');

  $('btn-new-chat').onclick = async () => {
    const s = await window.pet.chatCreate({});
    state.sessions.unshift(s);
    await openSession(s.id);
  };
  $('chat-search').addEventListener('input', renderSessionList);
  $('btn-send').onclick = sendMessage;
  $('chat-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });
  $('btn-clear-chat').onclick = async () => {
    if (state.activeId && confirm('清空当前会话的消息？')) {
      await window.pet.chatClear(state.activeId);
      await openSession(state.activeId);
    }
  };
  $('provider-select').addEventListener('change', async (e) => {
    await window.pet.providersSetActive(e.target.value);
    await refreshProviders();
  });

  // 批量管理
  $('btn-batch').onclick = () => {
    state.batchMode = !state.batchMode;
    state.batchSelected.clear();
    $('batch-bar').classList.toggle('hidden', !state.batchMode);
    renderSessionList();
  };
  $('batch-select-all').addEventListener('change', (e) => {
    const kw = $('chat-search').value.trim().toLowerCase();
    for (const s of state.sessions.filter((x) => !kw || x.title.toLowerCase().includes(kw))) {
      if (e.target.checked) state.batchSelected.add(s.id);
      else state.batchSelected.delete(s.id);
    }
    renderSessionList();
  });
  $('btn-batch-delete').onclick = async () => {
    if (state.batchSelected.size === 0) return;
    if (!confirm(`删除选中的 ${state.batchSelected.size} 个会话？`)) return;
    await window.pet.chatDeleteMany([...state.batchSelected]);
    state.batchSelected.clear();
    await refreshSessions();
    await openSession(state.activeId);
  };

  // 会话 System Prompt
  $('btn-save-session').onclick = async () => {
    if (!state.activeId) return;
    await window.pet.chatUpdate(state.activeId, { systemPrompt: $('session-system').value });
    alert('已保存会话设定');
  };

  // 设置抽屉
  $('btn-chat-settings').onclick = () => $('settings-drawer').classList.remove('hidden');
  $('btn-close-drawer').onclick = () => $('settings-drawer').classList.add('hidden');
  $('btn-add-provider').onclick = () => {
    // 先落一个空壳，再刷新编辑器
    window.pet.providersUpsert({ name: '新 Provider', baseUrl: 'https://api.deepseek.com', model: 'deepseek-chat', apiKey: '' }).then(refreshProviders);
  };

  // 主题
  $('btn-theme').onclick = () => $('settings-drawer').classList.remove('hidden');
  document.querySelectorAll('.theme-swatch').forEach((sw) => {
    sw.onclick = () => {
      const theme = sw.dataset.theme;
      document.body.className = theme;
      localStorage.setItem(THEME_KEY, theme);
      document.querySelectorAll('.theme-swatch').forEach((x) => x.classList.toggle('active', x === sw));
    };
    if (localStorage.getItem(THEME_KEY) === sw.dataset.theme) sw.classList.add('active');
  });

  // 跟随桌宠
  const settings = await window.pet.getSettings();
  state.follow = Boolean(settings.chatFollow);
  $('follow-toggle').checked = state.follow;
  $('follow-toggle').addEventListener('change', async (e) => {
    state.follow = await window.pet.chatSetFollow(e.target.checked);
  });

  // 流式事件
  window.pet.on('chat-delta', applyDelta);

  await Promise.all([refreshSessions(), refreshProviders()]);
  const first = state.sessions[0]?.id;
  if (first) await openSession(first);
  else $('messages').innerHTML = '<div class="messages-empty">新建一个会话，开始和小猫聊天吧 🐳</div>';
  $('chat-input').focus();
}

init();
