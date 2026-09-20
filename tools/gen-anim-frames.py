#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
gen-anim-frames.py — 按 docs/ANIMATION_ASSETS_SPEC.md 生成 FSM 三段式序列帧。

硬规格（与 tools/validate-anim-assets.mjs 对齐）：
- 统一画布 720x960，RGBA 全透明背景；
- 脚底锚点固定 (360, 900)：每帧烘焙一枚接触阴影，底边恒在 y=900，
  使校验脚本测得的「最底不透明行」逐帧一致（误差 0px）；
- 三段式 entry/loop/out：entry 首帧 = out 末帧 = IDLE loop 首帧 = 标准站姿 N；
  entry/out 用 N 与 loop 首帧做 alpha 交叉溶解，视觉上无缝；
- loop 相位闭合（sin 周期函数，末帧直连首帧）；
- IDLE loop 48 帧（2s 呼吸周期），全局 24fps。

用法：
  python tools/gen-anim-frames.py                 # 全量生成（PNG + 运行时 WebP + 清单）
  python tools/gen-anim-frames.py --states IDLE,WALK
  python tools/gen-anim-frames.py --no-webp       # 只出 PNG（校验/交付用）

确定性：所有随机均固定种子，重复运行产物一致。
"""
import argparse
import json
import math
import random
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
ASSETS = ROOT / 'assets'
OUT_DIR = ASSETS / 'animations'

CW, CH = 720, 960          # 统一画布
AX, AY = 360, 900          # 脚底锚点
FPS = 24
ACTOR_H = 840              # 演员归一化高度（留 60px 头顶余量 + 60px 锚点以下）
SHADOW_RX, SHADOW_RY = 110, 7
SHADOW_RGBA = (30, 60, 140, 36)   # 接触阴影：alpha>16 使锚点行被稳定检出
FONT_PATH = 'C:/Windows/Fonts/msyh.ttc'


def ease(t: float) -> float:
    """smoothstep 0..1"""
    t = max(0.0, min(1.0, t))
    return t * t * (3 - 2 * t)


# ---------------- 演员 ----------------

def load_sprite(name: str) -> Image.Image:
    for ext in ('.png', '.webp'):
        p = ASSETS / f'{name}{ext}'
        if p.exists():
            return Image.open(p).convert('RGBA')
    raise FileNotFoundError(f'找不到立绘 {name}.png/.webp')


class Actor:
    """裁剪到内容 bbox 的立绘；foot = 裁剪图底边中点。"""

    def __init__(self, name: str):
        img = load_sprite(name)
        alpha = img.getchannel('A').point(lambda a: 255 if a > 16 else 0)
        bbox = alpha.getbbox()
        if not bbox:
            raise ValueError(f'{name} 没有不透明像素')
        self.img = img.crop(bbox)
        self.w, self.h = self.img.size

    def resized(self, target_h: float, sx: float = 1.0, sy: float = 1.0):
        s = target_h / self.h
        rw = max(1, round(self.w * s * sx))
        rh = max(1, round(self.h * s * sy))
        return self.img.resize((rw, rh), Image.BICUBIC), rw, rh


def render_frame(actor_img: Image.Image, rw: int, rh: int, *,
                 rot: float = 0.0, lift: float = 0.0,
                 decorate=None, shadow_alpha: float = 1.0) -> Image.Image:
    """单帧渲染：贴演员（脚底锚定）→ 绕锚点旋转 → 装饰 → 接触阴影。"""
    canvas = Image.new('RGBA', (CW, CH), (0, 0, 0, 0))
    canvas.paste(actor_img, (round(AX - rw / 2), round(AY - lift - rh)), actor_img)
    if rot:
        canvas = canvas.rotate(rot, Image.BICUBIC, center=(AX, AY), fillcolor=(0, 0, 0, 0))
    # 地板裁剪：旋转导致的锚点以下像素一律裁掉（接缝由接触阴影遮盖），
    # 保证「最底不透明行」逐帧恒为锚点行（校验 ±2px 的核心）。
    ImageDraw.Draw(canvas).rectangle((0, AY + 1, CW, CH), fill=(0, 0, 0, 0))
    if decorate:
        decorate(canvas)
    d = ImageDraw.Draw(canvas)
    r, g, b, a = SHADOW_RGBA
    d.ellipse((AX - SHADOW_RX, AY - 2 * SHADOW_RY, AX + SHADOW_RX, AY),
              fill=(r, g, b, round(a * shadow_alpha)))
    return canvas


def with_alpha(img: Image.Image, k: float) -> Image.Image:
    out = img.copy()
    r, g, b, a = out.split()
    out.putalpha(a.point(lambda v: round(v * k)))
    return out


# ---------------- 装饰 ----------------

def deco_spiral(i: int, n: int):
    def draw(canvas: Image.Image):
        d = ImageDraw.Draw(canvas)
        pts = []
        turns, radius = 2.5, 56
        for k in range(60):
            t = turns * 2 * math.pi * k / 59
            r = radius * k / 59
            ang = t + i / n * 4 * math.pi
            pts.append((496 + r * math.cos(ang), 200 + r * math.sin(ang)))
        d.line(pts, fill=(91, 141, 239, 255), width=6, joint='curve')
    return draw


def deco_question(i: int, n: int):
    bob = math.sin(i / n * 2 * math.pi) * 10
    try:
        f1 = ImageFont.truetype(FONT_PATH, 64)
        f2 = ImageFont.truetype(FONT_PATH, 42)
    except OSError:
        f1 = ImageFont.load_default(size=64)
        f2 = ImageFont.load_default(size=42)

    def draw(canvas: Image.Image):
        d = ImageDraw.Draw(canvas)
        d.text((508, 150 - bob), '?', font=f1, fill=(91, 141, 239, 255))
        d.text((560, 240 - bob * 0.6), '?', font=f2, fill=(139, 168, 255, 255))
    return draw


def make_confetti(n_pieces=26, seed=2024):
    rng = random.Random(seed)
    colors = [(43, 99, 246), (255, 209, 102), (255, 107, 157), (110, 231, 183), (139, 168, 255)]
    pieces = [dict(x=rng.uniform(40, 680), y0=rng.uniform(0, 760),
                   v=rng.uniform(2.5, 6.5), s=rng.uniform(6, 13),
                   c=rng.randrange(len(colors)), ph=rng.uniform(0, 90))
              for _ in range(n_pieces)]

    def deco(i: int, n: int):
        def draw(canvas: Image.Image):
            d = ImageDraw.Draw(canvas)
            for p in pieces:
                y = (p['y0'] + i * p['v']) % 800 - 20   # 不落到阴影区，保护锚点
                s = p['s']
                ang = math.radians((i * 9 + p['ph']) % 90)
                ca, sa = math.cos(ang), math.sin(ang)
                rect = [(-s / 2, -s / 3), (s / 2, -s / 3), (s / 2, s / 3), (-s / 2, s / 3)]
                pts = [(p['x'] + px * ca - py * sa, y + px * sa + py * ca) for px, py in rect]
                d.polygon(pts, fill=(*colors[p['c']], 230))
        return draw
    return deco


# ---------------- 各状态运动（loop 首帧变换均为中立：rot=0 lift=0 sx=sy=1） ----------------

def m_idle(i, n):    # 呼吸：绕脚底 scaleY，frame0 sy=1 → 标准站姿
    return dict(sy=1 + 0.015 * math.sin(i / n * 2 * math.pi))

def m_walk(i, n):    # 弹跳步：双步态
    ph = i / n * 4 * math.pi
    return dict(lift=abs(math.sin(ph)) * 14, rot=math.sin(ph) * 4)

def m_rest(i, n):    # 躺卧呼吸
    return dict(sx=1.02, sy=1 + 0.015 * math.sin(i / n * 2 * math.pi))

def m_roll(i, n):    # 整圈翻滚（绕锚点转，阴影保锚）
    return dict(rot=i / n * 360, lift=abs(math.sin(i / n * 2 * math.pi)) * 20)

def m_stretch(i, n):
    t = i / n
    s = ease(t / 0.4) if t < 0.4 else (1.0 if t < 0.6 else 1.0 - ease((t - 0.6) / 0.4))
    return dict(sx=1 + 0.05 * s, sy=1 + 0.07 * s)

def m_petting(i, n):
    ph = i / n * 4 * math.pi
    return dict(lift=abs(math.sin(ph)) * 10, rot=math.sin(ph) * 3)

def m_coding(i, n):  # 打字抖动（周期闭合）
    return dict(rot=math.sin(i / n * 6 * math.pi) * 1.5, lift=(2.5 if i % 4 >= 2 else 0))

def m_thinking(i, n):
    return dict(rot=-math.sin(i / n * 2 * math.pi) * 1.2)

def m_debug(i, n):   # 横向哆嗦
    return dict(rot=math.sin(i / n * 8 * math.pi) * 5)

def m_success(i, n):
    ph = i / n * 6 * math.pi
    return dict(lift=abs(math.sin(ph)) * 12, rot=math.sin(ph) * 3)

def m_alert(i, n):
    s = 1 + math.sin(i / n * 6 * math.pi) * 0.02
    return dict(rot=math.sin(i / n * 6 * math.pi) * 4, sx=s, sy=s)

def m_refuse(i, n):
    return dict(rot=math.sin(i / n * 6 * math.pi) * 6)

def m_goodbye(i, n):
    ph = i / n * 4 * math.pi
    return dict(lift=abs(math.sin(ph)) * 8, rot=math.sin(ph) * 2)


# ---------------- 状态表 ----------------
# repeat: loop 段循环次数；0 = 无限循环（hold 态，直到 FSM 切走）
STATES = {
    'IDLE':      dict(actor='char_main',    loop=48, motion=m_idle,     repeat=0),
    'WALK':      dict(actor='char_walk',    loop=24, motion=m_walk,     repeat=0),
    'REST':      dict(actor='char_lie',     loop=48, motion=m_rest,     repeat=0, actor_h=700),
    'ROLL':      dict(actor='char_happy',   loop=24, motion=m_roll,     repeat=2, actor_h=660),
    'STRETCH':   dict(actor='char_main',    loop=24, motion=m_stretch,  repeat=2),
    'PETTING':   dict(actor='char_happy',   loop=24, motion=m_petting,  repeat=2),
    'LOADING':   dict(actor='char_sleep',   loop=48, motion=m_rest,     repeat=0, deco=deco_spiral),
    'CODING':    dict(actor='char_work',    loop=48, motion=m_coding,   repeat=0),
    'DEBUGGING': dict(actor='char_debug',   loop=36, motion=m_debug,    repeat=0),
    'THINKING':  dict(actor='char_think',   loop=48, motion=m_thinking, repeat=0, deco=deco_question),
    'SUCCESS':   dict(actor='char_success', loop=72, motion=m_success,  repeat=1, deco_factory=make_confetti),
    'ALERT':     dict(actor='char_alert',   loop=36, motion=m_alert,    repeat=2),
    'REFUSE':    dict(actor='char_refuse',  loop=36, motion=m_refuse,   repeat=2),
    'GOODBYE':   dict(actor='char_goodbye', loop=24, motion=m_goodbye,  repeat=1, terminal=True),
}
ENTRY_N = 8   # 交叉溶解帧数（333ms @24fps）


def render_motion_frame(actor: Actor, cfg: dict, i: int, n: int) -> Image.Image:
    m = cfg['motion'](i, n)
    deco = cfg.get('deco')
    deco_fn = deco(i, n) if deco else None
    img, rw, rh = actor.resized(cfg.get('actor_h', ACTOR_H), m.get('sx', 1.0), m.get('sy', 1.0))
    return render_frame(img, rw, rh, rot=m.get('rot', 0.0), lift=m.get('lift', 0.0), decorate=deco_fn)


def save(img: Image.Image, path: Path, webp: bool):
    path.parent.mkdir(parents=True, exist_ok=True)
    img.save(path, 'PNG')
    if webp:
        img.save(path.with_suffix('.webp'), 'WEBP', quality=88, method=4)


def gen_state(name: str, cfg: dict, neutral: Image.Image, webp: bool, out_root: Path):
    actor = Actor(cfg['actor'])
    n_loop = cfg['loop']
    deco_factory = cfg.get('deco_factory')
    if deco_factory:  # 需要实例化的装饰（带内部随机状态）
        cfg = dict(cfg)
        cfg['deco'] = deco_factory()

    # loop 段
    loop_frames = []
    first = None
    for i in range(n_loop):
        frame = render_motion_frame(actor, cfg, i, n_loop)
        if i == 0:
            first = frame
        p = out_root / name / 'loop' / f'frame_{i + 1:04d}.png'
        save(frame, p, webp)
        loop_frames.append(f'{name}/loop/frame_{i + 1:04d}')

    # entry / out：N ⇄ loop 首帧 交叉溶解（entry 首帧 = out 末帧 = N）
    entry_frames, out_frames = [], []
    terminal = cfg.get('terminal', False)
    for j in range(0 if cfg.get('no_entry_out') else ENTRY_N):
        t = ease(j / (ENTRY_N - 1))
        frame_in = neutral.copy()
        frame_in.alpha_composite(with_alpha(first, t))
        p = out_root / name / 'entry' / f'frame_{j + 1:04d}.png'
        save(frame_in, p, webp)
        entry_frames.append(f'{name}/entry/frame_{j + 1:04d}')

        if terminal:  # GOODBYE：out = 整体淡出（演员+阴影），末帧全透明
            frame_out = with_alpha(first, 1.0 - t)
        else:
            frame_out = neutral.copy()
            frame_out.alpha_composite(with_alpha(first, 1.0 - t))
        p = out_root / name / 'out' / f'frame_{j + 1:04d}.png'
        save(frame_out, p, webp)
        out_frames.append(f'{name}/out/frame_{j + 1:04d}')

    # 清单（运行时引用 WebP；PNG 供校验/交付）
    ext = '.webp' if webp else '.png'
    segments = {'loop': [f + ext for f in loop_frames]}
    if not cfg.get('no_entry_out'):
        segments = {'entry': [f + ext for f in entry_frames], **segments,
                    'out': [f + ext for f in out_frames]}
    manifest = {'fps': FPS, 'repeat': cfg['repeat'], 'displayHeight': 320, 'segments': segments}
    (out_root / f'{name}.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding='utf-8')
    print(f'  {name}: loop {n_loop}f + entry/out {ENTRY_N}f -> {out_root / name}')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--states', default='', help='逗号分隔的状态名，缺省全部')
    ap.add_argument('--no-webp', action='store_true', help='只输出 PNG（同时清单引用 PNG）')
    ap.add_argument('--out', default=str(OUT_DIR), help='输出目录（默认 assets/animations）')
    args = ap.parse_args()

    out_root = Path(args.out)
    webp = not args.no_webp
    names = [s.strip().upper() for s in args.states.split(',') if s.strip()] or list(STATES)

    # 标准站姿 N（char_main，无变换，含阴影）——所有段落首尾帧的唯一姿势
    main_actor = Actor('char_main')
    img, rw, rh = main_actor.resized(ACTOR_H)
    neutral = render_frame(img, rw, rh)

    for name in names:
        cfg = STATES.get(name)
        if not cfg:
            print(f'  跳过未知状态 {name}')
            continue
        if name == 'IDLE':
            cfg = dict(cfg, no_entry_out=True)  # IDLE 即衔接点，无需出入段
        gen_state(name, cfg, neutral, webp, out_root)

    print('done.')


if __name__ == '__main__':
    main()
