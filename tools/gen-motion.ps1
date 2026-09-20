# Procedural 24fps motion clips for all FSM states (route A spec):
# canvas 480x640, feet anchor (240,600), first/last frame = neutral pose.
# Output: assets/anim_<STATE>.webp (animated, alpha). ASCII comments only.
Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$assets = Join-Path $root 'assets'
$tmp = Join-Path $env:TEMP 'dsp-motion'
Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $tmp | Out-Null

$CW = 480; $CH = 640; $AX = 240; $AY = 600   # canvas + feet anchor

function New-Canvas {
  $bmp = [System.Drawing.Bitmap]::new($script:CW, $script:CH)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  return @($bmp, $g)
}

function Save-Frame($bmp, [string]$state, [int]$i) {
  $d = Join-Path $script:tmp $state
  New-Item -ItemType Directory -Force -Path $d | Out-Null
  $bmp.Save((Join-Path $d ("f{0:d4}.png" -f $i)), [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
}

# Draw sprite scaled to target height, bottom-center anchored at (AX, AY),
# with optional extra transform: rotate around (ax, ay - h*0.5) and lift.
function Draw-Actor($g, $img, [float]$targetH, [float]$rotDeg, [float]$liftPx, [float]$sx, [float]$sy, [float]$alpha) {
  $w = $img.Width * ($targetH / $img.Height) * $sx
  $h = $targetH * $sy
  $mx = $script:AX
  $my = $script:AY - $h * 0.5 - $liftPx
  $g.TranslateTransform($mx, $my)
  $g.RotateTransform($rotDeg)
  $cmx = [System.Drawing.Imaging.ColorMatrix]::new()
  $cmx.Matrix33 = [float]$alpha
  $cm = [System.Drawing.Imaging.ImageAttributes]::new()
  $cm.SetColorMatrix($cmx)
  $destRect = [System.Drawing.Rectangle]::new([int](-$w / 2), [int](-$h / 2), [int]$w, [int]$h)
  $g.DrawImage($img, $destRect, 0, 0, $img.Width, $img.Height, [System.Drawing.GraphicsUnit]::Pixel, $cm)
  $g.ResetTransform()
  $cm.Dispose(); $cmx.Dispose()
}

# Load source sprite
function Spr([string]$name) {
  return [System.Drawing.Image]::FromFile((Join-Path $script:assets "$name.png"))
}

function Ease([float]$t) { # smoothstep 0..1
  return $t * $t * (3 - 2 * $t)
}

$report = @()

# ============ WALK: hop cycle (24f) ============
$src = Spr 'char_walk'
$N = 24
for ($i = 0; $i -lt $N; $i++) {
  $bmp, $g = New-Canvas
  $ph = $i / $N * 2 * [math]::PI
  $lift = [math]::Abs([math]::Sin($ph)) * 16
  $rot = [math]::Sin($ph) * 5
  Draw-Actor $g $src 560 $rot $lift 1.0 1.0 1.0
  Save-Frame $bmp 'WALK' $i
  $g.Dispose()
}
$src.Dispose(); $report += 'WALK'

# ============ REST: lie + breathing (48f) ============
$src = Spr 'char_lie'
$N = 48
for ($i = 0; $i -lt $N; $i++) {
  $bmp, $g = New-Canvas
  $t = $i / $N
  $sy = 1.0 + [math]::Sin($t * 2 * [math]::PI) * 0.015
  Draw-Actor $g $src 500 0 0 1.02 $sy 1.0
  Save-Frame $bmp 'REST' $i
  $g.Dispose()
}
$src.Dispose(); $report += 'REST'

# ============ ROLL: full tumble (24f, 1 turn) ============
$src = Spr 'char_happy'
$N = 24
for ($i = 0; $i -lt $N; $i++) {
  $bmp, $g = New-Canvas
  $t = Ease($i / $N)
  $rot = $t * 360
  $cx = $script:AX + [math]::Sin($i / $N * 4 * [math]::PI) * 26
  $cy = $script:AY - 250
  $w = $src.Width * 0.86
  $h = $src.Height * 0.86
  $g.TranslateTransform($cx, $cy)
  $g.RotateTransform($rot)
  $g.DrawImage($src, [float](-$w / 2), [float](-$h / 2), [float]$w, [float]$h)
  $g.ResetTransform()
  Save-Frame $bmp 'ROLL' $i
  $g.Dispose()
}
$src.Dispose(); $report += 'ROLL'

# ============ STRETCH: scale up-hold-down (29f) ============
$src = Spr 'char_main'
$N = 29
for ($i = 0; $i -lt $N; $i++) {
  $bmp, $g = New-Canvas
  $t = $i / ($N - 1)
  $s = 0.0
  if ($t -lt 0.4) { $u = $t / 0.4; $s = Ease $u }
  elseif ($t -lt 0.6) { $s = 1.0 }
  else { $u = ($t - 0.6) / 0.4; $s = 1.0 - (Ease $u) }
  $sx = 1 + 0.05 * $s
  $sy = 1 - 0.06 * $s
  Draw-Actor $g $src 560 0 0 $sx $sy 1.0
  Save-Frame $bmp 'STRETCH' $i
  $g.Dispose()
}
$src.Dispose(); $report += 'STRETCH'

# ============ PETTING: happy bounce (29f) ============
$src = Spr 'char_happy'
$N = 29
for ($i = 0; $i -lt $N; $i++) {
  $bmp, $g = New-Canvas
  $ph = $i / $N * 2 * [math]::PI * 2
  $lift = [math]::Abs([math]::Sin($ph)) * 12
  $rot = [math]::Sin($ph) * 3
  Draw-Actor $g $src 560 $rot $lift 1.0 1.0 1.0
  Save-Frame $bmp 'PETTING' $i
  $g.Dispose()
}
$src.Dispose(); $report += 'PETTING'

# ============ LOADING: sleep + rotating spiral (48f, 2 turns) ============
$src = Spr 'char_sleep'
$N = 48
for ($i = 0; $i -lt $N; $i++) {
  $bmp, $g = New-Canvas
  Draw-Actor $g $src 500 0 0 1.0 1.0 1.0
  # spiral above head, rotating
  $g.TranslateTransform(330, 150)
  $g.RotateTransform($i / $N * 720)
  $pen = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(255, 91, 141, 239), 6)
  $pts = [System.Drawing.PointF[]]::new(60)
  $turns = 2.5; $radius = 42
  for ($k = 0; $k -lt 60; $k++) {
    $t = $turns * 2 * [math]::PI * $k / 59
    $r = $radius * $k / 59
    $pts[$k] = [System.Drawing.PointF]::new([float]($r * [math]::Cos($t)), [float]($r * [math]::Sin($t)))
  }
  $g.DrawLines($pen, $pts)
  $pen.Dispose()
  $g.ResetTransform()
  Save-Frame $bmp 'LOADING' $i
  $g.Dispose()
}
$src.Dispose(); $report += 'LOADING'

# ============ CODING: work + typing jitter (48f) ============
$src = Spr 'char_work'
$N = 48
$rnd = [System.Random]::new(7)
for ($i = 0; $i -lt $N; $i++) {
  $bmp, $g = New-Canvas
  $jy = if (($i / 2) % 2 -eq 0) { 0 } else { 2.5 }
  $jx = ($rnd.NextDouble() - 0.5) * 2
  Draw-Actor $g $src 540 $jx $jy 1.0 1.0 1.0
  Save-Frame $bmp 'CODING' $i
  $g.Dispose()
}
$src.Dispose(); $report += 'CODING'

# ============ THINKING: work + bobbing question marks (48f) ============
$src = Spr 'char_work'
$N = 48
for ($i = 0; $i -lt $N; $i++) {
  $bmp, $g = New-Canvas
  $bob = [math]::Sin($i / $N * 2 * [math]::PI) * 8
  Draw-Actor $g $src 540 (0 - $bob * 0.15) 0 1.0 1.0 1.0
  $font = [System.Drawing.Font]::new('Microsoft YaHei', 52, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
  $brush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(255, 91, 141, 239))
  $g.DrawString('?', $font, $brush, [float]380, [float](120 - $bob))
  $font2 = [System.Drawing.Font]::new('Microsoft YaHei', 34, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
  $g.DrawString('?', $font2, $brush, [float]424, [float](190 - $bob * 0.6))
  $font.Dispose(); $font2.Dispose(); $brush.Dispose()
  Save-Frame $bmp 'THINKING' $i
  $g.Dispose()
}
$src.Dispose(); $report += 'THINKING'

# ============ DEBUGGING: error window shake + red line blink (36f) ============
$src = Spr 'char_debug'
$N = 36
for ($i = 0; $i -lt $N; $i++) {
  $bmp, $g = New-Canvas
  $jx = [math]::Sin($i / $N * 4 * [math]::PI) * 4
  Draw-Actor $g $src 540 $jx 0 1.0 1.0 1.0
  Save-Frame $bmp 'DEBUGGING' $i
  $g.Dispose()
}
$src.Dispose(); $report += 'DEBUGGING'

# ============ SUCCESS: happy bounce + confetti rain (72f) ============
$src = Spr 'char_happy'
$N = 72
$confSeeds = @()
$crnd = [System.Random]::new(2024)
for ($k = 0; $k -lt 26; $k++) {
  $confSeeds += @{ x = $crnd.NextDouble() * 440 + 20; y0 = $crnd.NextDouble() * 640; v = 3 + $crnd.NextDouble() * 5; s = 5 + $crnd.NextDouble() * 7; c = $crnd.Next(5) }
}
$colors = @(
  [System.Drawing.Color]::FromArgb(255, 43, 99, 246),
  [System.Drawing.Color]::FromArgb(255, 255, 209, 102),
  [System.Drawing.Color]::FromArgb(255, 255, 107, 157),
  [System.Drawing.Color]::FromArgb(255, 110, 231, 183),
  [System.Drawing.Color]::FromArgb(255, 139, 168, 255)
)
for ($i = 0; $i -lt $N; $i++) {
  $bmp, $g = New-Canvas
  $ph = $i / $N * 2 * [math]::PI * 3
  $lift = [math]::Abs([math]::Sin($ph)) * 14
  Draw-Actor $g $src 560 ([math]::Sin($ph) * 3) $lift 1.0 1.0 1.0
  for ($k = 0; $k -lt $confSeeds.Count; $k++) {
    $c = $confSeeds[$k]
    $y = ($c.y0 + $i * $c.v) % 680 - 20
    $brush = [System.Drawing.SolidBrush]::new($colors[$c.c])
    $g.TranslateTransform([float]$c.x, [float]$y)
    $g.RotateTransform([float](($i * 9 + $k * 40) % 90))
    $g.FillRectangle($brush, [float](-$c.s / 2), [float](-$c.s / 3), [float]$c.s, [float]($c.s / 1.5))
    $g.ResetTransform()
    $brush.Dispose()
  }
  Save-Frame $bmp 'SUCCESS' $i
  $g.Dispose()
}
$src.Dispose(); $report += 'SUCCESS'

# ============ ALERT: alert shake + pulse (36f) ============
$src = Spr 'char_alert'
$N = 36
for ($i = 0; $i -lt $N; $i++) {
  $bmp, $g = New-Canvas
  $jx = [math]::Sin($i / $N * 6 * [math]::PI) * 6
  $pulse = 1 + [math]::Sin($i / $N * 6 * [math]::PI) * 0.02
  Draw-Actor $g $src 560 $jx 0 $pulse $pulse 1.0
  Save-Frame $bmp 'ALERT' $i
  $g.Dispose()
}
$src.Dispose(); $report += 'ALERT'

# ============ REFUSE: head shake (36f) ============
$src = Spr 'char_refuse'
$N = 36
for ($i = 0; $i -lt $N; $i++) {
  $bmp, $g = New-Canvas
  $rot = [math]::Sin($i / $N * 6 * [math]::PI) * 7
  Draw-Actor $g $src 560 $rot 0 1.0 1.0 1.0
  Save-Frame $bmp 'REFUSE' $i
  $g.Dispose()
}
$src.Dispose(); $report += 'REFUSE'

# ============ GOODBYE: wave bob + fade out (48f, no loop) ============
$src = Spr 'char_goodbye'
$N = 48
for ($i = 0; $i -lt $N; $i++) {
  $bmp, $g = New-Canvas
  $ph = $i / $N * 2 * [math]::PI * 2
  $lift = [math]::Abs([math]::Sin($ph)) * 8
  $alpha = if ($i -lt $N - 12) { 1.0 } else { 1.0 - ($i - ($N - 13)) / 12 }
  Draw-Actor $g $src 560 ([math]::Sin($ph) * 2) $lift 1.0 1.0 ([float][math]::Max(0.0, $alpha))
  Save-Frame $bmp 'GOODBYE' $i
  $g.Dispose()
}
$src.Dispose(); $report += 'GOODBYE'

$report | ForEach-Object { Write-Host "rendered $_" }
Write-Host 'all frames done.'
