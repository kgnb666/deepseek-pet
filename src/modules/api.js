/**
 * 主进程 IPC 封装：渲染层所有跨进程调用都集中在这里
 */
import { CONSOLE_URL } from './state.js';

const bridge = () => window.pet;

export const api = {
  getSettings: () => bridge().getSettings(),
  saveSettings: (patch) => bridge().saveSettings(patch),
  fetchBalance: () => bridge().fetchBalance(),
  getPrices: () => bridge().getPrices(),
  getVersion: () => bridge().getVersion(),
  getInstance: () => bridge().getInstance(),

  openConsole: () => bridge().openExternal(CONSOLE_URL),

  moveWindow: (dx, dy) => bridge().moveWindow(dx, dy),
  getGeom: () => bridge().getGeom(),
  setWindowPos: (x, y) => bridge().setWindowPos(x, y),
  setMini: (on) => bridge().setMini(on),
  hideWindow: () => bridge().hideWindow(),
  setIgnoreMouse: (on) => bridge().setIgnoreMouse(on),
  quit: () => bridge().quit(),

  /** 订阅主进程推送事件（频道白名单见 preload.js） */
  on: (channel, cb) => bridge().on(channel, cb),

  // ---------- 系统通知 / 识屏 / 更新 ----------
  notify: (title, body) => bridge().notify(title, body),
  getForegroundWindow: () => bridge().getForegroundWindow(),
  screenAsk: (question) => bridge().screenAsk(question),
  checkUpdate: () => bridge().checkUpdate(),

  // ---------- AI Provider ----------
  providersList: () => bridge().providersList(),
  providersUpsert: (p) => bridge().providersUpsert(p),
  providersRemove: (id) => bridge().providersRemove(id),
  providersSetActive: (id) => bridge().providersSetActive(id),

  // ---------- 聊天 ----------
  quickChat: (text) => bridge().quickChat(text),
  chatOpenWindow: () => bridge().chatOpenWindow(),
  chatSetFollow: (on) => bridge().chatSetFollow(on),

  // ---------- 热加载素材 / 多开 ----------
  charactersList: () => bridge().charactersList(),
  soundpacksList: () => bridge().soundpacksList(),
  openSoundsFolder: () => bridge().openSoundsFolder(),
  openCharactersFolder: () => bridge().openCharactersFolder(),
  collisionVelocity: (x, y) => bridge().collisionVelocity(x, y),
  spawnPet: () => bridge().spawnPet(),
};
