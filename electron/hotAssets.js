/**
 * 热加载素材（对标 dsh-pet 角色 hot-load + 自定义音效包）：
 * - 角色：userData/characters/<id>/character.json（poses → webm/png，视频带 alpha 可播），
 *   fs.watch 热更新，渲染层实时换肤；
 * - 音效包：userData/sounds/<event>.mp3|wav|ogg|flac 覆盖内置合成音。
 * 文件经 res:// 自定义协议从 userData 提供（main.js 注册）。
 */
const path = require('path');
const fs = require('fs');

const POSE_KEYS = ['main', 'happy', 'blink', 'sleep', 'angry', 'shy', 'surprise', 'work'];
const SOUND_EVENTS = [
  'press',
  'click',
  'grab',
  'launch',
  'bonk',
  'agent',
  'pat-head',
  'pat-belly',
  'pat-tail',
  'feed',
  'celebrate',
  'warn',
  'toggle',
];
const MEDIA_EXT = new Set(['.webm', '.png', '.webp', '.gif', '.mp4', '.jpg', '.jpeg', '.svg']);
const AUDIO_EXT = new Set(['.mp3', '.wav', '.ogg', '.flac', '.m4a']);

function charactersRoot(userData) {
  return path.join(userData, 'characters');
}
function soundsRoot(userData) {
  return path.join(userData, 'sounds');
}

function safeReadJson(p) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

/** 扫描外部角色目录。返回 [{id, name, dir, poses:{key:{file, video}}, scale}] */
function listCharacters(userData) {
  const root = charactersRoot(userData);
  let dirs = [];
  try {
    dirs = fs
      .readdirSync(root, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch {
    return [];
  }
  const out = [];
  for (const id of dirs) {
    const dir = path.join(root, id);
    const manifest = safeReadJson(path.join(dir, 'character.json'));
    if (!manifest) continue;
    const poses = {};
    const src = manifest.poses || {};
    for (const key of POSE_KEYS) {
      const file = typeof src[key] === 'string' ? src[key] : key === 'main' ? 'main.webm' : null;
      if (!file) continue;
      if (!MEDIA_EXT.has(path.extname(file).toLowerCase())) continue;
      if (!fs.existsSync(path.join(dir, file))) continue;
      poses[key] = { file, video: /\.(webm|mp4)$/i.test(file) };
    }
    if (!poses.main) continue; // 至少要有主姿势
    out.push({
      id,
      name: String(manifest.name || id).slice(0, 40),
      poses,
      scale: Number(manifest.scale) > 0 ? Number(manifest.scale) : 1,
    });
  }
  return out;
}

/** 扫描音效包。返回 {event: 'res://sounds/<file>'} */
function listSoundPack(userData) {
  const root = soundsRoot(userData);
  const found = {};
  try {
    const files = new Set(fs.readdirSync(root));
    for (const ev of SOUND_EVENTS) {
      for (const ext of AUDIO_EXT) {
        const f = `${ev}${ext}`;
        if (files.has(f)) {
          found[ev] = `res://./sounds/${encodeURIComponent(f)}`;
          break;
        }
      }
    }
  } catch {
    /* 目录不存在 */
  }
  return found;
}

/** 监听 userData 素材目录变化（角色 + 音效），防抖后回调。返回 stop()。 */
function watchHotAssets(userData, onChange) {
  const roots = [charactersRoot(userData), soundsRoot(userData)];
  const watchers = [];
  let timer = null;
  const fire = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      try {
        onChange();
      } catch {
        /* 回调异常不阻断 */
      }
    }, 500);
  };
  for (const root of roots) {
    try {
      fs.mkdirSync(root, { recursive: true });
      watchers.push(fs.watch(root, { recursive: true }, fire));
    } catch {
      /* 目录监听失败不影响主流程 */
    }
  }
  return () => {
    clearTimeout(timer);
    for (const w of watchers) {
      try {
        w.close();
      } catch {
        /* 已关闭 */
      }
    }
  };
}

module.exports = { listCharacters, listSoundPack, watchHotAssets, charactersRoot, soundsRoot, POSE_KEYS, SOUND_EVENTS };
