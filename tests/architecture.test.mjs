import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * 架构红线测试（对标 dsh-pet 的 window.py 行数预算）：
 * 核心入口文件不许无限制膨胀，新功能必须落成独立模块。
 */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function lineCount(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8').split('\n').length;
}

const BUDGETS = {
  'main.js': 1150, // 主进程组合根：只做装配，子系统在 electron/
  'src/modules/pet.js': 800, // 宠物状态机：行为拆到 wander/characters/easterEgg
  'preload.js': 260, // 桥接层：纯转发 + 校验
  'electron/llm.js': 330,
  'src/modules/fsm/index.js': 340, // FSM 组合层：渲染适配，核心在 PetStateMachine
  'src/modules/fsm/PetStateMachine.mjs': 240, // 纯状态机：仲裁+定时器+事件，禁止长胖
};

test('核心文件行数预算', () => {
  for (const [file, budget] of Object.entries(BUDGETS)) {
    const n = lineCount(file);
    assert.ok(n <= budget, `${file} 有 ${n} 行，超过预算 ${budget} 行——请拆分模块而不是继续膨胀`);
  }
});

test('共享模块保持纯净（不依赖 electron / node 内置）', () => {
  const dir = path.join(root, 'src', 'shared');
  for (const f of fs.readdirSync(dir)) {
    const content = fs.readFileSync(path.join(dir, f), 'utf8');
    assert.ok(!content.includes("require('electron')"), `${f} 不得依赖 electron`);
    assert.ok(!/\brequire\(/.test(content), `${f} 是 ESM 模块，不得使用 require`);
    assert.ok(!content.includes('node:'), `${f} 是跨环境纯逻辑，不得依赖 node 内置模块`);
  }
});

test('渲染层不直接使用 node API', () => {
  for (const f of ['src/renderer.js', 'src/modules/pet.js', 'src/chat/chat.js']) {
    const content = fs.readFileSync(path.join(root, f), 'utf8');
    assert.ok(!/\brequire\(/.test(content), `${f} 不得使用 require（渲染层为 ESM + contextBridge）`);
  }
});

test('preload 白名单覆盖所有 ipcMain 事件通道', () => {
  const preload = fs.readFileSync(path.join(root, 'preload.js'), 'utf8');
  const main = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
  // 收集 main.js 里 webContents.send 的频道
  const sent = [...main.matchAll(/(?:webContents\.send|sendToPet|sendToChat)\(\s*'([^']+)'/g)].map((m) => m[1]);
  for (const ch of new Set(sent)) {
    if (ch === 'win-visibility') continue; // 直接 win.webContents.send 也在 main 里出现，一样要检查
    assert.ok(preload.includes(`'${ch}'`), `主进程发送的频道 '${ch}' 未加入 preload SUBSCRIBABLE 白名单`);
  }
});
