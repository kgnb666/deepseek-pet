# 动画素材交付规格（丝滑无缝动画的验收标准）

> 目标：复刻 dsh-pet-indesktop 的丝滑动画（它 = 97 段 24fps 预渲染透明 WebM，非 3D）。
> 本文档是给画师 / AI 工具 / 你自己的交付标准。素材合格后零代码接入 FSM。
> 校验：`node tools/validate-anim-assets.mjs`

## 路线对比

| 路线 | 你提供 | 效果天花板 | 成本量级 |
| --- | --- | --- | --- |
| A. 透明序列帧 / 带 alpha 视频（dsh-pet 同款） | PNG 序列 或 WebM/MOV(alpha) | 与 dsh-pet 完全同级 | 画师按张/按段计费，或 AI 视频工具 |
| B. 分层 PSD | 分层源文件（组名见下） | 眨眼/口型/发丝摆动级 | 中（一次性分层） |
| C. Live2D 模型 | .moc3 全套 | 参数化无缝，最高档 | 委托 rigging 数百~数千元，需分层 PSD |

## 状态清单（与 FSM 一一对应，缺省状态自动回退现有立绘）

基础/循环：`IDLE`（待机呼吸循环，最重要，优先做）、`WALK`、`REST`、`ROLL`、`STRETCH`
互动：`PETTING`
功能：`LOADING`、`CODING`、`DEBUGGING`、`THINKING`
系统：`SUCCESS`、`ALERT`、`REFUSE`、`GOODBYE`（一次性，不循环）

## 硬性规格（"无缝"的全部秘密都在这）

1. **统一画布**：所有状态、所有帧同一尺寸（推荐 **720×960** 竖版）。
2. **统一锚点**：角色**脚底**在每一帧都落在同一像素位置（推荐 x=360, y=900，误差 ≤2px）。
   锚点漂移 = 状态切换时角色"跳一下"，这是不平滑的头号原因。
3. **三段式结构**（无缝衔接的核心）：
   - 每个动作拆 `entry`（从待机姿势进入动作）+ `loop`（循环主体）+ `out`（回到待机姿势）；
   - `entry` 首帧 = `loop` 首帧 = `out` 末帧 = **IDLE 循环的某一帧**（同一姿势）；
   - 最简做法：所有段落的首尾帧都摆成同一个标准站姿。
4. **循环段无缝**：`loop` 的末帧必须能直连首帧（动作相位闭合）。
5. **透明通道**：背景全透明（alpha=0），不得有白底/黑底/半透明底光晕。
6. **帧率**：24fps（最低 12）；`IDLE` 循环 ≥ 48 帧（2 秒呼吸周期）。
7. **命名**（PNG 序列，每状态一个目录）：

```text
assets/animations/
├── IDLE/
│   ├── loop/frame_0001.png ... frame_0048.png
├── WALK/
│   ├── entry/frame_0001.png ...
│   ├── loop/frame_0001.png ...
│   ├── out/frame_0001.png ...
├── SUCCESS/
│   ├── entry/...  loop/...  out/...
└── ...
```

8. **视频交付**（可选，代替 PNG 序列）：VP9 WebM 带 alpha（`ffmpeg -c:v libvpx-vp9 -pix_fmt yuva420p`）
   或 ProRes 4444 MOV；每个文件对应一段（`WALK_entry.webm` / `WALK_loop.webm` / `WALK_out.webm`）。

## 路线 B：分层 PSD 组名（程序化 rig 用）

`hair_front` / `hair_back` / `ahoge` / `body` / `arm_L` / `arm_R` / `tail` /
`face` / `eye_L_open` `eye_L_close` / `eye_R_open` `eye_R_close` / `mouth_smile` `mouth_talk` `mouth_surprise`
（同组多层 = 动画帧；我会做换装式眨眼/口型 + 部件摆动）

## 路线 C：Live2D 交付物

`model.model3.json` + `.moc3` + 贴图 + `physics.json` + 动作组（与上面状态同名）。
集成方式：pixi-live2d-display，FSM 状态 → motion group 映射（我来写）。

## 我这边的接入（素材到位后）✅ 已实现

- PNG 序列：`tools/gen-anim-frames.py` 生成帧 + 三段式清单（`assets/animations/<STATE>.json`），
  `src/modules/fsm/animPlayer.js` 播放（out → entry → loop → out 全自动衔接，代际令牌防竞态）；
- 带 alpha WebM：`#pet-video` 直播（已有通道）；也可 ffmpeg 抽帧后走序列帧管线
  （dsh-pet 垫片已验证：482 帧重锚后全过校验）；
- 校验不过的素材会输出具体哪一帧、哪个维度不合格（`node tools/validate-anim-assets.mjs`）。
- 体积约定：清单运行时引用 WebP；PNG 源帧仅作交付/校验，安装包经
  `!assets/animations/**/*.png` 排除。
