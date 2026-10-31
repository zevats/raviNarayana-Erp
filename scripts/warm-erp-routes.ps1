<#
.SYNOPSIS
    Pre-compiles ERP pages and API routes in `next dev` so the first click on each section is not a compile wait.
.DESCRIPTION
    `next dev` compiles each route on its first request, which made the first visit to a section
    take 3-4 seconds (page compile plus one compile per API route it calls). This script waits for
    the dev server, then requests every page and the API routes those pages load, once each.

    The middleware redirects requests without a session cookie to /login before the route is
    compiled, so a plain unauthenticated request warms nothing. The script therefore sends a random
    throwaway cookie value: it passes the middleware's shape check, matches no session (the server
    only runs the read-only session lookup, finds nothing, and answers with a /login redirect or 401),
    and the route gets compiled. No credentials are sent and no data is read or written beyond that
    failed lookup. Only GET requests are made (POST-only sign-in routes answer 405 without running).
    Production builds do not need this script.

    Only one warm-up runs at a time per base URL (named mutex); a second launch exits immediately.
.EXAMPLE
    .\scripts\warm-erp-routes.ps1 -BaseUrl http://127.0.0.1:3001
#>
[CmdletBinding()]
param(
    [string]$BaseUrl = "http://127.0.0.1:3001",
    [int]$TimeoutSeconds = 180
)

$ErrorActionPreference = "SilentlyContinue"

$mutexName = "Global\rn-erp-warmup-" + ($BaseUrl -replace '[^A-Za-z0-9]', '_')
$mutex = New-Object System.Threading.Mutex($false, $mutexName)
if (-not $mutex.WaitOne(0)) {
    Write-Host "[warm-up] already running for $BaseUrl; exiting."
    exit 0
}

try {
    $pages = @("/login", "/dashboard", "/rooms", "/residents", "/finance", "/orders", "/delivery", "/staff", "/offline", "/forgot-password")
    # GET endpoints the pages above call on first load (route handlers compile separately from pages).
    # The sign-in routes are POST-only: a GET compiles them and returns 405 without running a handler.
    $apis = @(
        "/api/auth/login", "/api/auth/otp/verify", "/api/auth/otp/resend", "/api/auth/me", "/api/auth/logout",
        "/api/notifications", "/api/rooms", "/api/residents",
        "/api/finance/transactions", "/api/finance/cashbook", "/api/finance/closing", "/api/finance/invoices",
        "/api/orders", "/api/delivery/tasks", "/api/delivery/handover", "/api/delivery/staff",
        "/api/staff", "/api/tiffin/products", "/api/tiffin/customers", "/api/reports/executive"
    )

    # Then every other API route (modals and save actions), discovered from the source tree, so the
    # first payment, check-out or document upload of the day is not a compile wait either.
    # Dynamic segments get a placeholder id: the throwaway cookie fails authentication first.
    $apiRoot = Join-Path $PSScriptRoot "..\apps\erp\src\app\api"
    $discovered = @()
    if (Test-Path $apiRoot) {
        $rootFull = (Resolve-Path $apiRoot).Path
        $discovered = Get-ChildItem -Path $rootFull -Recurse -Filter "route.ts" | ForEach-Object {
            $rel = $_.DirectoryName.Substring($rootFull.Length) -replace '\\', '/'
            "/api" + ($rel -replace '\[[^\]]+\]', '_warm')
        } | Where-Object { $_ -notlike "/api/dev/*" } | Sort-Object
    }
    $apis = @($apis + ($discovered | Where-Object { $apis -notcontains $_ }))

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    $up = $false
    while ((Get-Date) -lt $deadline) {
        try {
            $r = Invoke-WebRequest -Uri "$BaseUrl/api/health" -UseBasicParsing -TimeoutSec 5
            if ($r.StatusCode -eq 200) { $up = $true; break }
        } catch {}
        Start-Sleep -Seconds 2
    }
    if (-not $up) {
        Write-Host "[warm-up] server at $BaseUrl did not become healthy; nothing warmed."
        exit 0
    }

    # Throwaway value, never a real session: 48 random hex characters.
    $bytes = New-Object byte[] 24
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    $token = -join ($bytes | ForEach-Object { $_.ToString("x2") })
    $session = New-Object Microsoft.PowerShell.Commands.WebRequestSession
    $session.Cookies.Add((New-Object System.Net.Cookie("rn_erp_session", $token, "/", ([Uri]$BaseUrl).Host)))

    foreach ($route in ($pages + $apis)) {
        $sw = [System.Diagnostics.Stopwatch]::StartNew()
        try {
            # MaximumRedirection 0: compiling the route is the goal; the /login redirect is not followed.
            Invoke-WebRequest -Uri "$BaseUrl$route" -WebSession $session -UseBasicParsing -MaximumRedirection 0 -TimeoutSec 120 | Out-Null
        } catch {}
        Write-Host ("[warm-up] {0,-28} {1,6} ms" -f $route, $sw.ElapsedMilliseconds)
    }
} finally {
    $mutex.ReleaseMutex()
    $mutex.Dispose()
}
