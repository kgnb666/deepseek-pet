/**
 * 右键菜单
 */
import { $, state } from './state.js';
import { api } from './api.js';
import { showBubble } from './bubble.js';
import { setPose, setAnimationsPaused, INTERACTIONS, feedPet } from './pet.js';
import { getPetFSM } from './fsm/index.js';
import { refreshBalance, offpeakInfo, enterMini, toggleModel } from './panel.js';
import { playInteract, playToggle, playSkin } from './sound.js';
import { updateTask, taskDeepSeekCall, taskBalanceQuery, taskOffpeak } from './task.js';
import { toggleClickThrough, toggleLockPosition } from './desktop.js';
import { toggleQuickChat } from './quickChat.js';
import { askScreen } from './screenSense.js';
import { getCharacters } from './characters.js';

const SKINS = [
  'char_main',
  'char_happy',
  'char_work',
  'char_sleep',
  'char_lie',
  'char_angry',
  'char_shy',
  'char_surprise',
  'char_sign',
  'char_alert',
  'char_blink',
];

/** 内置皮肤 + 热加载外部角色 */
function skinList() {
  return [...SKINS, ...getCharacters().map((c) => `ext:${c.id}`)];
}

function skinLabel(skin) {
  if (skin.startsWith('ext:')) {
    const c = getCharacters().find((x) => `ext:${x.id}` === skin);
    return c ? c.name : skin;
  }
  return skin.replace('char_', '');
}

/** 检查更新（对标 dsh-pet：GitHub Releases + jsDelivr 兜底，主进程实现） */
async function runCheckUpdate() {
  showBubble('正在检查更新…', 'normal', 0, { immediate: true });
  const r = await api.checkUpdate();
  if (!r.ok) {
    showBubble(`⚠️ 检查更新失败：<br>${r.error}`, 'warn', 6000);
    return;
  }
  if (r.newer) {
    showBubble(
      `🎉 发现新版本 <b>v${r.latest}</b><br>当前 v${r.current}<br>正在打开发布页…`,
      'success',
      5000,
    );
    setTimeout(() => api.openExternal(r.url), 900);
  } else {
    showBubble(`✅ 已经是最新版本 v${r.current} 啦`, 'success', 4000);
  }
}

function refreshMenuChecks() {
  $('check-top').classList.toggle('off', !state.settings.alwaysOnTop);
  $('check-autostart').classList.toggle('off', !state.settings.autoStart);
  $('check-through').classList.toggle('off', !state.settings.clickThrough);
  $('check-lock').classList.toggle('off', !state.settings.lockPosition);
  $('check-pause').classList.toggle('off', !state.animationsPaused);
  $('check-sound').classList.toggle('off', state.settings.soundEnabled === false);
}

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

/** 模拟代码生成：进度爬升后切 success。 */
function demoGenerate() {
  updateTask({
    status: 'working',
    title: '正在生成代码 ⌨️',
    progress: 8,
    detail: '写入补丁…',
    resetTimer: true,
  });
  let p = 8;
  const t = setInterval(() => {
    p = Math.min(100, p + 12 + Math.floor(Math.random() * 8));
    if (p >= 100) {
      clearInterval(t);
      updateTask({ status: 'success', title: '代码已生成 🎉', progress: 100, detail: '可以继续下一项啦' });
      return;
    }
    updateTask({ progress: p });
  }, 420);
}

/** 模拟 DeepSeek：thinking → 进度 → 余额卡片 → success。 */
function demoDeepSeek() {
  updateTask({ status: 'thinking', title: '正在请求 DeepSeek', detail: '建立连接…' });
  setTimeout(() => {
    taskDeepSeekCall({ progress: 20 });
    let p = 20;
    const t = setInterval(() => {
      p = Math.min(100, p + 18);
      if (p >= 100) {
        clearInterval(t);
        taskBalanceQuery({ remain: 23.5, spent: 1.2, progress: 100 });
        setTimeout(() => {
          updateTask({ status: 'success', title: 'DeepSeek 响应完成 🎉', progress: 100, detail: '模型调用结束' });
        }, 700);
        return;
      }
      taskDeepSeekCall({ progress: p });
    }, 380);
  }, 700);
}

