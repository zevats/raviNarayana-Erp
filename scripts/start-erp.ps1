<#
.SYNOPSIS
    Starts the Ravi Narayana Management ERP development server with LAN access enabled.
.DESCRIPTION
    Checks for port availability on 3001 without killing unrelated processes,
    discovers the local Wi-Fi / Ethernet IPv4 address, displays accessible PC and
    Android phone URLs, and launches the Next.js server bound to 0.0.0.0.
#>

[CmdletBinding()]
param(
    [switch]$LocalOnly,
    [switch]$Migrate
)

$ErrorActionPreference = "Stop"

Write-Host ""
Write-Host "================================================================================" -ForegroundColor DarkGreen
Write-Host "        RAVI NARAYANA PG & TIFFIN ERP - LOCAL DEVELOPMENT LAUNCHER" -ForegroundColor Green
Write-Host "================================================================================" -ForegroundColor DarkGreen
Write-Host ""

# 1. Port conflict inspection for ERP (Port 3001)
$erpPortInUse = Get-NetTCPConnection -LocalPort 3001 -State Listen -ErrorAction SilentlyContinue
if ($erpPortInUse) {
    $procId = $erpPortInUse[0].OwningProcess
    $procName = (Get-Process -Id $procId -ErrorAction SilentlyContinue).ProcessName
    Write-Host "[PORT CONFLICT DETECTED]" -ForegroundColor Red
    Write-Host "Port 3001 is already in use by process PID $procId ($procName)." -ForegroundColor Yellow
    Write-Host "To avoid disrupting existing work, the launcher will not silently terminate it." -ForegroundColor Yellow
    Write-Host "Please close that process or run: Stop-Process -Id $procId" -ForegroundColor Yellow
    Write-Host ""
    exit 1
}

# 2. Check Website port (Port 3000) status
$webPortInUse = Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue
if ($webPortInUse) {
    $procId = $webPortInUse[0].OwningProcess
    $procName = (Get-Process -Id $procId -ErrorAction SilentlyContinue).ProcessName
    Write-Host "[NOTICE] Public Website is active on port 3000 (PID ${procId}: $procName)." -ForegroundColor Cyan
}

# 3. LAN IP Discovery
$lanIps = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object {
    $_.InterfaceAlias -notmatch 'Loopback|vEthernet|VMware|Virtual' -and $_.IPAddress -notmatch '^169\.254\.'
}

$primaryLanIp = "127.0.0.1"
if ($lanIps) {
    # Prefer Wi-Fi or Ethernet
    $wifiOrEth = $lanIps | Where-Object { $_.InterfaceAlias -match 'Wi-Fi|Ethernet' }
    if ($wifiOrEth) {
        $primaryLanIp = $wifiOrEth[0].IPAddress
    } else {
        $primaryLanIp = $lanIps[0].IPAddress
    }
}

Write-Host "Access Endpoints:" -ForegroundColor Cyan
Write-Host "  -> Local PC Browser : http://localhost:3001" -ForegroundColor White
if (-not $LocalOnly) {
    Write-Host "  -> Android Phone    : http://${primaryLanIp}:3001" -ForegroundColor Green
    Write-Host "  -> LAN IP Interface : ${primaryLanIp} (Interface: $($lanIps[0].InterfaceAlias))" -ForegroundColor Gray
}
Write-Host "  -> API Health Check : http://localhost:3001/api/health" -ForegroundColor White
Write-Host ""

Write-Host "Android Testing Notes:" -ForegroundColor Cyan
Write-Host "  1. PC and Android phone must be on the same Wi-Fi network." -ForegroundColor Gray
Write-Host "  2. For full PWA installation & Service Worker caching over LAN HTTP:" -ForegroundColor Gray
Write-Host "     - Option A: In Chrome on Android, open chrome://flags" -ForegroundColor Gray
Write-Host "       Enable '#unsafely-treat-insecure-origin-as-secure' with http://${primaryLanIp}:3001" -ForegroundColor Gray
Write-Host "     - Option B: Connect via USB, open chrome://inspect on PC, forward port 3001" -ForegroundColor Gray
Write-Host "       and navigate to http://localhost:3001 on the phone (treated as secure context natively)." -ForegroundColor Gray
Write-Host ""
if ($Migrate) {
    Write-Host "Checking and applying database migrations (-Migrate requested)..." -ForegroundColor Cyan
    npm run db:migrate
    if ($LASTEXITCODE -ne 0) {
        Write-Host "[FATAL] Explicit database migration failed with exit code $LASTEXITCODE. Aborting server start." -ForegroundColor Red
        exit 1
    }
} else {
    Write-Host "[NOTICE] Auto-migration is disabled by default for startup safety." -ForegroundColor Gray
    Write-Host "         Run 'npm run db:migrate' explicitly to apply migrations, or pass -Migrate." -ForegroundColor Gray
}

Write-Host ""
Write-Host "Press Ctrl+C to safely shut down the development server." -ForegroundColor Yellow
Write-Host "--------------------------------------------------------------------------------" -ForegroundColor DarkGray
Write-Host ""

# Compile every page in the background once the server is up, so first navigation is not a compile wait.
Start-Process -FilePath "powershell.exe" -WindowStyle Hidden -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", (Join-Path $PSScriptRoot "warm-erp-routes.ps1"), "-BaseUrl", "http://127.0.0.1:3001")

if ($LocalOnly) {
    npm run dev:erp:local
} else {
    npm run dev:erp
}

