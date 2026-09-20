/**
 * 面板：余额刷新、时段倒计时、价格表、统计图表、Tab 切换、设置表单、迷你模式
 */
import { $, state, DEMO } from './state.js';
import { api } from './api.js';
import { showBubble, hideBubble } from './bubble.js';
import { updateTask, taskBalanceQuery } from './task.js';
import { applyBodyFlags } from './desktop.js';
import { offpeakInfo, fmtCountdown } from '../shared/offpeak.mjs';
import { updateBalanceTier } from './balanceMood.js';
import { applyAnimSpeed, setPose } from './pet.js';
import { syncMusicSing } from './musicDetector.js';
import { getPetFSM } from './fsm/index.js';
import {
  reactBalanceDrop,
  reactBalanceGain,
  reactLowBalance,
  reactRichBalance,
  reactOffpeakStart,
} from './pet.js';

let refreshTimer = null;

// 时段判断已抽到共享模块（测试复用），这里保持对外导出兼容
export { offpeakInfo, fmtCountdown };

// ---------- 价格表（低价时段用折扣价并标绿） ----------
export function renderPrices() {
  const m = state.prices[state.settings.model] || state.prices['deepseek-v4-flash'];
  const { isLow } = offpeakInfo();
  const p = isLow ? m.offpeak : m.normal;
  $('model-name').textContent = m.label;
  $('price-hit').textContent = `¥${p.hit.toFixed(2)} / M`;
  $('price-miss').textContent = `¥${p.miss.toFixed(2)} / M`;
  $('price-out').textContent = `¥${p.out.toFixed(2)} / M`;
  ['price-hit', 'price-miss', 'price-out'].forEach((id) => $(id).classList.toggle('green', isLow));
}

/** 在 Flash / Pro 之间切换当前展示模型 */
export async function toggleModel() {
  state.settings.model = state.settings.model === 'deepseek-v4-flash' ? 'deepseek-v4-pro' : 'deepseek-v4-flash';
  await api.saveSettings({ model: state.settings.model });
  renderPrices();
  const label = (state.prices[state.settings.model] || {}).label || state.settings.model;
  showBubble(`已切换到 <b>${label}</b> 模型`, 'normal', 3000);
}

// ---------- 时段刷新（每秒） ----------
export function tickPeriod() {
  if (!state.windowVisible) return;
  const { isLow, remainMs } = offpeakInfo();
  const badge = $('period-badge');
  if (isLow) {
    badge.classList.remove('high');
    $('period-name').textContent = '低价时段';
    $('period-remain').textContent = `剩余 ${fmtCountdown(remainMs)}`;
    $('next-period-name').textContent = '高价时段';
    $('next-period-name').classList.remove('low');
    $('next-period-range').textContent = '工作日 09–12 / 14–18 点（北京）';
  } else {
    badge.classList.add('high');
    $('period-name').textContent = '高价时段';
    $('period-remain').textContent = `剩余 ${fmtCountdown(remainMs)}`;
    $('next-period-name').textContent = '低价时段';
    $('next-period-name').classList.add('low');
    $('next-period-range').textContent = '其余时间（含周末）';
  }
  $('next-period-count').textContent = fmtCountdown(remainMs);

  const miniBadge = $('mini-badge');
  if (miniBadge) {
    miniBadge.textContent = isLow ? '低价时段' : '高价时段';
    miniBadge.classList.toggle('high', !isLow);
  }

  // 时段跳变主动提醒（暂停动画时跳过）
  if (state.prevIsLow !== null && state.prevIsLow !== isLow) {
    renderPrices();
    if (!state.animationsPaused) {
      if (isLow) {
        setPose('char_happy', 4000);
        reactOffpeakStart();
        showBubble('🎉 <b>低价时段开始啦！</b><br>现在跑任务最划算～💰', 'success', 7000);
      } else {
        setPose('char_sleep', 6000);
        showBubble('进入<b>高价时段</b>了…<br>不着急的任务等工作日高峰外再跑哦～🕐', 'normal', 7000);
      }
    }
  }
  state.prevIsLow = isLow;
}

