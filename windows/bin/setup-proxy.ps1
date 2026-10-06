<#
.SYNOPSIS
    Automated deployment and configuration of Antigravity Claude Proxy on Windows.
.DESCRIPTION
    Clones or updates antigravity-claude-proxy, runs npm install, deploys runner scripts
    to %USERPROFILE%\bin, registers background auto-start, and validates health.
#>

[CmdletBinding()]
param(
    [switch]$SkipNpmInstall,
    [switch]$RegisterStartupTask
)

$ErrorActionPreference = "Stop"

$userHome = $env:USERPROFILE
$binDir = "$userHome\bin"
$proxyRepoDir = "$userHome\Documents\GitHub\antigravity-claude-proxy"
$proxyConfigDir = "$userHome\.config\antigravity-proxy"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Split-Path -Parent $scriptDir

Write-Host "`n=== Setting up Antigravity Claude Proxy ===" -ForegroundColor Cyan

# 1. Prerequisite verification
$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
$gitCmd = Get-Command git -ErrorAction SilentlyContinue

if (-not $nodeCmd) {
    Write-Error "Node.js is not found in PATH. Please install Node.js (v18+) first."
    return
}
if (-not $gitCmd) {
    Write-Error "Git is not found in PATH. Please install Git for Windows first."
    return
}

# 2. Clone or update repository
if (-not (Test-Path $proxyRepoDir)) {
    Write-Host "[*] Cloning antigravity-claude-proxy repository..." -ForegroundColor Yellow
    $parentDir = Split-Path -Parent $proxyRepoDir
    if (-not (Test-Path $parentDir)) { New-Item -ItemType Directory -Force -Path $parentDir | Out-Null }
    git clone https://github.com/maxfraieho/antigravity-claude-proxy.git $proxyRepoDir
    Write-Host "[OK] Cloned proxy into $proxyRepoDir" -ForegroundColor Green
} else {
    Write-Host "[*] Updating existing proxy repository..." -ForegroundColor Yellow
    Push-Location $proxyRepoDir
    try {
        git fetch origin
        git pull origin main
        Write-Host "[OK] Updated proxy to latest origin/main" -ForegroundColor Green
    } catch {
        Write-Warning "Could not git pull automatically: $_"
    } finally {
        Pop-Location
    }
}

# 3. Install NPM dependencies
if (-not $SkipNpmInstall) {
    Write-Host "[*] Installing Node dependencies..." -ForegroundColor Yellow
    Push-Location $proxyRepoDir
    try {
        npm install --no-audit --no-fund
        Write-Host "[OK] Dependencies installed successfully" -ForegroundColor Green
    } finally {
        Pop-Location
    }
}

# 4. Ensure config directory and accounts.json exist
if (-not (Test-Path $proxyConfigDir)) {
    New-Item -ItemType Directory -Force -Path $proxyConfigDir | Out-Null
}

$accountsPath = "$proxyConfigDir\accounts.json"
if (-not (Test-Path $accountsPath)) {
    $tmplPath = "$repoRoot\config\proxy\accounts.template.json"
    if (Test-Path $tmplPath) {
        $content = [System.IO.File]::ReadAllText($tmplPath)
        [System.IO.File]::WriteAllText($accountsPath, $content, (New-Object System.Text.UTF8Encoding($false)))
        Write-Host "[OK] Initialized $accountsPath from template (clean UTF-8 without BOM)" -ForegroundColor Green
    }
} else {
    # Ensure existing accounts.json is stripped of BOM
    $raw = [System.IO.File]::ReadAllText($accountsPath)
    if ($raw.Length -gt 0) {
        [System.IO.File]::WriteAllText($accountsPath, $raw, (New-Object System.Text.UTF8Encoding($false)))
        Write-Host "[OK] Verified $accountsPath is clean UTF-8 without BOM" -ForegroundColor Green
    }
}

# 5. Deploy runner scripts into %USERPROFILE%\bin
if (-not (Test-Path $binDir)) {
    New-Item -ItemType Directory -Force -Path $binDir | Out-Null
}

$runners = @("start-proxy.cmd", "start-proxy.vbs", "stop-proxy.cmd")
foreach ($runner in $runners) {
    $src = "$scriptDir\$runner"
    if (Test-Path $src) {
        Copy-Item -Path $src -Destination "$binDir\$runner" -Force
        Write-Host "[OK] Deployed $runner to $binDir" -ForegroundColor Green
    }
}

# 6. Optional Scheduled Task for background auto-start
if ($RegisterStartupTask) {
    $taskName = "AntigravityClaudeProxy"
    $vbsPath = "$binDir\start-proxy.vbs"
    $action = New-ScheduledTaskAction -Execute "wscript.exe" -Argument "`"$vbsPath`""
    $trigger = New-ScheduledTaskTrigger -AtLogOn
    $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit 0
    Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Force | Out-Null
    Write-Host "[OK] Registered auto-start scheduled task '$taskName'" -ForegroundColor Green
}

# 7. Start or restart proxy
Write-Host "[*] Launching proxy in background..." -ForegroundColor Yellow
& "$binDir\start-proxy.cmd"

# 8. Check health
Start-Sleep -Seconds 2
try {
    $health = Invoke-RestMethod -Uri "http://127.0.0.1:8080/health" -Method Get -TimeoutSec 5
    Write-Host "[OK] Antigravity Claude Proxy is HEALTHY on http://127.0.0.1:8080" -ForegroundColor Green
    Write-Host "     Status: $($health.status), Version: $($health.version)" -ForegroundColor DarkGray
    Write-Host "     Web UI Dashboard: http://127.0.0.1:8080/" -ForegroundColor Cyan
} catch {
    Write-Warning "Could not reach proxy on http://127.0.0.1:8080/health. Check logs via: Get-Content '$proxyRepoDir\proxy.log'"
}

Write-Host "=== Antigravity Claude Proxy setup complete ===`n" -ForegroundColor Green
