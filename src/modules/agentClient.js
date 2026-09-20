/**
 * Agent 联动客户端（渲染层）：接收主进程转发的 Agent 事件并驱动桌宠。
 * 事件协议见 docs/AGENT_PROTOCOL.md；联动音效走音效包 'agent' 事件。
 */
import { showBubble } from './bubble.js';
import { updateTask } from './task.js';
import { setPose, setMoodPublic } from './pet.js';
import { playAgentEvent } from './sound.js';
import { getPetFSM } from './fsm/index.js';

function handleEvent(ev) {
  playAgentEvent();
  switch (ev.type) {
    case 'state':
      // Agent 直接驱动 FSM（强制切换，带可选时长与回退态）
      getPetFSM()?.changeState(ev.value, { duration: ev.duration, fallback: ev.fallback, force: true });
      return;
    case 'task':
      updateTask({
        status: ev.status,
        title: ev.title,
        progress: ev.progress,
        detail: ev.detail,
        resetTimer: ev.status === 'thinking' || ev.status === 'working',
      });
      break;
    case 'say':
      showBubble(ev.text, ev.level || 'normal', ev.ms || Math.min(12000, 3000 + ev.text.length * 60));
      break;
    case 'mood':
      setMoodPublic(ev.value);
      break;
    case 'pose':
      setPose(ev.name, ev.ms || 0);
      break;
    case 'think':
      updateTask(
        ev.on
          ? { status: 'thinking', title: '正在思考 🤔', detail: 'Agent 工作中…' }
          : { status: 'idle' },
      );
      break;
    default:
      break;
  }
}

export function initAgentClient() {
  if (window.pet?.on) {
    window.pet.on('agent-event', handleEvent);
  }
}
