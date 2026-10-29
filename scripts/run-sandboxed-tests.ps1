<#
.SYNOPSIS
    Runs the ERP test suites inside an isolated, disposable copy of the repository.
.DESCRIPTION
    Several legacy suites stat data/erp.db, write SQLite fixtures under tests/, or emit into
    tests/dist. Running them in the working tree is therefore unsafe. This script:

      1. Mirrors the repository into a sandbox directory, EXCLUDING .git, data/, scratch/,
         storage/, every real .env file (only committed placeholder templates are copied),
         every *.db / *.db-* / *.backup* file, and build output.
      2. Junctions node_modules back to the real install (tests never write there).
      3. Refuses to continue if any protected file is present in the sandbox.
      4. Clears DATABASE_URL / DIRECT_URL / SMTP credentials from the child environment so no
         suite can reach a configured database or mail server.
      5. Compiles tests and runs each suite, writing a summary.

    Suites that need live resources are skipped unless explicitly enabled:
      - pg_* suites (live PostgreSQL): run only when -PgVerifyUrl points at a disposable local
        database whose name contains "verify" (validated again inside each suite).
      - live_postgresql_integration, task01b_74, task01b_75: never run here (they target the
        shared local dev database or a real SMTP server).
.EXAMPLE
    .\scripts\run-sandboxed-tests.ps1
    .\scripts\run-sandboxed-tests.ps1 -Suites finance,task01b_61_closing_remediation
    .\scripts\run-sandboxed-tests.ps1 -PgVerifyUrl postgresql://rn_verify:rn_verify_local@127.0.0.1:55432/rn_erp_verify_test
#>
[CmdletBinding()]
param(
    [string[]]$Suites,
    [string]$SandboxDir = (Join-Path $env:TEMP "rn-erp-test-sandbox"),
    [string]$PgVerifyUrl
)

$ErrorActionPreference = "Stop"
$repo = Resolve-Path (Join-Path $PSScriptRoot "..")

$neverRun = @("live_postgresql_integration", "task01b_74_local_admin_and_manifest", "task01b_75_complete_auth_flow")

New-Item -ItemType Directory -Force $SandboxDir | Out-Null
$SandboxDir = (Resolve-Path $SandboxDir).Path
if ($SandboxDir.StartsWith($repo.Path, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "SandboxDir must be outside the repository."
}
Write-Host "[sandbox] Copying $repo -> $SandboxDir" -ForegroundColor Cyan
$excludeDirs = @("$repo\.git", "$repo\data", "$repo\scratch", "$repo\storage", "$repo\tests\dist", "$repo\tests\temp_storage", "node_modules", ".next", ".next-dev")
$excludeFiles = @(".env", ".env.local", ".env.*.local", ".env.development*", ".env.production*", ".env.test*", "*.db", "*.db-*", "*.backup*", "*.tsbuildinfo")
# /E (never /MIR): the sandbox holds junctions into the real node_modules, which must never be purged.
robocopy $repo $SandboxDir /E /NFL /NDL /NJH /NJS /NP /XD $excludeDirs /XF $excludeFiles /XJD | Out-Null
if ($LASTEXITCODE -ge 8) { throw "robocopy failed with exit code $LASTEXITCODE" }

foreach ($rel in "node_modules", "apps\erp\node_modules", "apps\website\node_modules") {
    $target = Join-Path $repo $rel
    $link = Join-Path $SandboxDir $rel
    if ((Test-Path $target) -and -not (Test-Path $link)) {
        cmd /c mklink /J "$link" "$target" | Out-Null
    }
}

# Fail closed if anything protected leaked into the sandbox.
# data/ is never copied; some suites create an empty data/ or data/fixtures/ themselves.
$sandboxData = Join-Path $SandboxDir "data"
if ((Test-Path $sandboxData) -and (Get-ChildItem -Force -Recurse $sandboxData -File -Include "erp.db*", "*.backup*" -ErrorAction SilentlyContinue)) {
    throw "Database or backup file present under sandbox data/. Aborting."
}
$leaked = Get-ChildItem -Force -Recurse $SandboxDir -Include ".env*" -ErrorAction SilentlyContinue |
    Where-Object { $_.FullName -notmatch "\\node_modules\\" -and $_.Name -notin @(".env.example", ".env.local.template") }
if ($leaked) { throw "Real environment file present in sandbox ($($leaked[0].Name)). Aborting." }

# Child processes must not inherit database or mail credentials.
foreach ($name in "DATABASE_URL", "DIRECT_URL", "EXPECTED_NEON_HOST", "EXPECTED_NEON_DATABASE", "SMTP_HOST", "SMTP_USER", "SMTP_PASS", "SMTP_APP_PASSWORD", "ALLOW_TEST_MIGRATION", "ALLOW_PRODUCTION_TEST") {
    Remove-Item "Env:$name" -ErrorAction SilentlyContinue
}
Remove-Item "Env:RN_PG_VERIFY_URL" -ErrorAction SilentlyContinue

Push-Location $SandboxDir
try {
    Write-Host "[sandbox] Compiling tests" -ForegroundColor Cyan
    npx tsc -p tests/tsconfig.json
    if ($LASTEXITCODE -ne 0) { throw "Test compilation failed" }

    $all = Get-ChildItem tests\*.test.ts | ForEach-Object { $_.BaseName -replace "\.test$", "" }
    # "powershell -File" passes "-Suites a,b" as one string; normalise to a list.
    $wanted = @($Suites | ForEach-Object { $_ -split "," } | ForEach-Object { $_.Trim() } | Where-Object { $_ })
    $selected = if ($wanted.Count) { $all | Where-Object { $wanted -contains $_ } } else { $all }
    if ($wanted.Count -and -not $selected) { throw "No suites matched: $($wanted -join ', ')" }

    $logDir = Join-Path $SandboxDir "test-logs"
    New-Item -ItemType Directory -Force $logDir | Out-Null
    $results = @()
    foreach ($suite in $selected) {
        if ($neverRun -contains $suite) { $results += [pscustomobject]@{ Suite = $suite; Result = "SKIPPED (live resource)" }; continue }
        if ($suite -like "pg_*") {
            if (-not $PgVerifyUrl) { $results += [pscustomobject]@{ Suite = $suite; Result = "SKIPPED (no -PgVerifyUrl)" }; continue }
            $env:RN_PG_VERIFY_URL = $PgVerifyUrl
        }
        $log = Join-Path $logDir "$suite.log"
        # cmd redirection keeps native stderr out of PowerShell's error stream (PS 5.1 + Stop).
        cmd /c "node -r ./tests/register_paths.js tests/dist/tests/$suite.test.js > `"$log`" 2>&1"
        $code = $LASTEXITCODE
        Remove-Item "Env:RN_PG_VERIFY_URL" -ErrorAction SilentlyContinue
        $fails = (Select-String -Path $log -Pattern "FAIL:|\[FAIL\]" -AllMatches).Count
        $status = if ($code -eq 0) { "PASS" } elseif ($code -eq 2) { "BLOCKED" } else { "FAIL ($fails failing assertions)" }
        $results += [pscustomobject]@{ Suite = $suite; Result = $status }
    }
    $results | Format-Table -AutoSize | Out-String | Write-Host
    Write-Host "[sandbox] Logs: $logDir"
    if ($results | Where-Object { $_.Result -like "FAIL*" }) { exit 1 }
}
finally {
    Pop-Location
}
