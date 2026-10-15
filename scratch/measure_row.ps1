Add-Type -AssemblyName System.Drawing
$b = [System.Drawing.Bitmap]::FromFile((Resolve-Path "scratch/login_mobile_v7.png"))

$y = 400
$bg = $b.GetPixel(0, $y)
Write-Output "Background color at (0, $y): R=$($bg.R) G=$($bg.G) B=$($bg.B)"

$cardLeft = -1
$cardRight = -1
for ($x = 0; $x -lt $b.Width; $x++) {
    $c = $b.GetPixel($x, $y)
    # Check if this pixel is inside the white card (R > 250, G > 250, B > 250)
    if ($c.R -gt 250 -and $c.G -gt 250 -and $c.B -gt 250) {
        if ($cardLeft -eq -1) { $cardLeft = $x }
        $cardRight = $x
    }
}
Write-Output "Image width: $($b.Width), height: $($b.Height)"
Write-Output "Card starts at x=$cardLeft, ends at x=$cardRight. Visible card width: $($cardRight - $cardLeft + 1)"
$b.Dispose()
