<#
.SYNOPSIS
    Turnkey all-in-one deployment script for Antigravity Windows Toolkit.
.DESCRIPTION
    Installs and configures:
    1. Antigravity CLI dual-profile isolation (me / son) via NTFS Directory Junctions.
    2. Antigravity Claude Proxy (Smart Failover, Web UI Dashboard, OAuth Token lifecycle).
    3. Charm Crush CLI configuration and routing through local proxy.
    4. PowerShell $PROFILE aliases and helper functions.
    5. Automatic verification test run.
.PARAMETER Component
    Specify 'all', 'agy', 'proxy', 'crush', or 'test'. Defaults to 'all'.
#>

[CmdletBinding()]
param(
    [Parameter(Position = 0)]
    [ValidateSet("all", "agy", "proxy", "laya", "crush", "test")]
    [string]$Component = "all"
)

$ErrorActionPreference = "Stop"

$userHome = $env:USERPROFILE
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$binDir = "$userHome\bin"

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "     Antigravity Windows Toolkit - Turnkey Installer      " -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan

function Setup-AgyProfiles {
    Write-Host "`n[1/4] Configuring Antigravity Multi-Account Profiles..." -ForegroundColor Yellow
    $baseConfig = "$userHome\.antigravity"
    $profilesDir = "$userHome\.antigravity-profiles"
    $sonDir = "$profilesDir\son"
    $meDir = "$profilesDir\me"

    # Create directory structure
    New-Item -ItemType Directory -Force -Path $sonDir | Out-Null
    New-Item -ItemType Directory -Force -Path $meDir | Out-Null
    New-Item -ItemType Directory -Force -Path $binDir | Out-Null

    # Backup existing session if not a junction
    if (Test-Path $baseConfig) {
        $item = Get-Item $baseConfig
        if (-not ($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint)) {
            Write-Host "  Preserving existing session into $sonDir..." -ForegroundColor DarkGray
            Copy-Item -Path "$baseConfig\*" -Destination $sonDir -Recurse -Force
            Remove-Item -Path $baseConfig -Recurse -Force
        }
    }

    # Deploy scripts
    Copy-Item -Path "$scriptDir\scripts\agy-switch.ps1" -Destination "$binDir\agy-switch.ps1" -Force
    Copy-Item -Path "$scriptDir\scripts\agy-me.cmd" -Destination "$binDir\agy-me.cmd" -Force
    Copy-Item -Path "$scriptDir\scripts\agy-son.cmd" -Destination "$binDir\agy-son.cmd" -Force
    if (Test-Path "$scriptDir\scripts\codex.cmd") {
        Copy-Item -Path "$scriptDir\scripts\codex.cmd" -Destination "$binDir\codex.cmd" -Force
    }

    # Ensure PATH contains binDir
    $currentPath = [Environment]::GetEnvironmentVariable("Path", [EnvironmentVariableTarget]::User)
    if ($currentPath -notlike "*$binDir*") {
        Write-Host "  Adding $binDir to User PATH..." -ForegroundColor DarkGray
        [Environment]::SetEnvironmentVariable("Path", "$currentPath;$binDir", [EnvironmentVariableTarget]::User)
        $env:PATH += ";$binDir"
    }

    # Switch to 'me' by default
    & "$binDir\agy-switch.ps1" me
    Write-Host "[OK] Antigravity multi-account profile setup complete." -ForegroundColor Green
}

function Setup-ProxyComponent {
    Write-Host "`n[2/4] Configuring Antigravity Claude Proxy..." -ForegroundColor Yellow
    & "$scriptDir\scripts\setup-proxy.ps1"
}

function Setup-LayaComponent {
    Write-Host "`n[3/5] Configuring Laya Decision Engine..." -ForegroundColor Yellow
    & "$scriptDir\scripts\setup-laya.ps1"
}

function Setup-CrushComponent {
    Write-Host "`n[4/5] Configuring Charm Crush Integration..." -ForegroundColor Yellow
    & "$scriptDir\scripts\setup-crush.ps1"
}

