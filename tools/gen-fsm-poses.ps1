# Derive FSM pose assets from existing sprites (one-shot generator).
# Output: char_loading(anim) char_debug char_think char_success char_refuse char_goodbye
# Usage: powershell -NoProfile -ExecutionPolicy Bypass -File tools/gen-fsm-poses.ps1
Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$assets = Join-Path $root 'assets'
$loadDir = Join-Path $env:TEMP 'dsp-loading'
New-Item -ItemType Directory -Force -Path $loadDir | Out-Null

function New-Canvas([int]$w, [int]$h) {
  $bmp = [System.Drawing.Bitmap]::new($w, $h)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAlias
  return @($bmp, $g)
}

function Save-Png($bmp, [string]$path) {
  $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  Write-Host "saved $path"
}

function Draw-Spiral($g, [float]$cx, [float]$cy, [float]$radius, [float]$turns, [float]$angleDeg, [int]$rgb) {
  # Archimedean spiral (2.5 turns), rotated per-frame for the loading animation
  $g.TranslateTransform($cx, $cy)
  $g.RotateTransform($angleDeg)
  $outer = [System.Drawing.Color]::White
  $blue = [System.Drawing.Color]::FromArgb(255, $rgb, [int](99/2), 246/1) # placeholder replaced below
  $pen = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(255, 91, 141, 239), 7)
  $penLine = [System.Drawing.Pen]::new([System.Drawing.Color]::White, 3)
  $pts = [System.Drawing.PointF[]]::new(72)
  $total = 2 * [math]::PI * $turns
  for ($i = 0; $i -lt 72; $i++) {
    $t = $total * $i / 71
    $r = $radius * $t / $total
    $pts[$i] = [System.Drawing.PointF]::new([float]($r * [math]::Cos($t)), [float]($r * [math]::Sin($t)))
  }
  $g.DrawLines($pen, $pts)
  $g.ResetTransform()
  $pen.Dispose(); $penLine.Dispose()
}

function Draw-Confetti($g, [int]$seed, [float]$x0, [float]$y0, [float]$x1, [float]$y1, [int]$count) {
  $rnd = [System.Random]::new($seed)
  $colors = @(
    [System.Drawing.Color]::FromArgb(255, 43, 99, 246),
    [System.Drawing.Color]::FromArgb(255, 255, 209, 102),
    [System.Drawing.Color]::FromArgb(255, 255, 107, 157),
    [System.Drawing.Color]::FromArgb(255, 110, 231, 183),
    [System.Drawing.Color]::FromArgb(255, 139, 168, 255)
  )
  for ($i = 0; $i -lt $count; $i++) {
    $c = $colors[$rnd.Next($colors.Count)]
    $brush = [System.Drawing.SolidBrush]::new($c)
    $x = $x0 + $rnd.NextDouble() * ($x1 - $x0)
    $y = $y0 + $rnd.NextDouble() * ($y1 - $y0)
    $w = 6 + $rnd.NextDouble() * 8
    $h = 4 + $rnd.NextDouble() * 6
    $g.TranslateTransform([float]$x, [float]$y)
    $g.RotateTransform([float]($rnd.NextDouble() * 90))
    if ($rnd.NextDouble() -lt 0.5) {
      $g.FillRectangle($brush, [float](-$w / 2), [float](-$h / 2), [float]$w, [float]$h)
    } else {
      $g.FillEllipse($brush, [float](-$w / 2), [float](-$h / 2), [float]$w, [float]$w)
    }
    $g.ResetTransform()
    $brush.Dispose()
  }
}

function Draw-Bubble($g, [float]$x, [float]$y, [float]$w, [float]$h, [float]$angle, [string]$fillHex, [string]$borderHex, [string]$text, [string]$textHex, [float]$fontSize, [bool]$italic) {
  $g.TranslateTransform($x + $w / 2, $y + $h / 2)
  $g.RotateTransform($angle)
  $path = [System.Drawing.Drawing2D.GraphicsPath]::new()
  $r = 20
  $left = -$w / 2; $top = -$h / 2; $right = $w / 2; $bottom = $h / 2
  $path.AddArc($left, $top, 2 * $r, 2 * $r, 180, 90)
  $path.AddArc($right - 2 * $r, $top, 2 * $r, 2 * $r, 270, 90)
  $path.AddArc($right - 2 * $r, $bottom - 2 * $r, 2 * $r, 2 * $r, 0, 90)
  $path.AddArc($left, $bottom - 2 * $r, 2 * $r, 2 * $r, 90, 90)
  $path.CloseFigure()
  $pen = [System.Drawing.Pen]::new([System.Drawing.ColorTranslator]::FromHtml($borderHex), 5)
  $g.DrawPath($pen, $path)
  $brush = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml($fillHex))
  $g.FillPath($brush, $path)
  $font = [System.Drawing.Font]::new('Arial', $fontSize, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
  if ($italic) { $font = [System.Drawing.Font]::new('Arial', $fontSize, ([System.Drawing.FontStyle]::Bold -bor [System.Drawing.FontStyle]::Italic), [System.Drawing.GraphicsUnit]::Pixel) }
  $fmt = [System.Drawing.StringFormat]::new()
  $fmt.Alignment = [System.Drawing.StringAlignment]::Center
  $fmt.LineAlignment = [System.Drawing.StringAlignment]::Center
  $tBrush = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml($textHex))
  $box = [System.Drawing.RectangleF]::new($left, $top, $w, $h)
  $g.DrawString($text, $font, $tBrush, $box, $fmt)
  $g.ResetTransform()
}

