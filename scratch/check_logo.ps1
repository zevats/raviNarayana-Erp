Add-Type -AssemblyName System.Drawing
$b = [System.Drawing.Bitmap]::FromFile((Resolve-Path "apps/erp/public/logo.png"))
$minX = $b.Width
$maxX = 0
$minY = $b.Height
$maxY = 0

for ($y = 0; $y -lt $b.Height; $y += 4) {
    for ($x = 0; $x -lt $b.Width; $x += 4) {
        $c = $b.GetPixel($x, $y)
        if ($c.R -gt 25 -or $c.G -gt 25 -or $c.B -gt 25) {
            if ($x -lt $minX) { $minX = $x }
            if ($x -gt $maxX) { $maxX = $x }
            if ($y -lt $minY) { $minY = $y }
            if ($y -gt $maxY) { $maxY = $y }
        }
    }
}

Write-Output "Image size: $($b.Width) x $($b.Height)"
Write-Output "Content bounds: ($minX, $minY) to ($maxX, $maxY)"
Write-Output "Content size: $($maxX - $minX) x $($maxY - $minY)"
$b.Dispose()
