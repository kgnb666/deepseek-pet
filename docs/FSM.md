# 桌宠状态机（FSM）与动画系统

> 代码位置：`src/modules/fsm/`。核心（PetState / PetStateMachine / Emitter）为纯逻辑 `.mjs`，
> 可被渲染层、主进程（动态 import）与测试（`tests/fsm.test.mjs`）三方复用。

## 架构分层（高内聚低耦合）

```
┌─────────────────────────────────────────────────────┐
│ 触发源（互不感知，只调 changeState）                    │
│  task.js(HUD) · panel.js(余额) · agentClient(协议)    │
│  menu.js(手动) · pet.js 互动 · lifeState(空闲策略)     │
└──────────────────┬──────────────────────────────────┘
                   ▼
┌─────────────────────────────────────────────────────┐
│ PetStateMachine（纯 FSM：优先级仲裁/定时器/事件总线）   │
└──────────────────┬──────────────────────────────────┘
                   ▼  change/interrupt/exit 事件
┌─────────────────────────────────────────────────────┐
│ PetBrain（fsm/index.js 组合层）：状态→立绘/气泡/游走/   │
│ 特效/帧动画；用户活动跟踪；待机循环开关                  │
└──────────────────┬──────────────────────────────────┘
                   ▼
        setPose / wanderWalk / FrameAnimator / showBubble
```

## 状态枚举（14 态，tier = 优先级，高打断低）

| tier | 状态 | kind | 行为 |
| --- | --- | --- | --- |
| 0 | IDLE / WALK / REST / ROLL / STRETCH | loop / temp | 常驻基础态：IDLE 停留 5s 后由策略随机切换；临时态到期自动回 IDLE |
| 1 | PETTING | temp | 被摸头（Hover 带 8s 冷却 / 点击触发），2.6s 后回 IDLE |
| 2 | LOADING / CODING / DEBUGGING / THINKING | hold | 异步功能态：驻留直到任务事件改写；点击不打断 |
| 3 | SUCCESS / ALERT / REFUSE | temp | 系统事件态：立即打断功能态，播完（3.2–4.2s）回 IDLE |
| 4 | GOODBYE | terminal | 告别动画 1.8s → 触发 `exit` 事件 → 退出客户端，状态机锁定 |

状态 → 立绘映射带**别名回退**（如 `THINKING: ['char_think', 'char_work']`）：
专属素材放进 `assets/` 即自动启用（启动时后台探测），没有就用兜底素材，代码零改动。

## 统一接口

```js
const brain = getPetFSM(); // renderer 全局 window.petFSM 同一实例

brain.changeState(next, {
  duration?: ms,    // 覆盖默认停留时长
  fallback?: 'IDLE',// 覆盖到期回退态
  force?: true,     // 无视优先级仲裁 / 同态重入重置计时
});

brain.on('change',   ({ from, to, interrupted }) => {});
brain.on('reenter',  ({ state }) => {});   // force 同态重入
brain.on('rejected', ({ next, reason }) => {});
brain.on('exit',     () => {});            // GOODBYE 播完

brain.notifyUserActivity(); // 点击/拖拽：基础态立即回 IDLE，功能态免疫
brain.setAutoCycle(true);   // 用户空闲 ≥60s 时开启待机行为循环
```

## 帧动画控制器（FrameAnimator）

```js
// 序列帧：透明 PNG/WebP 序列，逐帧切换 <img>
await animator.playSequence(['f01.png', 'f02.png'], { fps: 8, loop: true });

// 雪碧图：专用图层 #pet-sheet 步进 background-position
animator.playSheet({ image, frameWidth, frameHeight, count, columns }, { fps: 10, loop: false });
```

帧序列/雪碧图通过**动画清单**声明（热加载，缓存 404）：

```json
// assets/animations/CODING.json —— FSM 进入 CODING 时自动接管显示
{ "sheet": { "image": "coding.png", "frameWidth": 480, "frameHeight": 600, "count": 8, "columns": 4 },
  "fps": 10, "loop": true }
// 或 { "frames": ["idle_01.webp", "idle_02.webp"], "fps": 6, "loop": true }
```

### 三段式清单（路线 A 规格，推荐）

```json
// assets/animations/WALK.json
{ "fps": 24, "repeat": 0, "displayHeight": 320,
  "segments": { "entry": ["WALK/entry/frame_0001.webp", "..."],
                "loop":  ["WALK/loop/frame_0001.webp",  "..."],
                "out":   ["WALK/out/frame_0001.webp",   "..."] } }
```

- 编排器 `src/modules/fsm/animPlayer.js`：**上一状态 out → 本状态 entry → loop×repeat
  （0 = 驻留无限循环，被打断时补播 out）→ out**，代际令牌防竞态；
- 无缝原理：`entry` 首帧 = `out` 末帧 = IDLE loop 首帧 = 标准站姿；
- `displayHeight`：帧画布显示高度（720×960 @ 锚点 y=900 → 320px 时锚点与静态立绘基线对齐）；
- 素材由 `tools/gen-anim-frames.py` 生成（规格见 `docs/ANIMATION_ASSETS_SPEC.md`，
  校验 `node tools/validate-anim-assets.mjs`）；清单运行时引用 WebP，PNG 源帧不进安装包。

## 与既有系统的边界

| 系统 | 职责 | 与 FSM 的关系 |
| --- | --- | --- |
| task.js / taskBubble | HUD 文案与进度 | 权威。renderer 桥接 HUD→FSM（FSM 不回写 HUD，无回环） |
| lifeState.js | 空闲策略权重（时段/余额/深夜） | 提供 `pickIdle` 策略与「状态举牌」冷却 |
| bubble.js | 气泡队列/分页 | PetBrain 在状态进入时投递台词 |
| pet.js | 互动反馈/心情/眨眼 | 通过 `fsmVisualGate()` 感知 FSM：基础态之外不抢立绘 |
| drag.js / desktop.js | 拖拽/穿透 | 不变；拖拽的抓起表现覆盖 PETTING 立绘属预期 |

## 测试

`npm test` → `tests/fsm.test.mjs`（手动时钟 ManualClock 确定性验证）：
循环切换、优先级打断/拒绝、时长与回退、幂等、活动重置、GOODBYE 锁定、
setAutoCycle 开关、协议键同步等 14 个用例。
