# Derive a walking sprite: transplante happy face onto the standing body, then
# build a 4-frame chibi hop-walk cycle (Shimeji style). ASCII comments only.
Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$assets = Join-Path $root 'assets'
$walkDir = Join-Path $env:TEMP 'dsp-walk'
New-Item -ItemType Directory -Force -Path $walkDir | Out-Null

function New-Canvas([int]$w, [int]$h) {
  $bmp = [System.Drawing.Bitmap]::new($w, $h)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  return @($bmp, $g)
}

function Save-Png($bmp, [string]$path) {
  $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  Write-Host "saved $path"
}

# ---------- 1. face transplant ----------
# char_angry (406x600) standing body, char_happy (496x600) face.
# Face ellipse centers measured on the sprites; both same character/style.
$base = [System.Drawing.Image]::FromFile((Join-Path $assets 'char_angry.png'))
$happy = [System.Drawing.Image]::FromFile((Join-Path $assets 'char_happy.png'))

$angryFace = @{ cx = 203; cy = 248; rx = 98; ry = 82 }
$happyFace = @{ cx = 250; cy = 258; rx = 112; ry = 92 }

$bmp, $g = New-Canvas 406 600
$g.DrawImage($base, 0, 0, $base.Width, $base.Height)
# clip to angry face ellipse, then draw happy offset so the faces coincide
$path = [System.Drawing.Drawing2D.GraphicsPath]::new()
$path.AddEllipse($angryFace.cx - $angryFace.rx, $angryFace.cy - $angryFace.ry, 2 * $angryFace.rx, 2 * $angryFace.ry)
$g.SetClip($path)
$dx = $angryFace.cx - $happyFace.cx
$dy = $angryFace.cy - $happyFace.cy
$g.DrawImage($happy, $dx, $dy, $happy.Width, $happy.Height)
$g.ResetClip()
Save-Png $bmp (Join-Path $assets 'char_walk.png')
$g.Dispose(); $bmp.Dispose()

# ---------- 2. 4-frame hop-walk cycle ----------
$W = 500; $H = 660
$src2 = [System.Drawing.Image]::FromFile((Join-Path $assets 'char_walk.png'))
$config = @(
  @{ a = 0; lift = 0; sx = 1.00; sy = 1.00 },
  @{ a = -5; lift = 14; sx = 1.02; sy = 0.98 },
  @{ a = 0; lift = 0; sx = 1.03; sy = 0.96 },
  @{ a = 5; lift = 14; sx = 1.02; sy = 0.98 }
)
$i = 0
foreach ($c in $config) {
  $bmp, $g = New-Canvas $W $H
  $g.TranslateTransform($W / 2, $H - 16)   # anchor: bottom center (feet stay planted)
  $g.RotateTransform($c.a)
  $g.TranslateTransform(0, -$c.lift)
  $g.ScaleTransform($c.sx, $c.sy)
  $g.DrawImage($src2, (-$src2.Width / 2), -$src2.Height, $src2.Width, $src2.Height)
  $framePath = Join-Path $walkDir ("walk{0:d2}.png" -f $i)
  Save-Png $bmp $framePath
  $g.Dispose(); $bmp.Dispose()
  $i++
}
$src2.Dispose(); $base.Dispose(); $happy.Dispose()
Write-Host 'walk assets done.'
