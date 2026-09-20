# 从现有立绘派生新姿势素材（一次性生成脚本，产物已提交 assets/）
# 生成：char_sign(低价举牌) char_alert(余额告示) char_lie(趴下休息) avatar(方头像) roll 帧序列
# 用法：powershell -NoProfile -ExecutionPolicy Bypass -File tools/gen-poses.ps1
Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$assets = Join-Path $root 'assets'
$rollDir = Join-Path $env:TEMP 'dsp-roll'
New-Item -ItemType Directory -Force -Path $rollDir | Out-Null

function New-Canvas([int]$w, [int]$h) {
  $bmp = [System.Drawing.Bitmap]::new($w, $h)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAlias
  return @($bmp, $g)
}

function Draw-RoundedSign($g, [float]$x, [float]$y, [float]$w, [float]$h, [float]$angle, [string]$fillHex, [string]$text, [float]$fontSize) {
  $g.TranslateTransform($x + $w / 2, $y + $h / 2)
  $g.RotateTransform($angle)
  $path = [System.Drawing.Drawing2D.GraphicsPath]::new()
  $r = 26
  $left = -$w / 2; $top = -$h / 2; $right = $w / 2; $bottom = $h / 2
  $path.AddArc($left, $top, 2 * $r, 2 * $r, 180, 90)
  $path.AddArc($right - 2 * $r, $top, 2 * $r, 2 * $r, 270, 90)
  $path.AddArc($right - 2 * $r, $bottom - 2 * $r, 2 * $r, 2 * $r, 0, 90)
  $path.AddArc($left, $bottom - 2 * $r, 2 * $r, 2 * $r, 90, 90)
  $path.CloseFigure()
  $borderPen = [System.Drawing.Pen]::new([System.Drawing.Color]::White, 7)
  $g.DrawPath($borderPen, $path)
  $fill = [System.Drawing.ColorTranslator]::FromHtml($fillHex)
  $brush = [System.Drawing.SolidBrush]::new($fill)
  $g.FillPath($brush, $path)
  $font = [System.Drawing.Font]::new('Microsoft YaHei', $fontSize, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
  $fmt = [System.Drawing.StringFormat]::new()
  $fmt.Alignment = [System.Drawing.StringAlignment]::Center
  $fmt.LineAlignment = [System.Drawing.StringAlignment]::Center
  $box = [System.Drawing.RectangleF]::new($left, $top - 2, $w, $h)
  $g.DrawString($text, $font, [System.Drawing.Brushes]::White, $box, $fmt)
  $g.ResetTransform()
}

function Save-Png($bmp, [string]$path) {
  $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  Write-Host "saved $path"
}

# Sign text via char codes (script file must survive any codepage)
$lowChars = @(0x4F4E, 0x4EF7, 0xFF01)
$chargeChars = @(0x5FEB, 0x5145, 0x503C, 0xFF01)
$textLow = -join ($lowChars | ForEach-Object { [char]$_ })
$textCharge = -join ($chargeChars | ForEach-Object { [char]$_ })

# ---------- 1. char_sign：main 举「低价！」牌 ----------
$src = [System.Drawing.Image]::FromFile((Join-Path $assets 'char_main.png'))
$W = 660; $H = 600
$bmp, $g = New-Canvas $W $H
$g.DrawImage($src, 80, 0, $src.Width, $src.Height)
Draw-RoundedSign $g 6 84 210 132 8 '#2B63F6' $textLow 58
$stickPen = [System.Drawing.Pen]::new([System.Drawing.Color]::White, 6)
$g.DrawLine($stickPen, 128, 216, 150, 330)
Save-Png $bmp (Join-Path $assets 'char_sign.png')
$g.Dispose(); $bmp.Dispose(); $src.Dispose()

# ---------- 2. char_alert：surprise 举「快充值！」牌 ----------
$src = [System.Drawing.Image]::FromFile((Join-Path $assets 'char_surprise.png'))
$W = 580; $H = 600
$bmp, $g = New-Canvas $W $H
$g.DrawImage($src, 120, 0, $src.Width, $src.Height)
Draw-RoundedSign $g 0 78 224 120 -7 '#E04444' $textCharge 46
$stickPen = [System.Drawing.Pen]::new([System.Drawing.Color]::White, 6)
$g.DrawLine($stickPen, 126, 198, 162, 322)
Save-Png $bmp (Join-Path $assets 'char_alert.png')
$g.Dispose(); $bmp.Dispose(); $src.Dispose()

# ---------- 3. char_lie：sleep 趴桌（明显压扁 + 微转，做出瘫倒感） ----------
$src = [System.Drawing.Image]::FromFile((Join-Path $assets 'char_sleep.png'))
$W = $src.Width; $H = $src.Height
$bmp, $g = New-Canvas $W $H
$g.TranslateTransform($W / 2, $H)
$g.RotateTransform(-8)
$g.ScaleTransform(1.06, 0.72)
$g.DrawImage($src, (-$W / 2), -$H, $W, $H)
$g.ResetTransform()
Save-Png $bmp (Join-Path $assets 'char_lie.png')
$g.Dispose(); $bmp.Dispose(); $src.Dispose()

# ---------- 4. avatar：happy 方形头像裁切 ----------
$src = [System.Drawing.Image]::FromFile((Join-Path $assets 'char_happy.png'))
$size = 320
$cropX = 96; $cropY = 66
$bmp, $g = New-Canvas 256 256
$destRect = [System.Drawing.Rectangle]::new(0, 0, 256, 256)
$g.DrawImage($src, $destRect, $cropX, $cropY, $size, $size, [System.Drawing.GraphicsUnit]::Pixel)
Save-Png $bmp (Join-Path $assets 'avatar.png')
$g.Dispose(); $bmp.Dispose(); $src.Dispose()

# ---------- 5. roll 打滚卖萌帧序列（happy 摇摆旋转） ----------
$src = [System.Drawing.Image]::FromFile((Join-Path $assets 'char_happy.png'))
$W = 680; $H = 780
$angles = @(-12, -6, 0, 6, 12, 6, 0, -6)
$i = 0
foreach ($a in $angles) {
  $bmp, $g = New-Canvas $W $H
  $g.TranslateTransform($W / 2, $H - 20)
  $g.RotateTransform($a)
  $g.DrawImage($src, (-$src.Width / 2), -$src.Height, $src.Width, $src.Height)
  $framePath = Join-Path $rollDir ("frame{0:d2}.png" -f $i)
  Save-Png $bmp $framePath
  $g.Dispose(); $bmp.Dispose()
  $i++
}
$src.Dispose()

Write-Host 'PNG done. Convert webp via ffmpeg next.'
