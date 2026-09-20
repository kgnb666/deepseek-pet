/**
 * 快速对话气泡（对标 dsh-pet「快速对话气泡」）：
 * 桌宠头顶的迷你输入框，Enter 发给激活 Provider，回答流式写回台词气泡。
 * 不落盘（正式长对话请用 AI 聊天窗）。
 */
import { $, state } from './state.js';
import { showBubble } from './bubble.js';
import { updateTask } from './task.js';
import { api } from './api.js';

let open = false;
let currentRequestId = null;
let acc = '';
let bubbleHoldTimer = null;

function showQuickInput() {
  const qc = $('quick-chat');
  if (!qc) return;
  open = true;
  qc.classList.remove('hidden');
  qc.classList.add('show');
  const input = $('quick-chat-input');
  input.value = '';
  setTimeout(() => input.focus(), 60);
  api.setIgnoreMouse(false); // 输入框可交互
}

export function hideQuickInput() {
  const qc = $('quick-chat');
  if (!qc) return;
  open = false;
  qc.classList.add('hidden');
  qc.classList.remove('show');
  currentRequestId = null;
  if (state.settings.clickThrough) api.setIgnoreMouse(true);
}

export function isQuickChatOpen() {
  return open;
}

export function toggleQuickChat() {
  if (open) hideQuickInput();
  else showQuickInput();
}

async function send() {
  const input = $('quick-chat-input');
  const text = input.value.trim();
  if (!text || currentRequestId) return;
  input.value = '';
  updateTask({ status: 'thinking', title: '正在思考 🤔', detail: '快速对话' });
  showBubble('…', 'normal', 0, { immediate: true });
  acc = '';
  const r = await api.quickChat(text);
  if (!r.ok) {
    updateTask({ status: 'error', title: '发送失败 ⚠️', detail: r.error || '' });
    return;
  }
  currentRequestId = r.requestId;
}

function onDelta(chunk) {
  if (!currentRequestId || chunk.requestId !== currentRequestId) return;
  if (chunk.delta) {
    acc += chunk.delta;
    // 流式期间持续刷新气泡（常驻气泡不占队列锁）
    const b = $('bubble');
    b.classList.remove('hidden');
    $('bubble-text').textContent = acc;
    updateTask({ status: 'working', title: '正在回答 💬', detail: `${acc.length} 字` });
  }
  if (chunk.error) {
    updateTask({ status: 'error', title: 'AI 请求失败 ⚠️', detail: String(chunk.error).slice(0, 120) });
    showBubble(`⚠️ ${chunk.error}`, 'warn', 5000);
  }
  if (chunk.done) {
    currentRequestId = null;
    updateTask({ status: 'success', title: '回答完成 🎉', detail: '' });
    if (acc) {
      showBubble(acc, 'success', Math.min(14000, 4000 + acc.length * 80));
    }
    clearTimeout(bubbleHoldTimer);
    bubbleHoldTimer = setTimeout(hideQuickInput, 400);
  }
}

export function initQuickChat() {
  const qc = $('quick-chat');
  if (!qc) return;
  $('quick-chat-send').addEventListener('click', send);
  $('quick-chat-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    } else if (e.key === 'Escape') {
      hideQuickInput();
    }
  });
  qc.addEventListener('pointerdown', (e) => e.stopPropagation());
  if (window.pet?.on) window.pet.on('quick-chat-delta', onDelta);
}
