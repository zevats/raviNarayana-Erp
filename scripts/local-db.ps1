<#
.SYNOPSIS
    Manages the isolated local PostgreSQL container for Ravi Narayana ERP.
.DESCRIPTION
    Starts, stops, checks health, or runs migrations against the isolated
    local PostgreSQL container (ravinarayana-postgres-local).
#>

[CmdletBinding()]
param(
    [ValidateSet("start", "stop", "status", "health", "migrate", "logs")]
    [string]$Action = "status"
)

$ErrorActionPreference = "Stop"

$ContainerName = "ravinarayana-postgres-local"
$VolumeName = "ravinarayana_pgdata_local"
$LocalUser = "erp_local_user"
$LocalPass = "erp_local_password"
$LocalDb = "ravinarayana_erp_local"
$LocalPort = "5432"
$LocalUrl = "postgresql://${LocalUser}:${LocalPass}@127.0.0.1:${LocalPort}/${LocalDb}"

function Invoke-DockerCmd {
    param([string]$Cmd)
    # Check if Windows native docker daemon is responsive
    $nativeOk = $false
    try {
        $null = docker ps -q 2>$null
        if ($LASTEXITCODE -eq 0) { $nativeOk = $true }
    } catch {}

    if ($nativeOk) {
        Invoke-Expression "docker $Cmd"
    } else {
        wsl -d Ubuntu-22.04 -- bash -c "docker $Cmd"
    }
}

switch ($Action) {
    "start" {
        Write-Host "Starting isolated local PostgreSQL container ($ContainerName)..." -ForegroundColor Cyan
        
        # Check if already running
        $running = Invoke-DockerCmd "ps -q -f name=$ContainerName"
        if ($running) {
            Write-Host "Container $ContainerName is already running." -ForegroundColor Green
        } else {
            # Check if container exists stopped
            $exists = Invoke-DockerCmd "ps -a -q -f name=$ContainerName"
            if ($exists) {
                Invoke-DockerCmd "start $ContainerName"
            } else {
                Invoke-DockerCmd "run -d --restart unless-stopped --name $ContainerName -p 5432:5432 -e POSTGRES_USER=$LocalUser -e POSTGRES_PASSWORD=$LocalPass -e POSTGRES_DB=$LocalDb -v ${VolumeName}:/var/lib/postgresql/data postgres:16-alpine"
            }
        }

        # Wait for health check
        Write-Host "Waiting for PostgreSQL readiness..." -ForegroundColor Cyan
        $ready = $false
        for ($i = 0; $i -lt 15; $i++) {
            Start-Sleep -Seconds 1
            $res = Invoke-DockerCmd "exec $ContainerName pg_isready -U $LocalUser -d $LocalDb" 2>$null
            if ($LASTEXITCODE -eq 0) {
                $ready = $true
                break
            }
        }

        if ($ready) {
            Write-Host "Isolated PostgreSQL is READY at 127.0.0.1:$LocalPort." -ForegroundColor Green
            Write-Host "Target Database: $LocalDb (User: $LocalUser)" -ForegroundColor White
        } else {
            Write-Host "PostgreSQL container started but not yet ready. Check '.\scripts\local-db.ps1 logs'." -ForegroundColor Yellow
        }
    }

    "stop" {
        Write-Host "Stopping container $ContainerName..." -ForegroundColor Cyan
        Invoke-DockerCmd "stop $ContainerName"
        Write-Host "Container stopped." -ForegroundColor Green
    }

    "status" {
        Write-Host "Isolated Local PostgreSQL Status:" -ForegroundColor Cyan
        Invoke-DockerCmd "ps -f name=$ContainerName"
    }

    "health" {
        Write-Host "Checking readiness for $ContainerName..." -ForegroundColor Cyan
        Invoke-DockerCmd "exec $ContainerName pg_isready -U $LocalUser -d $LocalDb"
    }

    "logs" {
        Invoke-DockerCmd "logs --tail 50 $ContainerName"
    }

    "migrate" {
        Write-Host "Running hardened migration runner against local database..." -ForegroundColor Cyan
        $env:DATABASE_URL = $LocalUrl
        $env:DIRECT_URL = $LocalUrl
        npm run db:migrate
    }
}
