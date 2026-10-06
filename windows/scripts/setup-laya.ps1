<#
.SYNOPSIS
    Automated deployment and autostart configuration for Laya Decision Engine on Windows.
.DESCRIPTION
    Installs Laya Decision Engine daemon into %USERPROFILE%\bin\laya, registers Windows Scheduled
    Task for automatic background startup at logon, and verifies health on port 9623.
#>

[CmdletBinding()]
param(
    [switch]$RegisterStartupTask = $true
)

$ErrorActionPreference = "Stop"

$userHome = $env:USERPROFILE
$binDir = "$userHome\bin"
$layaDir = "$binDir\laya"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Split-Path -Parent $scriptDir

Write-Host "`n=== Setting up Laya Decision Engine on Windows ===" -ForegroundColor Cyan

# 1. Prerequisite verification
$pythonCmd = Get-Command python -ErrorAction SilentlyContinue
if (-not $pythonCmd) {
    Write-Error "Python 3 is not found in PATH. Please install Python 3.10+ first."
    return
}
Write-Host "[OK] Found Python: $($pythonCmd.Source)" -ForegroundColor Green

# 2. Create directory structure
if (-not (Test-Path $layaDir)) {
    New-Item -ItemType Directory -Force -Path $layaDir | Out-Null
    Write-Host "[OK] Created directory $layaDir" -ForegroundColor Green
}

# 3. Source directory resolution
$srcDir = "$repoRoot\bin\laya"
if (-not (Test-Path $srcDir)) {
    $srcDir = "$scriptDir\laya"
}
if (-not (Test-Path $srcDir)) {
    $srcDir = $scriptDir
}

# 4. Copy files to %USERPROFILE%\bin\laya
$filesToDeploy = @("laya_daemon.py", "start-laya.cmd", "start-laya.vbs", "stop-laya.cmd")
foreach ($f in $filesToDeploy) {
    $src = "$srcDir\$f"
    $dst = "$layaDir\$f"
    if (Test-Path $src) {
        if ([System.IO.Path]::GetFullPath($src) -ne [System.IO.Path]::GetFullPath($dst)) {
            Copy-Item -Path $src -Destination $dst -Force
            Write-Host "[OK] Deployed $f to $layaDir" -ForegroundColor Green
        } else {
            Write-Host "[OK] $f is already present in $layaDir" -ForegroundColor DarkGray
        }
    } else {
        Write-Warning "Source file $src not found!"
    }
}

# 5. Copy helper commands directly to %USERPROFILE%\bin for convenient CLI access
if (Test-Path "$layaDir\start-laya.cmd") {
    Copy-Item -Path "$layaDir\start-laya.cmd" -Destination "$binDir\start-laya.cmd" -Force
}
if (Test-Path "$layaDir\stop-laya.cmd") {
    Copy-Item -Path "$layaDir\stop-laya.cmd" -Destination "$binDir\stop-laya.cmd" -Force
}

# 6. Register Windows Scheduled Task for background autostart at logon
if ($RegisterStartupTask) {
    $taskName = "LayaDecisionEngine"
    
    # Locate pythonw.exe for windowless execution
    $pythonwPath = "$env:LOCALAPPDATA\Programs\Python\Python312\pythonw.exe"
    if (-not (Test-Path $pythonwPath)) {
        $pythonwCmd = Get-Command pythonw -ErrorAction SilentlyContinue
        if ($pythonwCmd) { $pythonwPath = $pythonwCmd.Source }
        else { $pythonwPath = "pythonw.exe" }
    }
    
    $action = New-ScheduledTaskAction -Execute $pythonwPath -Argument "`"$layaDir\laya_daemon.py`" --host 0.0.0.0 --port 9623" -WorkingDirectory $layaDir
    $trigger = New-ScheduledTaskTrigger -AtLogOn
    $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit 0
    
    # Unregister existing task if present
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue | Out-Null
    Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Force | Out-Null
    Write-Host "[OK] Registered auto-start scheduled task '$taskName'" -ForegroundColor Green
}

# 7. Launch Laya daemon
Write-Host "[*] Launching Laya Decision Engine..." -ForegroundColor Yellow
& "$layaDir\start-laya.cmd"

# 8. Check health
Start-Sleep -Seconds 2
try {
    $health = Invoke-RestMethod -Uri "http://127.0.0.1:9623/health" -Method Get -TimeoutSec 5
    Write-Host "[OK] Laya Decision Engine is HEALTHY on http://127.0.0.1:9623" -ForegroundColor Green
    Write-Host "     Model: $($health.model) ($($health.version))" -ForegroundColor DarkGray
    Write-Host "     Node:  $($health.node) ($($health.arch))" -ForegroundColor DarkGray
    Write-Host "     Sub-40ms: $($health.sub_40ms_capable)" -ForegroundColor DarkGray
} catch {
    Write-Warning "Could not reach Laya on http://127.0.0.1:9623/health. Check logs via: Get-Content '$layaDir\laya.log'"
}

Write-Host "=== Laya Decision Engine setup complete ===`n" -ForegroundColor Green
