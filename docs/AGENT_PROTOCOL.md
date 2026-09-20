# Agent 联动协议（v1）

DeepSeek Pet 在本机暴露一个 HTTP 服务（默认 `127.0.0.1:27890`），任何 Agent（Claude hooks、
ZCode、CI 脚本、自研程序）都可以把事件推给桌宠：任务进度、台词、心情、姿势、快速提问。

对标 dsh-pet 的 Agent 联动（DSH 桥接插件 + Claude hooks），但协议更简单：一条 HTTP POST 就够了。

## 服务信息

- 地址：`http://127.0.0.1:27890`（仅监听回环，外部机器无法访问）
- 鉴权：桌宠设置里配置了 Token 时，请求需带 `X-Agent-Token: <token>` 头（或 `?token=`）
- 多开：只有第一只猫占用 27890 端口；后续实例会静默跳过（可各自设置 `PET_PORT` 环境变量区分？不支持——多开宠物共享第一只猫的事件出口）

## 端点

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/health` | 探活，返回 `{ok:true, protocol:"v1"}` |
| POST | `/event` | 投递事件。Body 支持三种形式：单个 JSON 对象、JSON 数组、JSONL（每行一个对象） |
| POST | `/say`、`/task` | 便捷别名，等同 `/event` |

成功返回 `{ok:true, accepted:<数量>, rejected:[...]}`；事件非法时在 `rejected` 里给原因。

## 事件类型

### task —— 工作状态 HUD

```json
{ "type": "task", "status": "working", "title": "正在构建", "progress": 30, "detail": "编译中…" }
```

- `status` 必填：`thinking | working | success | error | idle`
- `progress` 0–100，可省略；`title`/`detail` 可省略
- 桌宠头顶 HUD 常驻显示进度与耗时；`success`/`error` 停留 3 秒自动收起
- 若桌宠开启「系统通知」，`success`/`error` 还会弹 Windows Toast

### say —— 台词气泡

```json
{ "type": "say", "text": "部署完成啦！", "level": "success", "ms": 5000 }
```

- `level`：`normal | success | warn`（气泡配色），默认 `normal`
- `ms`：展示时长，默认按文本长度自动计算；超长文本自动分页显示

### chat —— 快速提问（AI 生成回答）

```json
{ "type": "chat", "text": "帮我看看现在适合跑任务吗" }
```

桌宠会用激活 Provider 生成一句简短回答，以气泡显示，并在 HUD 上显示思考中。

### mood —— 心情

```json
{ "type": "mood", "value": "happy" }
```

`value`：`happy | bored | sleepy | tsundere`

### pose —— 切换立绘

```json
{ "type": "pose", "name": "char_happy", "ms": 3000 }
```

- 内置姿势：`char_main / char_happy / char_work / char_sleep / char_angry / char_shy / char_surprise / char_blink`
- 已加载的外部角色姿势名同样可用；`ms` 结束后回到当前皮肤

### think —— 思考指示

```json
{ "type": "think", "on": true }
```

`on: true` 显示「正在思考」HUD，`on: false`（或缺省 false）收回。

### state —— 直接驱动桌宠状态机（v2.4+）

```json
{ "type": "state", "value": "ALERT", "duration": 5000, "fallback": "IDLE" }
```

- `value`（必填）为 FSM 状态：基础态 `IDLE / WALK / REST / ROLL / STRETCH`、
  互动态 `PETTING`、功能态 `LOADING / CODING / DEBUGGING / THINKING`、
  系统态 `SUCCESS / ALERT / REFUSE`、终态 `GOODBYE`（播完会真的退出应用，慎用）；
- `duration` 可选覆盖停留时长；`fallback` 可选覆盖到期回退态；
- 强制切换（无视优先级），高优先级状态会打断低优先级动作并联动立绘/气泡/特效；
- 完整语义见 `docs/FSM.md`。

例：让桌宠进入「认真写码」→ `{"type":"state","value":"CODING"}`；
让它在警报后回待机 → `{"type":"state","value":"IDLE"}`。

## CLI 发送器

```bash
node tools/agent-event.mjs say "构建完成啦！"
node tools/agent-event.mjs task working "正在构建" 30
node tools/agent-event.mjs task success "构建完成"
node tools/agent-event.mjs chat "现在余额还能跑几个任务？"
node tools/agent-event.mjs state CODING          # 进入「认真写码」状态
echo '{"type":"say","text":"hi"}' | node tools/agent-event.mjs -
```

环境变量：`PET_PORT`（默认 27890）、`PET_TOKEN`。

## Claude Code hooks 示例

见 `integrations/claude-hooks.example.json`：把 `Stop` / `Notification` / `PostToolUse`
hook 到本 CLI，Claude 干活时桌宠实时显示进度、完成时撒花。

## curl 示例

```bash
curl -s http://127.0.0.1:27890/event -H "Content-Type: application/json" \
  -d '{"type":"task","status":"working","title":"部署中","progress":60}'
```

## 渲染层直调（开发调试）

桌宠窗口 DevTools 里也可以直接调：

```js
window.updateTask({ status: 'working', title: '测试任务', progress: 50 });
window.screenAsk('屏幕上是什么');
```
