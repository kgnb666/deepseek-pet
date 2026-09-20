const { contextBridge, ipcRenderer } = require('electron');

// 渲染层允许订阅的主进程事件白名单
const SUBSCRIBABLE = [
  'toggle-animations',
  'tray-toggle-mini',
  'panel-open',
  'win-visibility',
  'tray-toggle-through',
  'tray-toggle-lock',
  'tray-check-update',
  'agent-event',
  'quick-chat-delta',
  'collision-hit',
  'hot-assets-changed',
  // 聊天窗专用
  'chat-delta',
];

// ---- 参数校验：所有跨进程入参都必须先过滤，防止渲染层传脏数据 ----
const isFiniteNumber = (v) => typeof v === 'number' && Number.isFinite(v);
const isPlainObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const isString = (v) => typeof v === 'string';

contextBridge.exposeInMainWorld('pet', {
  // ---------- 基础 ----------
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (s) => ipcRenderer.invoke('save-settings', isPlainObject(s) ? s : {}),
  fetchBalance: () => ipcRenderer.invoke('fetch-balance'),
  getPrices: () => ipcRenderer.invoke('get-prices'),
  getVersion: () => ipcRenderer.invoke('get-version'),
  getInstance: () => ipcRenderer.invoke('get-instance'),
  openExternal: (url) => {
    if (isString(url)) ipcRenderer.send('open-external', url);
  },
  moveWindow: (dx, dy) => {
    if (isFiniteNumber(dx) && isFiniteNumber(dy)) ipcRenderer.send('win-move', { dx, dy });
  },
  getGeom: () => ipcRenderer.invoke('get-geom'),
  setWindowPos: (x, y) => {
    if (isFiniteNumber(x) && isFiniteNumber(y)) ipcRenderer.send('win-set-pos', { x, y });
  },
  setMini: (on) => {
    if (typeof on === 'boolean') ipcRenderer.send('set-mini', on);
  },
  hideWindow: () => ipcRenderer.send('win-hide'),
  setIgnoreMouse: (on) => {
    if (typeof on === 'boolean') ipcRenderer.send('set-ignore-mouse', on);
  },
  quit: () => ipcRenderer.send('quit'),
  on: (channel, cb) => {
    if (SUBSCRIBABLE.includes(channel) && typeof cb === 'function') {
      ipcRenderer.on(channel, (_e, ...args) => cb(...args));
    }
  },

  // ---------- 系统通知 / 识屏 / 更新 ----------
  notify: (title, body) => {
    if (isString(title) && isString(body)) ipcRenderer.send('notify', { title, body });
  },
  getForegroundWindow: () => ipcRenderer.invoke('foreground-window'),
  screenAsk: (question) => ipcRenderer.invoke('screen-ask', { question: isString(question) ? question : '' }),
  checkUpdate: () => ipcRenderer.invoke('update-check'),

  // ---------- AI Provider ----------
  providersList: () => ipcRenderer.invoke('providers-list'),
  providersUpsert: (p) => ipcRenderer.invoke('providers-upsert', isPlainObject(p) ? p : {}),
  providersRemove: (id) => ipcRenderer.invoke('providers-remove', isString(id) ? id : ''),
  providersSetActive: (id) => ipcRenderer.invoke('providers-set-active', isString(id) ? id : ''),

  // ---------- 聊天会话 ----------
  chatList: () => ipcRenderer.invoke('chat-list'),
  chatCreate: (opts) => ipcRenderer.invoke('chat-create', isPlainObject(opts) ? opts : {}),
  chatGet: (id) => ipcRenderer.invoke('chat-get', isString(id) ? id : ''),
  chatUpdate: (id, patch) => {
    if (isString(id) && isPlainObject(patch)) ipcRenderer.invoke('chat-update', { id, patch });
    return Promise.resolve(null);
  },
  chatDelete: (id) => ipcRenderer.invoke('chat-delete', isString(id) ? id : ''),
  chatDeleteMany: (ids) => ipcRenderer.invoke('chat-delete-many', Array.isArray(ids) ? ids.filter(isString) : []),
  chatClear: (id) => ipcRenderer.invoke('chat-clear', isString(id) ? id : ''),
  chatSend: (sessionId, content) => {
    if (isString(sessionId) && isString(content)) return ipcRenderer.invoke('chat-send', { sessionId, content });
    return Promise.resolve({ ok: false, error: '参数不完整' });
  },
  chatAbort: (requestId) => {
    if (isString(requestId)) ipcRenderer.send('chat-abort', requestId);
  },
  quickChat: (text) => {
    if (isString(text)) return ipcRenderer.invoke('quick-chat', { text });
    return Promise.resolve({ ok: false, error: 'empty' });
  },
  chatOpenWindow: () => ipcRenderer.send('chat-open-window'),
  chatCloseWindow: () => ipcRenderer.send('chat-close-window'),
  chatSetFollow: (on) => ipcRenderer.invoke('chat-set-follow', Boolean(on)),
  chatWindowBounds: (bounds) => {
    if (isPlainObject(bounds)) ipcRenderer.invoke('chat-window-bounds', bounds);
  },

  // ---------- 热加载素材 ----------
  charactersList: () => ipcRenderer.invoke('characters-list'),
  soundpacksList: () => ipcRenderer.invoke('soundpacks-list'),
  openSoundsFolder: () => ipcRenderer.send('open-sounds-folder'),
  openCharactersFolder: () => ipcRenderer.send('open-characters-folder'),

  // ---------- 多开碰撞 ----------
  collisionVelocity: (x, y) => {
    if (isFiniteNumber(x) && isFiniteNumber(y)) ipcRenderer.send('collision-velocity', { x, y });
  },
  spawnPet: () => ipcRenderer.send('spawn-pet'),
});
