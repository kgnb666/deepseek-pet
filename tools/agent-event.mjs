#!/usr/bin/env node
/**
 * Agent 联动事件发送器（CLI）：
 *   node tools/agent-event.mjs say "部署完成啦！"
 *   node tools/agent-event.mjs task working "正在构建" 30
 *   node tools/agent-event.mjs task success "构建完成"
 *   node tools/agent-event.mjs chat "今天余额还能跑多少任务？"
 *   node tools/agent-event.mjs pose char_happy 3000
 *   node tools/agent-event.mjs mood happy
 *   echo '{"type":"say","text":"hi"}' | node tools/agent-event.mjs -
 *
 * 环境变量：PET_PORT（默认 27890）、PET_TOKEN（桌宠设置了鉴权 token 时必填）。
 * 协议详见 docs/AGENT_PROTOCOL.md。
 */
const port = process.env.PET_PORT || 27890;
const token = process.env.PET_TOKEN || '';
const base = `http://127.0.0.1:${port}`;

function buildEvent(argv) {
  const [cmd, ...rest] = argv;
  switch (cmd) {
    case 'say':
      return { type: 'say', text: rest.join(' ') };
    case 'chat':
      return { type: 'chat', text: rest.join(' ') };
    case 'task': {
      const [status, title, progress] = rest;
      const ev = { type: 'task', status: status || 'working' };
      if (title) ev.title = title;
      if (progress !== undefined && progress !== '' && !Number.isNaN(Number(progress))) ev.progress = Number(progress);
      return ev;
    }
    case 'pose':
      return { type: 'pose', name: rest[0], ...(rest[1] ? { ms: Number(rest[1]) } : {}) };
    case 'state':
      return { type: 'state', value: rest[0], ...(rest[1] ? { duration: Number(rest[1]) } : {}) };
    case 'mood':
      return { type: 'mood', value: rest[0] };
    case 'think':
      return { type: 'think', on: rest[0] !== 'off' };
    default:
      return null;
  }
}

async function post(body) {
  const res = await fetch(`${base}/event`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { 'X-Agent-Token': token } : {}) },
    body,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) {
    console.error(`[agent-event] 失败(${res.status}):`, data.error || JSON.stringify(data));
    process.exit(1);
  }
  console.log(`[agent-event] 已送达：`, data);
}

const argv = process.argv.slice(2);
if (argv[0] === '-') {
  // JSON / JSONL 从 stdin 读
  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (c) => (input += c));
  process.stdin.on('end', () => post(input.trim()));
} else {
  const ev = buildEvent(argv);
  if (!ev) {
      console.error(
      '用法: node tools/agent-event.mjs <say|chat|task|pose|state|mood|think> [...参数]\n' +
        '  say "文本"            冒一句台词\n' +
        '  chat "问题"           问 AI，回答走气泡\n' +
        '  task <status> [标题] [进度]   thinking|working|success|error|idle\n' +
        '  pose <姿势名> [ms]    切换立绘\n' +
        '  state <FSM态> [ms]    IDLE|WALK|REST|ROLL|STRETCH|PETTING|LOADING|CODING|DEBUGGING|THINKING|SUCCESS|ALERT|REFUSE|GOODBYE\n' +
        '  mood <happy|bored|sleepy|tsundere>\n' +
        '  think <on|off>        思考指示\n' +
        '  -                     从 stdin 读 JSON/JSONL\n',
    );
    process.exit(1);
  }
  post(JSON.stringify(ev));
}
