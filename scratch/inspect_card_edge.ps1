Add-Type -AssemblyName System.Drawing
$b = [System.Drawing.Bitmap]::FromFile((Resolve-Path "scratch/login_mobile_v4.png"))

Write-Output "Checking pixels across y=400 from x=350 to x=389:"
for ($x = 350; $x -lt $b.Width; $x++) {
    $c = $b.GetPixel($x, 400)
    Write-Output "x=$($x) R=$($c.R) G=$($c.G) B=$($c.B)"
}
$b.Dispose()
