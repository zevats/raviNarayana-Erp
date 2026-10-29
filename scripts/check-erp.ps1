<#
.SYNOPSIS
    Health and connectivity diagnostic script for Ravi Narayana ERP local & LAN access.
#>

$ErrorActionPreference = "Continue"

Write-Host ""
Write-Host "================================================================================" -ForegroundColor DarkGreen
Write-Host "          RAVI NARAYANA ERP - HEALTH & CONNECTIVITY DIAGNOSTICS" -ForegroundColor Green
Write-Host "================================================================================" -ForegroundColor DarkGreen
Write-Host ""

# 1. Port 3001 check
$conn = Get-NetTCPConnection -LocalPort 3001 -State Listen -ErrorAction SilentlyContinue
if ($conn) {
    $proc = Get-Process -Id $conn[0].OwningProcess -ErrorAction SilentlyContinue
    Write-Host "[OK] Port 3001 is LISTENING (PID: $($conn[0].OwningProcess), Process: $($proc.ProcessName))" -ForegroundColor Green
} else {
    Write-Host "[INFO] Port 3001 is NOT currently listening (ERP server is stopped)." -ForegroundColor Yellow
}

# 2. Port 3000 check (Website)
$webConn = Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue
if ($webConn) {
    Write-Host "[OK] Port 3000 (Website) is LISTENING (PID: $($webConn[0].OwningProcess))" -ForegroundColor Cyan
} else {
    Write-Host "[INFO] Port 3000 (Website) is NOT currently listening." -ForegroundColor Gray
}

# 3. HTTP Health Endpoint probe
if ($conn) {
    try {
        $res = Invoke-RestMethod -Uri "http://localhost:3001/api/health" -Method Get -TimeoutSec 3 -ErrorAction Stop
        Write-Host "[OK] Health Check endpoint responded with HTTP 200:" -ForegroundColor Green
        Write-Host "     Status   : $($res.status)" -ForegroundColor White
        Write-Host "     Database : $($res.database) ($($res.engine))" -ForegroundColor White
        Write-Host "     Latency  : $($res.latencyMs)ms" -ForegroundColor White
    } catch {
        Write-Host "[WARN] Health check request failed: $($_.Exception.Message)" -ForegroundColor Red
    }
}

# 4. LAN IP Resolution
$lanIps = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object {
    $_.InterfaceAlias -notmatch 'Loopback|vEthernet|VMware|Virtual' -and $_.IPAddress -notmatch '^169\.254\.'
}

Write-Host ""
Write-Host "Discovered LAN Interfaces:" -ForegroundColor Cyan
foreach ($ip in $lanIps) {
    Write-Host "  - Interface: $($ip.InterfaceAlias) | IPv4: $($ip.IPAddress)" -ForegroundColor White
}

# 5. Windows Firewall Rule status
$fwRule = Get-NetFirewallRule -DisplayName "Node.js JavaScript Runtime" -ErrorAction SilentlyContinue
if ($fwRule) {
    Write-Host ""
    Write-Host "[OK] Windows Firewall Inbound rule exists for Node.js (Action: $($fwRule[0].Action), Enabled: $($fwRule[0].Enabled))" -ForegroundColor Green
} else {
    Write-Host ""
    Write-Host "[NOTICE] To explicitly allow port 3001 inbound on Private networks, run as Admin:" -ForegroundColor Yellow
    Write-Host "  New-NetFirewallRule -DisplayName 'Ravi Narayana ERP Dev (3001)' -Direction Inbound -LocalPort 3001 -Protocol TCP -Action Allow -Profile Private" -ForegroundColor Gray
}

Write-Host ""
Write-Host "================================================================================" -ForegroundColor DarkGreen