async function handleAction(act) {
  switch (act) {
    case 'toggle-panel': {
      const opening = $('panel').classList.contains('hidden') || document.body.classList.contains('mini');
      if (document.body.classList.contains('mini')) enterMini(false);
      $('panel').classList.toggle('hidden', !opening);
      api.saveSettings({ panelOpen: opening });
      break;
    }
    case 'refresh':
      await refreshBalance();
      break;
    case 'switch-model':
      await toggleModel();
      break;
    case 'mini':
      enterMini(!document.body.classList.contains('mini'));
      break;
    case 'price-info': {
      const m = state.prices[state.settings.model];
      const { isLow } = offpeakInfo();
      const p = isLow ? m.offpeak : m.normal;
      const mark = isLow ? '<span style="color:#12b76a">低价折扣中</span>' : '原价';
      showBubble(
        `当前模型 <b>${m.label}</b>（${mark}）<br>缓存命中 ¥${p.hit}/M<br>缓存未命中 ¥${p.miss}/M<br>输出 ¥${p.out}/M<br><span style="color:#12b76a">低价时段：工作日高峰外·含周末</span>`,
        'normal',
        7000,
      );
      break;
    }
    case 'toggle-top':
      state.settings = await api.saveSettings({ alwaysOnTop: !state.settings.alwaysOnTop });
      break;
    case 'toggle-autostart':
      state.settings = await api.saveSettings({ autoStart: !state.settings.autoStart });
      break;
    case 'toggle-through':
      await toggleClickThrough();
      break;
    case 'toggle-lock':
      await toggleLockPosition();
      break;
    case 'interact':
      setPose('char_happy', 3000);
      playInteract();
      showBubble(pick(INTERACTIONS), 'success', 4000);
      break;
    case 'feed':
      feedPet();
      break;
    case 'walk': {
      const brain = getPetFSM();
      if (brain && brain.state === 'WALK') {
        showBubble('正在散步呢～', 'normal', 2500);
        break;
      }
      if (state.settings.lockPosition) {
        showBubble('位置被锁定啦<br>解锁后我才能出去走走', 'warn', 3000);
        break;
      }
      const r = brain ? brain.changeState('WALK') : { ok: false };
      if (!r.ok) showBubble('现在走不开啦～<br>等我忙完这阵子的', 'normal', 2800);
      break;
    }
    case 'task-think':
      updateTask({ status: 'thinking', title: '正在思考方案 🤔', progress: null, detail: '梳理需求中…' });
      break;
    case 'task-work':
      demoGenerate();
      break;
    case 'task-ok':
      updateTask({ status: 'success', title: '任务完成 🎉', progress: 100, detail: '可以继续下一项啦' });
      break;
    case 'task-err':
      updateTask({ status: 'error', title: '出现错误 ⚠️', progress: null, detail: '请检查网络或 API Key' });
      break;
    case 'task-ds':
      demoDeepSeek();
      break;
    case 'task-offpeak':
      taskOffpeak({ remainMinutes: 35 });
      break;
    case 'toggle-sound': {
      const next = state.settings.soundEnabled === false; // 当前关 → 开启
      state.settings = await api.saveSettings({ soundEnabled: next });
      if (next) playToggle();
      showBubble(next ? '音效已开启 🔊' : '音效已关闭 🔇', 'normal', 2500);
      break;
    }
    case 'toggle-pause': {
      const next = !state.animationsPaused;
      setAnimationsPaused(next);
      if (!next) showBubble('动画恢复啦！✨', 'normal', 2500);
      break;
    }
    case 'skin': {
      const list = skinList();
      const i = (list.indexOf(state.settings.skin) + 1) % list.length;
      state.settings.skin = list[i];
      await api.saveSettings({ skin: state.settings.skin });
      setPose(state.settings.skin);
      playSkin();
      showBubble(`换上新造型「<b>${skinLabel(state.settings.skin)}</b>」啦～好看吗？✨`, 'success', 3000);
      break;
    }
    // ---------- AI / 扩展 ----------
    case 'quick-chat':
      toggleQuickChat();
      break;
    case 'screen-look':
      askScreen();
      break;
    case 'chat-window':
      api.chatOpenWindow();
      break;
    case 'spawn-pet':
      api.spawnPet();
      break;
    case 'check-update':
      await runCheckUpdate();
      break;
    case 'open-sounds':
      api.openSoundsFolder();
      break;
    case 'open-characters':
      api.openCharactersFolder();
      break;
    case 'about': {
      const version = await api.getVersion();
      showBubble(
        `<b>DeepSeek Pet</b> v${version}<br>你的 DeepSeek API 桌面小管家<br>实时余额 · 低价提醒 · 可爱互动`,
        'normal',
        6000,
      );
      break;
    }
    case 'quit': {
      // GOODBYE 告别动画播完 → FSM 'exit' 事件 → renderer 回调 api.quit()
      const brain = getPetFSM();
      if (brain && !brain.terminal) brain.changeState('GOODBYE');
      else api.quit();
      break;
    }
    default:
      break;
  }
}

export function initMenu() {
  const menu = $('ctx-menu');

  document.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    refreshMenuChecks();
    menu.classList.remove('hidden');
    // 实测菜单尺寸后钳制到窗口内（菜单可能比窗口高 → 内部滚动）
    const mw = menu.offsetWidth;
    const mh = menu.offsetHeight;
    menu.style.left = `${Math.max(4, Math.min(e.clientX, window.innerWidth - mw - 4))}px`;
    menu.style.top = `${Math.max(4, Math.min(e.clientY, window.innerHeight - mh - 4))}px`;
  });

  document.addEventListener('click', (e) => {
    if (!menu.contains(e.target)) menu.classList.add('hidden');
  });

  api.on('tray-check-update', () => runCheckUpdate());

  menu.addEventListener('click', async (e) => {
    const item = e.target.closest?.('.ctx-item');
    if (!item) return;
    // 演示组开合：只切换展开状态，不收起菜单、不派发动作
    if (item.dataset.act === 'demo-toggle') {
      const sub = $('demo-sub');
      sub.classList.toggle('hidden');
      $('demo-arrow').textContent = sub.classList.contains('hidden') ? '▸' : '▾';
      return;
    }
    menu.classList.add('hidden');
    await handleAction(item.dataset.act);
  });
}
