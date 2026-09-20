/**
 * 渲染层入口（ES Module）
 * 启动顺序：加载设置与价格表 → 初始化各模块 → 首屏刷新
 */
import { $, state, DEFAULT_PRICES } from './modules/state.js';
import { api } from './modules/api.js';
import { showBubble } from './modules/bubble.js';
import { initPet, setAnimationsPaused, setPose } from './modules/pet.js';
import {
  initPanel,
  fillSettingsForm,
  renderPrices,
  tickPeriod,
  refreshBalance,
  scheduleRefresh,
  pauseRefresh,
  offpeakInfo,
  enterMini,
} from './modules/panel.js';
import { initMenu } from './modules/menu.js';
import { initDrag } from './modules/drag.js';
import { initDesktop } from './modules/desktop.js';
import { festivalGreeting, getFestival } from './modules/season.js';
import { initTaskBubble } from './modules/taskBubble.js';
import { initTaskAnim } from './modules/taskAnim.js';
import { updateTask, subscribe as subscribeTask } from './modules/task.js';
import { initAgentClient } from './modules/agentClient.js';
import { initQuickChat } from './modules/quickChat.js';
import { initScreenSense } from './modules/screenSense.js';
import { initEasterEgg, renderFeedingStats } from './modules/easterEgg.js';
import { initMusicDetector, syncMusicSing } from './modules/musicDetector.js';
import { reloadSoundPack } from './modules/sound.js';
import { reloadCharacters } from './modules/characters.js';
import { getLifeState } from './modules/lifeState.js';
import { initPetFSM, getPetFSM } from './modules/fsm/index.js';

const GREETING_DELAY = 800;
const MINI_RESTORE_DELAY = 300;
const FALLBACK_NOTICE_DELAY = 1500;

async function main() {
  state.settings = await api.getSettings();

  const priceResult = await api.getPrices();
  state.prices = priceResult.prices || DEFAULT_PRICES;
  if (priceResult.fallback) {
    setTimeout(
      () => showBubble('⚠️ prices.json 缺失或损坏<br>已使用内置默认价格', 'warn', 5000),
      FALLBACK_NOTICE_DELAY,
    );
  }

  fillSettingsForm();
  initPanel();
  initPet();
  initMenu();
  initDrag();
  initDesktop();
  initTaskBubble();
  initTaskAnim();
  // 对标 dsh-pet 的新能力
  initAgentClient();
  initQuickChat();
  initScreenSense();
  initEasterEgg();
  initMusicDetector();
  reloadSoundPack();
  // FSM 状态机 + 帧动画控制器（PetBrain 组合层）
  initPetFSM({ onExit: () => api.quit() });
  window.petFSM = getPetFSM(); // 控制台调试：window.petFSM.changeState('ROLL')

  // HUD 状态机 → FSM 桥接：task.js 是 HUD 文案权威，FSM 负责立绘/动作。
  // FSM 'change' 不回写 HUD（render 不碰 updateTask），故无回环。
  const HUD_TO_PET = { thinking: 'THINKING', working: 'CODING', success: 'SUCCESS', error: 'DEBUGGING' };
  subscribeTask((task) => {
    const brain = getPetFSM();
    if (!brain) return;
    if (task.status === 'idle') {
      if (brain.tier >= 2) brain.changeState('IDLE', { force: true }); // 清除驻留功能态
      return;
    }
    const target = HUD_TO_PET[task.status];
    if (target) brain.changeState(target);
  });
  // 给未来 Agent / 控制台调试留的统一入口：window.updateTask({status,title,progress,detail})
  window.updateTask = updateTask;
  window.screenAsk = (q) => import('./modules/screenSense.js').then((m) => m.askScreen(q));

  // 热加载素材变化（角色 / 音效包）
  api.on('hot-assets-changed', () => {
    reloadCharacters();
    reloadSoundPack();
  });

  setAnimationsPaused(Boolean(state.settings.animationsPaused), false);
  renderPrices();
  tickPeriod();
  setInterval(tickPeriod, 1000);
  scheduleRefresh();

  api.on('win-visibility', (visible) => {
    state.windowVisible = Boolean(visible);
    if (visible) {
      tickPeriod();
      scheduleRefresh();
    } else {
      pauseRefresh();
    }
    syncMusicSing();
    renderFeedingStats();
  });

  const { isLow } = offpeakInfo();
  setTimeout(() => {
    const fest = festivalGreeting();
    if (fest) {
      const f = getFestival();
      if (f?.skin) setPose(f.skin, 5000);
      showBubble(fest, 'success', 6500);
      return;
    }
    if (isLow) {
      setPose('char_sign', 5000); // 开场即举「低价！」牌（生活状态引擎联动）
      showBubble('现在是<b>低价时段</b>！<br>跑任务最划算啦～💰💰', 'success', 6000);
    } else {
      const night = getLifeState().key === 'night';
      setPose(night ? 'char_lie' : 'char_sleep', 5000);
      showBubble('现在是<b>高价时段</b>…<br>不着急的话可以<br>晚点再跑哦～🕐', 'normal', 6000);
    }
  }, GREETING_DELAY);

  refreshBalance(true);

  // 记住上次的迷你模式（也支持 ?mini=1 调试）
  if (state.settings.miniMode || new URLSearchParams(location.search).get('mini')) {
    setTimeout(() => enterMini(true), MINI_RESTORE_DELAY);
  }
}

main().catch((err) => {
  console.error('[DeepSeek Pet] 启动失败:', err);
  $('bubble-text').innerHTML = `启动失败：${err.message}`;
  $('bubble').className = 'bubble warn';
});