// ---------- 图表 ----------
export function drawChart() {
  const cv = $('chart');
  const ctx = cv.getContext('2d');
  ctx.clearRect(0, 0, cv.width, cv.height);
  if (state.balanceHistory.length < 2) {
    ctx.fillStyle = '#9aa3b8';
    ctx.font = '13px sans-serif';
    ctx.fillText('数据点不足，多刷新几次再来看看～', 70, 95);
    return;
  }
  const vs = state.balanceHistory.map((p) => p.v);
  const min = Math.min(...vs);
  const max = Math.max(...vs);
  const span = max - min || 1;
  ctx.strokeStyle = '#2b63f6';
  ctx.lineWidth = 2;
  ctx.beginPath();
  state.balanceHistory.forEach((p, i) => {
    const x = 20 + (i / (state.balanceHistory.length - 1)) * (cv.width - 40);
    const y = cv.height - 25 - ((p.v - min) / span) * (cv.height - 55);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();
  ctx.fillStyle = '#8891a8';
  ctx.font = '11px sans-serif';
  ctx.fillText(`¥${max.toFixed(2)}`, 4, 14);
  ctx.fillText(`¥${min.toFixed(2)}`, 4, cv.height - 8);
}

// ---------- 余额 ----------
function setBadge(text, isError) {
  const b = $('demo-badge');
  b.textContent = text;
  b.classList.toggle('error', Boolean(isError));
  b.classList.remove('hidden');
}

export async function refreshBalance(quiet = false) {
  if (!quiet) {
    setPose('char_work');
    showBubble('正在努力工作中…<br>帮你省钱！⚡⚡⚡', 'normal', 0, { immediate: true });
    updateTask({ status: 'working', title: '正在查询 DeepSeek 余额', progress: null, detail: '同步账户数据中…' });
  }
  const r = await api.fetchBalance();
  state.queryCount += 1;
  localStorage.setItem('queryCount', String(state.queryCount));
  $('stat-count').textContent = String(state.queryCount);
  $('stat-last').textContent = new Date().toLocaleString('zh-CN');

  // —— 错误分支：保留上次数值，徽标提示 + 同类错误只弹一次气泡 ——
  if (r.error) {
    setBadge(`⚠ ${r.error}`, true);
    if (!quiet) updateTask({ status: 'error', title: '余额查询失败 ⚠️', progress: null, detail: r.error });
    if (state.lastErrorType !== r.errorType) {
      state.lastErrorType = r.errorType;
      const tips = {
        auth: '请到设置页检查 API Key',
        rate: '已自动降频，稍后再试',
        network: '检查网络连接后我会自动重试',
      };
      showBubble(
        `⚠️ <b>余额查询失败：${r.error}</b><br>${tips[r.errorType] || '稍后自动重试'}`,
        'warn',
        6000,
      );
      // FSM：网络断开/超时 → REFUSE（拒绝不听）；其余错误 → DEBUGGING（代码查错）
      if (r.errorType === 'network') getPetFSM()?.changeState('REFUSE');
      else getPetFSM()?.changeState('DEBUGGING');
    }
    if (!quiet) setPose(state.settings.skin || 'char_main');
    return;
  }
  if (state.lastErrorType) {
    state.lastErrorType = null;
    showBubble('✅ 余额查询恢复正常啦', 'success', 3000);
  }

  let total;
  if (r.demo) {
    setBadge('演示数据', false);
    total = DEMO.total;
    $('balance').textContent = `¥ ${DEMO.total.toFixed(2)}`;
    $('balance-detail').textContent =
      `充值余额 ¥${DEMO.topped.toFixed(2)} ｜ 赠金余额 ¥${DEMO.granted.toFixed(2)}`;
  } else {
    $('demo-badge').classList.add('hidden');
    const info = (r.data.balance_infos || [])[0] || {};
    total = parseFloat(info.total_balance || 0);
    $('balance').textContent = `¥ ${total.toFixed(2)}`;
    $('balance-detail').textContent =
      `充值余额 ¥${parseFloat(info.topped_up_balance || 0).toFixed(2)} ｜ 赠金余额 ¥${parseFloat(info.granted_balance || 0).toFixed(2)}`;
  }
  $('mini-balance').textContent = `¥${total.toFixed(2)}`;

  if (!quiet) {
    if (r.demo) {
      updateTask({ status: 'success', title: '余额查询完成', progress: null, detail: '当前为演示数据' });
    } else {
      taskBalanceQuery({ remain: total });
      setTimeout(() => {
        updateTask({ status: 'success', title: '余额查询完成', progress: null, detail: `剩余 ¥${total.toFixed(1)}` });
      }, 900);
    }
  }

  // —— 真实数据：余额变动检测（推算）；演示数据不写入历史，避免污染图表 ——
  if (!r.demo) {
    if (Number.isFinite(state.prevBalance)) {
      const diff = total - state.prevBalance;
      $('stat-prev-balance').textContent = `¥${state.prevBalance.toFixed(2)}`;
      $('stat-change').textContent = `${diff >= 0 ? '+' : ''}¥${diff.toFixed(2)}`;
      if (Math.abs(diff) >= (state.settings.balanceChangeThreshold || 1)) {
        if (diff < 0) reactBalanceDrop(diff, total);
        else reactBalanceGain();
        showBubble(
          diff < 0
            ? `📉 <b>余额消耗 ¥${Math.abs(diff).toFixed(2)}</b><br>剩余 ¥${total.toFixed(2)}（本地推算）`
            : `📈 <b>余额增加 ¥${diff.toFixed(2)}</b><br>当前 ¥${total.toFixed(2)}`,
          diff < 0 ? 'normal' : 'success',
          5000,
        );
      }
    }
    state.prevBalance = total;
    localStorage.setItem('lastBalance', String(total));

    state.balanceHistory.push({ t: Date.now(), v: total });
    if (state.balanceHistory.length > 60) state.balanceHistory.shift();
    localStorage.setItem('balanceHistory', JSON.stringify(state.balanceHistory));
    updateBalanceTier(total, { quiet: true }); // 余额分档心情（对标 dsh-pet）
  }
  drawChart();

  const { isLow } = offpeakInfo();
  if (total < (state.settings.lowBalanceThreshold || 20)) {
    reactLowBalance();
    getPetFSM()?.changeState('ALERT'); // FSM 警报态：举「快充值」牌 + 摇晃
    showBubble(`⚠️ <b>余额不足啦！</b><br>只剩 ¥${total.toFixed(2)} 了<br>记得充值哦～`, 'warn', 8000);
  } else if (total >= 200) {
    if (!quiet) reactRichBalance();
    else setPose('char_happy', 2600);
    if (!quiet) {
      showBubble(
        `主人～余额充足 <b>¥${total.toFixed(2)}</b>！${isLow ? '低价时段冲一波～' : '财运满满～'}✨`,
        'success',
        5000,
      );
    }
  } else if (!quiet) {
    setPose('char_happy', 2600);
    showBubble(
      `主人～<br>你的 DeepSeek 余额还有<br><b>¥${total.toFixed(2)}</b> 呢！${isLow ? '现在是低价时段，继续冲～' : ''}✨✨`,
      'success',
      5000,
    );
  } else {
    setPose(state.settings.skin || 'char_main');
    hideBubble();
  }
}

// ---------- 刷新调度（低价时段更勤快：高价时段 ×3 降频） ----------
export function pauseRefresh() {
  clearTimeout(refreshTimer);
  refreshTimer = null;
}

export function scheduleRefresh() {
  clearTimeout(refreshTimer);
  if (!state.windowVisible) return;
  const { isLow } = offpeakInfo();
  const factor = state.settings.offpeakBoost && !isLow ? 3 : 1;
  refreshTimer = setTimeout(
    async () => {
      await refreshBalance(true);
      scheduleRefresh();
    },
    (state.settings.refreshMinutes || 5) * factor * 60000,
  );
}

// ---------- 迷你模式 ----------
export function enterMini(on) {
  document.body.classList.toggle('mini', on);
  $('mini-bar').classList.toggle('hidden', !on);
  api.setMini(on);
  api.saveSettings({ miniMode: on });
}

// ---------- 设置表单 ----------
function renderKeyHint() {
  const hint = $('set-key-hint');
  if (!state.settings.apiKey) {
    hint.textContent = '';
    return;
  }
  if (state.settings.keyEncrypted) {
    hint.textContent = '🔒 Key 已加密存储（safeStorage）';
    hint.style.color = '#12b76a';
  } else {
    hint.textContent = '⚠ 当前环境不支持加密，Key 将以明文存储';
    hint.style.color = '#e04444';
  }
}

export function fillSettingsForm() {
  const s = state.settings;
  $('set-apikey').value = s.apiKey || '';
  $('set-interval').value = s.refreshMinutes;
  $('set-threshold').value = s.lowBalanceThreshold;
  $('set-change-threshold').value = s.balanceChangeThreshold;
  $('set-boost').checked = s.offpeakBoost !== false;
  $('set-top').checked = Boolean(s.alwaysOnTop);
  $('set-autostart').checked = Boolean(s.autoStart);
  $('set-through').checked = Boolean(s.clickThrough);
  $('set-lock').checked = Boolean(s.lockPosition);
  const op = Math.min(100, Math.max(10, Number(s.opacity) || 100));
  $('set-opacity').value = String(op);
  $('opacity-hint').textContent = `${op}%`;
  $('stat-threshold').textContent = `¥${s.lowBalanceThreshold}`;
  $('set-anim-speed').value = String(Math.min(2, Math.max(1, Number(s.animSpeed) || 1)));
  $('anim-speed-hint').textContent = `${Number(s.animSpeed) || 1}x`;
  $('set-notifications').checked = Boolean(s.notifications);
  $('set-fullscreen-hide').checked = Boolean(s.fullscreenHide);
  $('set-capture-protect').checked = Boolean(s.captureProtect);
  $('set-proactive').checked = Boolean(s.proactiveSense);
  $('set-whitelist').value = (s.senseWhitelist || []).join(', ');
  $('set-music-sing').checked = Boolean(s.musicSing);
  $('set-update-repo').value = s.updateRepo || '';
  renderKeyHint();
}

async function saveSettingsForm() {
  state.settings = await api.saveSettings({
    apiKey: $('set-apikey').value.trim(),
    refreshMinutes: parseInt($('set-interval').value, 10) || 5,
    lowBalanceThreshold: parseFloat($('set-threshold').value) || 20,
    balanceChangeThreshold: parseFloat($('set-change-threshold').value) || 1,
    offpeakBoost: $('set-boost').checked,
    alwaysOnTop: $('set-top').checked,
    autoStart: $('set-autostart').checked,
    clickThrough: $('set-through').checked,
    lockPosition: $('set-lock').checked,
    opacity: parseInt($('set-opacity').value, 10) || 100,
    animSpeed: parseFloat($('set-anim-speed').value) || 1,
    notifications: $('set-notifications').checked,
    fullscreenHide: $('set-fullscreen-hide').checked,
    captureProtect: $('set-capture-protect').checked,
    proactiveSense: $('set-proactive').checked,
    senseWhitelist: $('set-whitelist').value.split(/[,，\n]/).map((x) => x.trim()).filter(Boolean),
    musicSing: $('set-music-sing').checked,
    updateRepo: $('set-update-repo').value.trim(),
  });
  $('stat-threshold').textContent = `¥${state.settings.lowBalanceThreshold}`;
  applyBodyFlags();
  applyAnimSpeed();
  syncMusicSing();
  renderKeyHint();
  scheduleRefresh();
  showBubble('设置已保存～', 'success', 2500);
  refreshBalance(true);
}

// ---------- 初始化 ----------
export function initPanel() {
  $('btn-refresh').onclick = () => refreshBalance();
  $('btn-min').onclick = () => api.hideWindow();
  $('btn-close-panel').onclick = () => {
    $('panel').classList.add('hidden');
    api.saveSettings({ panelOpen: false });
    showBubble('右键我可以再打开面板哦～', 'normal', 3000);
  };

  document.querySelectorAll('.tab').forEach((t) => {
    t.onclick = () => {
      document.querySelectorAll('.tab').forEach((x) => x.classList.remove('active'));
      t.classList.add('active');
      ['overview', 'stats', 'chart', 'settings'].forEach((p) => {
        $(`page-${p}`).classList.toggle('hidden', p !== t.dataset.tab);
      });
      if (t.dataset.tab === 'chart') drawChart();
    };
  });

  $('btn-save-settings').onclick = saveSettingsForm;
  $('set-opacity').addEventListener('input', () => {
    const v = parseInt($('set-opacity').value, 10) || 100;
    $('opacity-hint').textContent = `${v}%`;
    api.saveSettings({ opacity: v });
  });
  $('set-anim-speed').addEventListener('input', () => {
    const v = parseFloat($('set-anim-speed').value) || 1;
    $('anim-speed-hint').textContent = `${v}x`;
    state.settings.animSpeed = v;
    applyAnimSpeed();
    api.saveSettings({ animSpeed: v });
  });
  $('set-through').addEventListener('change', async () => {
    state.settings = await api.saveSettings({ clickThrough: $('set-through').checked });
    applyBodyFlags();
    api.setIgnoreMouse(!!state.settings.clickThrough);
  });
  $('set-lock').addEventListener('change', async () => {
    state.settings = await api.saveSettings({ lockPosition: $('set-lock').checked });
    applyBodyFlags();
  });
  $('switch-model').onclick = (e) => {
    e.preventDefault();
    toggleModel();
  };
  $('open-console').onclick = (e) => {
    e.preventDefault();
    api.openConsole();
  };
  $('mini-expand').addEventListener('click', (e) => {
    e.stopPropagation();
    enterMini(false);
  });

  api.on('tray-toggle-mini', () => enterMini(!document.body.classList.contains('mini')));
  api.on('tray-toggle-through', async () => {
    state.settings = await api.saveSettings({ clickThrough: !state.settings.clickThrough });
    applyBodyFlags();
    api.setIgnoreMouse(!!state.settings.clickThrough);
    $('set-through').checked = Boolean(state.settings.clickThrough);
  });
  api.on('tray-toggle-lock', async () => {
    state.settings = await api.saveSettings({ lockPosition: !state.settings.lockPosition });
    applyBodyFlags();
    $('set-lock').checked = Boolean(state.settings.lockPosition);
  });
  api.on('panel-open', () => {
    if (document.body.classList.contains('mini')) enterMini(false);
    $('panel').classList.remove('hidden');
    api.saveSettings({ panelOpen: true });
  });

  $('panel').classList.toggle('hidden', !state.settings.panelOpen);
  renderPrices();
}