function Draw-Suitcase($g, [float]$x, [float]$y, [float]$w, [float]$h) {
  $blue = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(255, 77, 132, 255))
  $dark = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(255, 43, 80, 200))
  $white = [System.Drawing.Pen]::new([System.Drawing.Color]::White, 4)
  # handle
  $handlePen = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(255, 43, 80, 200), 8)
  $g.DrawArc($handlePen, $x + $w / 2 - 24, $y - 16, 48, 30, 180, 180)
  # body (rounded via path)
  $path = [System.Drawing.Drawing2D.GraphicsPath]::new()
  $r = 14
  $path.AddArc($x, $y, 2 * $r, 2 * $r, 180, 90)
  $path.AddArc($x + $w - 2 * $r, $y, 2 * $r, 2 * $r, 270, 90)
  $path.AddArc($x + $w - 2 * $r, $y + $h - 2 * $r, 2 * $r, 2 * $r, 0, 90)
  $path.AddArc($x, $y + $h - 2 * $r, 2 * $r, 2 * $r, 90, 90)
  $path.CloseFigure()
  $g.FillPath($blue, $path)
  # white vertical band + horizontal trim
  $band = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(255, 219, 233, 255))
  $g.FillRectangle($band, $x + $w / 2 - 12, $y, 24, $h)
  $g.DrawLine($white, $x, $y + 12, $x + $w, $y + 12)
  $g.DrawLine($white, $x, $y + $h - 12, $x + $w, $y + $h - 12)
  # wheels
  $g.FillEllipse($dark, $x + 12, $y + $h - 4, 14, 14)
  $g.FillEllipse($dark, $x + $w - 26, $y + $h - 4, 14, 14)
  $path.Dispose(); $blue.Dispose(); $dark.Dispose(); $band.Dispose()
  $white.Dispose(); $handlePen.Dispose()
}

function Draw-ErrorWindow($g, [float]$x, [float]$y, [float]$w, [float]$h) {
  $whiteB = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::White)
  $red = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(255, 224, 68, 68))
  $gray = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(255, 176, 190, 214))
  $redLine = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(255, 255, 128, 128))
  # window
  $g.FillRectangle($whiteB, $x, $y, $w, $h)
  $border = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(255, 91, 141, 239), 3)
  $g.DrawRectangle($border, $x, $y, $w, $h)
  # title bar with X
  $g.FillRectangle($red, $x, $y, $w, 22)
  $xPen = [System.Drawing.Pen]::new([System.Drawing.Color]::White, 2.5)
  $cx = $x + $w - 12; $cy = $y + 11
  $g.DrawLine($xPen, $cx - 4, $cy - 4, $cx + 4, $cy + 4)
  $g.DrawLine($xPen, $cx + 4, $cy - 4, $cx - 4, $cy + 4)
  # code lines (one red = the bug)
  $g.FillRectangle($gray, $x + 10, $y + 34, $w - 34, 8)
  $g.FillRectangle($redLine, $x + 10, $y + 52, $w - 20, 8)
  $g.FillRectangle($gray, $x + 10, $y + 70, $w - 44, 8)
  $g.FillRectangle($gray, $x + 10, $y + 88, $w - 28, 8)
  # warning badge
  $g.FillEllipse($red, $x + $w - 26, $y + $h - 26, 26, 26)
  $xB2 = [System.Drawing.Pen]::new([System.Drawing.Color]::White, 3)
  $wx = $x + $w - 13; $wy = $y + $h - 13
  $g.DrawLine($xB2, $wx - 5, $wy - 5, $wx + 5, $wy + 5)
  $g.DrawLine($xB2, $wx + 5, $wy - 5, $wx - 5, $wy + 5)
  $whiteB.Dispose(); $red.Dispose(); $gray.Dispose(); $redLine.Dispose()
  $border.Dispose(); $xPen.Dispose(); $xB2.Dispose()
}

