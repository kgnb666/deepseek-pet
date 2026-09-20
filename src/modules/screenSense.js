/**
 * 识屏（对标 dsh-pet「看看屏幕」）：截屏 + 前台窗口 → 视觉模型 → 气泡回答。
 * 截图仅内存处理，不落盘。
 */
import { showBubble } from './bubble.js';
import { updateTask } from './task.js';
import { api } from './api.js';
import { setPose } from './pet.js';

let asking = false;

export async function askScreen(question = '') {
  if (asking) {
    showBubble('我正在看呢，稍等一下～', 'normal', 2500);
    return;
  }
  asking = true;
  setPose('char_work');
  updateTask({ status: 'thinking', title: '正在看屏幕 👀', detail: '截屏 → 视觉模型（不落盘）' });
  showBubble('让我看看～👀', 'normal', 0, { immediate: true });
  const r = await api.screenAsk(question);
  asking = false;
  if (!r.ok) {
    updateTask({ status: 'error', title: '识屏失败 ⚠️', detail: String(r.error || '').slice(0, 120) });
    showBubble(`⚠️ 看不了屏幕：<br>${r.error || '未知错误'}`, 'warn', 6000);
    return;
  }
  updateTask({ status: 'success', title: '看到啦！', detail: '' });
  showBubble(r.text, 'success', Math.min(15000, 5000 + r.text.length * 70));
}

export function initScreenSense() {
  /* 主动识屏陪伴的关怀消息由主进程以 agent-event(say) 推送，无需额外订阅 */
}
