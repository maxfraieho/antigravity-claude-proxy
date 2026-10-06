<#
.SYNOPSIS
    Automated configuration of Charm Crush for Antigravity Claude Proxy.
.DESCRIPTION
    Deploys crush.json and crushrc into %USERPROFILE%\.config\crush with strict UTF-8 (no BOM)
    to prevent Go json.Unmarshal errors, and routes Crush through http://localhost:8080.
#>

[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"

$userHome = $env:USERPROFILE
$crushConfigDir = "$userHome\.config\crush"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Split-Path -Parent $scriptDir

Write-Host "`n=== Setting up Charm Crush with Antigravity Proxy ===" -ForegroundColor Cyan

# 1. Ensure directory exists
if (-not (Test-Path $crushConfigDir)) {
    New-Item -ItemType Directory -Force -Path $crushConfigDir | Out-Null
    Write-Host "[OK] Created directory $crushConfigDir" -ForegroundColor Green
}

# 2. Deploy crush.json without BOM
$crushJsonSrc = "$repoRoot\config\crush\crush.json"
$crushJsonDst = "$crushConfigDir\crush.json"
if (Test-Path $crushJsonSrc) {
    $content = [System.IO.File]::ReadAllText($crushJsonSrc)
    [System.IO.File]::WriteAllText($crushJsonDst, $content, (New-Object System.Text.UTF8Encoding($false)))
    Write-Host "[OK] Deployed crush.json (clean UTF-8 without BOM)" -ForegroundColor Green
} else {
    Write-Warning "Source crush.json not found at $crushJsonSrc"
}

# 3. Deploy crushrc without BOM
$crushrcSrc = "$repoRoot\config\crush\crushrc"
$crushrcDst = "$crushConfigDir\crushrc"
if (Test-Path $crushrcSrc) {
    $content = [System.IO.File]::ReadAllText($crushrcSrc)
    [System.IO.File]::WriteAllText($crushrcDst, $content, (New-Object System.Text.UTF8Encoding($false)))
    Write-Host "[OK] Deployed crushrc (clean UTF-8 without BOM)" -ForegroundColor Green
} else {
    Write-Warning "Source crushrc not found at $crushrcSrc"
}

# 4. Check if crush command is available
$crushCmd = Get-Command crush -ErrorAction SilentlyContinue
if ($crushCmd) {
    Write-Host "[OK] Found crush CLI at: $($crushCmd.Source)" -ForegroundColor Green
    try {
        $models = crush models 2>$null | Select-String 'antigravity'
        if ($models) {
            Write-Host "[OK] Verified antigravity provider in Crush models:" -ForegroundColor Green
            $models | ForEach-Object { Write-Host "     - $_" -ForegroundColor DarkGray }
        }
    } catch {
        Write-Warning "Could not list models: $_"
    }
} else {
    Write-Host "`n[NOTICE] Crush CLI is not installed yet." -ForegroundColor Yellow
    Write-Host "To install Crush on Windows:" -ForegroundColor Cyan
    Write-Host "  winget install Charmbracelet.Crush" -ForegroundColor White
    Write-Host "  # or via scoop:" -ForegroundColor DarkGray
    Write-Host "  scoop install crush`n" -ForegroundColor DarkGray
}

Write-Host "=== Charm Crush setup complete ===`n" -ForegroundColor Green