function Setup-ShellProfile {
    Write-Host "`n[5/5] Integrating Aliases into PowerShell Profile..." -ForegroundColor Yellow
    $profilePath = $PROFILE
    if (-not (Test-Path $profilePath)) {
        $parentDir = Split-Path -Parent $profilePath
        if (-not (Test-Path $parentDir)) { New-Item -ItemType Directory -Force -Path $parentDir | Out-Null }
        New-Item -ItemType File -Force -Path $profilePath | Out-Null
    }

    $profileAdditions = @"

# === Antigravity Windows Toolkit Helpers ===
if (`$env:PATH -notlike "*$binDir*") {
    `$env:PATH += ";$binDir"
}

function Switch-Agy {
    param([string]`$Target = "status")
    & "$binDir\agy-switch.ps1" `$Target
}

function Show-AgyMenu {
    `$choices = @(
        [System.Management.Automation.Host.ChoiceDescription]::new("&1 Me (Primary Profile: tukroschu@gmail.com)", "Switch to primary profile"),
        [System.Management.Automation.Host.ChoiceDescription]::new("&2 Son (Secondary Profile: arsen.k111999@gmail.com)", "Switch to secondary profile"),
        [System.Management.Automation.Host.ChoiceDescription]::new("&3 Codex (OpenAI / ChatGPT Profile)", "Switch to codex profile"),
        [System.Management.Automation.Host.ChoiceDescription]::new("&4 Status", "Show active profile")
    )
    `$decision = `$Host.UI.PromptForChoice("Antigravity Account Selector", "Select target profile:", `$choices, 0)
    switch (`$decision) {
        0 { Switch-Agy me }
        1 { Switch-Agy son }
        2 { Switch-Agy codex }
        3 { Switch-Agy status }
    }
}

function Start-AgyProxy { & "$binDir\start-proxy.cmd" }
function Stop-AgyProxy { & "$binDir\stop-proxy.cmd" }
function Get-AgyProxyStatus {
    try {
        `$h = Invoke-RestMethod -Uri "http://localhost:8080/health" -Method Get -TimeoutSec 2
        `$a = Invoke-RestMethod -Uri "http://localhost:8080/api/accounts" -Method Get -TimeoutSec 2
        Write-Host "Proxy: RUNNING (v`$(`$h.version)) | Accounts: `$(`$a.summary.available)/`$(`$a.summary.total) available" -ForegroundColor Green
        Write-Host "Dashboard: http://localhost:8080/" -ForegroundColor Cyan
    } catch {
        Write-Host "Proxy: STOPPED or UNREACHABLE" -ForegroundColor Red
    }
}

function Start-LayaEngine { & "$binDir\start-laya.cmd" }
function Stop-LayaEngine { & "$binDir\stop-laya.cmd" }
function Get-LayaStatus {
    try {
        `$h = Invoke-RestMethod -Uri "http://localhost:9623/health" -Method Get -TimeoutSec 2
        Write-Host "Laya: RUNNING ($(`$h.model) `$(`$h.version)) on Node: `$(`$h.node)" -ForegroundColor Green
    } catch {
        Write-Host "Laya: STOPPED or UNREACHABLE" -ForegroundColor Red
    }
}

Set-Alias -Name agy-switch -Value Switch-Agy
Set-Alias -Name agy-sel -Value Show-AgyMenu
Set-Alias -Name proxy-start -Value Start-AgyProxy
Set-Alias -Name proxy-stop -Value Stop-AgyProxy
Set-Alias -Name proxy-status -Value Get-AgyProxyStatus
Set-Alias -Name laya-start -Value Start-LayaEngine
Set-Alias -Name laya-stop -Value Stop-LayaEngine
Set-Alias -Name laya-status -Value Get-LayaStatus
"@

    $existingProfile = Get-Content -Path $profilePath -Raw -ErrorAction SilentlyContinue
    if ($existingProfile -notlike "*Antigravity Windows Toolkit Helpers*") {
        Add-Content -Path $profilePath -Value $profileAdditions -Encoding UTF8
        Write-Host "[OK] Added helper aliases to PowerShell `$PROFILE." -ForegroundColor Green
    } else {
        Write-Host "[OK] PowerShell `$PROFILE already configured." -ForegroundColor Green
    }
}

# Execution Switch
switch ($Component) {
    "all" {
        Setup-AgyProfiles
        Setup-ProxyComponent
        Setup-LayaComponent
        Setup-CrushComponent
        Setup-ShellProfile
        & "$scriptDir\scripts\test-pipeline.ps1"
    }
    "agy" { Setup-AgyProfiles }
    "proxy" { Setup-ProxyComponent }
    "laya" { Setup-LayaComponent }
    "crush" { Setup-CrushComponent }
    "test" { & "$scriptDir\scripts\test-pipeline.ps1" }
}

Write-Host "`n[SUCCESS] Setup process finished for target: $Component`n" -ForegroundColor Green