# ---------- 1. char_loading: char_sleep + rotating spiral (8-frame anim) ----------
$src = [System.Drawing.Image]::FromFile((Join-Path $assets 'char_sleep.png'))
$W = 600; $H = 680
for ($f = 0; $f -lt 8; $f++) {
  $bmp, $g = New-Canvas $W $H
  $g.DrawImage($src, 12, 90, $src.Width, $src.Height)
  Draw-Spiral $g 430 120 58 2.5 ($f * 45) 0
  Save-Png $bmp (Join-Path $loadDir ("load{0:d2}.png" -f $f))
  $g.Dispose(); $bmp.Dispose()
}
$src.Dispose()

# ---------- 2. char_debug: char_work + floating error window ----------
$src = [System.Drawing.Image]::FromFile((Join-Path $assets 'char_work.png'))
$bmp, $g = New-Canvas 780 600
$g.DrawImage($src, 0, 0, $src.Width, $src.Height)
Draw-ErrorWindow $g 590 130 165 125
Save-Png $bmp (Join-Path $assets 'char_debug.png')
$g.Dispose(); $bmp.Dispose(); $src.Dispose()

# ---------- 3. char_think: char_main + question marks ----------
$src = [System.Drawing.Image]::FromFile((Join-Path $assets 'char_main.png'))
$bmp, $g = New-Canvas 700 600
$g.DrawImage($src, 10, 0, $src.Width, $src.Height)
$fontBig = [System.Drawing.Font]::new('Microsoft YaHei', 66, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
$fontMid = [System.Drawing.Font]::new('Microsoft YaHei', 42, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
$blueT = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(255, 91, 141, 239))
$g.TranslateTransform(600, 130); $g.RotateTransform(12)
$g.DrawString('?', $fontBig, $blueT, -20, -40); $g.ResetTransform()
$g.TranslateTransform(650, 220); $g.RotateTransform(-8)
$g.DrawString('?', $fontMid, $blueT, -12, -26); $g.ResetTransform()
$g.TranslateTransform(570, 60); $g.RotateTransform(-14)
$g.DrawString('?', $fontMid, $blueT, -12, -26); $g.ResetTransform()
Save-Png $bmp (Join-Path $assets 'char_think.png')
$g.Dispose(); $bmp.Dispose(); $src.Dispose()

# ---------- 4. char_success: char_happy + confetti + check badge ----------
$src = [System.Drawing.Image]::FromFile((Join-Path $assets 'char_happy.png'))
$bmp, $g = New-Canvas 640 600
$g.DrawImage($src, 60, 0, $src.Width, $src.Height)
Draw-Confetti $g 42 30 20 260 250 16
Draw-Confetti $g 77 380 20 620 250 16
Draw-Confetti $g 91 240 30 400 130 8
# check badge
$green = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(255, 18, 183, 106))
$g.FillEllipse($green, 552, 52, 56, 56)
$cp = [System.Drawing.Pen]::new([System.Drawing.Color]::White, 7)
$cp.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
$cp.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
$g.DrawLine($cp, 568, 82, 578, 92)
$g.DrawLine($cp, 578, 92, 596, 68)
Save-Png $bmp (Join-Path $assets 'char_success.png')
$g.Dispose(); $bmp.Dispose(); $src.Dispose(); $green.Dispose(); $cp.Dispose()

# ---------- 5. char_refuse: char_angry + "No!" bubble ----------
$src = [System.Drawing.Image]::FromFile((Join-Path $assets 'char_angry.png'))
$bmp, $g = New-Canvas 600 600
$g.DrawImage($src, 130, 0, $src.Width, $src.Height)
Draw-Bubble $g 10 60 170 105 -6 '#FFFFFF' '#E04444' 'No!' '#E04444' 48 $true
$tail = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(255, 224, 68, 68), 5)
$g.DrawLine($tail, 150, 170, 185, 240)
Save-Png $bmp (Join-Path $assets 'char_refuse.png')
$g.Dispose(); $bmp.Dispose(); $src.Dispose()

# ---------- 6. char_goodbye: char_happy + suitcase ----------
$src = [System.Drawing.Image]::FromFile((Join-Path $assets 'char_happy.png'))
$bmp, $g = New-Canvas 660 600
$g.DrawImage($src, 0, 0, $src.Width, $src.Height)
Draw-Suitcase $g 505 395 120 155
Save-Png $bmp (Join-Path $assets 'char_goodbye.png')
$g.Dispose(); $bmp.Dispose(); $src.Dispose()

Write-Host 'FSM poses done.'
