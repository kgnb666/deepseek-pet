/**
 * 角色热加载（渲染层，对标 dsh-pet character hot-load）：
 * userData/characters/<id>/character.json 声明姿势素材（webm 透明视频 / png / gif），
 * 主进程 fs.watch 热更新，本模块拉取列表并把 setPose 解析到外部素材（res:// 协议）。
 */
import { api } from './api.js';

let characters = [];
const listeners = new Set();

export async function reloadCharacters() {
  try {
    characters = await api.charactersList();
  } catch {
    characters = [];
  }
  for (const fn of listeners) {
    try {
      fn(characters);
    } catch {
      /* 监听器异常不阻断 */
    }
  }
  return characters;
}

export function getCharacters() {
  return characters;
}

export function onCharactersChanged(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** 皮肤设置值是否为外部角色（'ext:<id>'） */
export function isExternalSkin(skin) {
  return typeof skin === 'string' && skin.startsWith('ext:');
}

/**
 * 解析姿势 → {url, video} 或 null（非外部皮肤 / 未命中，回退内置素材）。
 * 外部角色缺某姿势时回退到该角色的 main。
 */
export function resolvePose(skin, poseName) {
  if (!isExternalSkin(skin)) return null;
  const id = skin.slice(4);
  const char = characters.find((c) => c.id === id);
  if (!char) return null;
  const pose = char.poses[poseName] || char.poses.main;
  if (!pose) return null;
  return { url: `res://./characters/${encodeURIComponent(id)}/${encodeURIComponent(pose.file)}`, video: pose.video };
}
