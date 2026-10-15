Add-Type -AssemblyName System.Drawing
$b = [System.Drawing.Bitmap]::FromFile((Resolve-Path "scratch/login_mobile_v4.png"))
$y = 400
$left = -1
$right = -1
for ($x = 0; $x -lt $b.Width; $x++) {
    $c = $b.GetPixel($x, $y)
    if ($c.R -gt 245 -and $c.G -gt 245 -and $c.B -gt 245) {
        if ($left -eq -1) { $left = $x }
        $right = $x
    }
}
Write-Output "Image width: $($b.Width), height: $($b.Height)"
Write-Output "Card Left: $left, Right: $right, Width: $($right - $left)"
$b.Dispose()
