Add-Type -AssemblyName System.Drawing
$b = [System.Drawing.Bitmap]::FromFile((Resolve-Path "scratch/login_mobile_v7.png"))
for ($x = 0; $x -lt 60; $x += 2) {
    $c = $b.GetPixel($x, 400)
    Write-Output "x=$($x): R=$($c.R) G=$($c.G) B=$($c.B)"
}
$b.Dispose()
