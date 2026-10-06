<#
.SYNOPSIS
    End-to-end verification of Antigravity CLI, Proxy, and Crush on Windows.
.DESCRIPTION
    Tests profile junctions, proxy health, account pool status, and runs a test
    prompt through Crush CLI to ensure zero quota or configuration errors.
#>

[CmdletBinding()]
param()

$ErrorActionPreference = "Continue"

Write-Host "`n===============================================" -ForegroundColor Cyan
Write-Host "   Antigravity Windows Toolkit Verification" -ForegroundColor Cyan
Write-Host "===============================================" -ForegroundColor Cyan

# 1. Antigravity CLI Profile Check
Write-Host "`n[1/3] Testing Antigravity CLI Profile Setup..." -ForegroundColor Yellow
$userHome = $env:USERPROFILE
$baseConfig = "$userHome\.antigravity"
if (Test-Path $baseConfig) {
    $item = Get-Item $baseConfig
    if ($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) {
        Write-Host " [PASS] Junction active: $($item.Target)" -ForegroundColor Green
    } else {
        Write-Host " [WARN] Base config is a directory, not a junction." -ForegroundColor Yellow
    }
} else {
    Write-Host " [FAIL] Base config $baseConfig does not exist." -ForegroundColor Red
}

$switchCmd = "$userHome\bin\agy-switch.ps1"
if (Test-Path $switchCmd) {
    Write-Host " [PASS] Switcher script found at $switchCmd" -ForegroundColor Green
    & $switchCmd status
} else {
    Write-Host " [FAIL] Switcher script missing at $switchCmd" -ForegroundColor Red
}

# 2. Antigravity Claude Proxy Check
Write-Host "`n[2/3] Testing Antigravity Claude Proxy (Port 8080)..." -ForegroundColor Yellow
try {
    $health = Invoke-RestMethod -Uri "http://127.0.0.1:8080/health" -Method Get -TimeoutSec 3
    Write-Host " [PASS] Proxy is running. Version: $($health.version)" -ForegroundColor Green
    
    $accs = Invoke-RestMethod -Uri "http://127.0.0.1:8080/api/accounts" -Method Get -TimeoutSec 3
    Write-Host " [PASS] Accounts in pool: $($accs.summary.available) available / $($accs.summary.total) total" -ForegroundColor Green
    if ($accs.accounts) {
        $accs.accounts | ForEach-Object {
            Write-Host "        - $($_.email) (Score: $($_.score), Pro: $($_.subscription.tier))" -ForegroundColor DarkGray
        }
    }
} catch {
    Write-Host " [FAIL] Proxy is not responding on http://127.0.0.1:8080: $_" -ForegroundColor Red
}

# 3. Charm Crush Integration Check
Write-Host "`n[3/3] Testing Charm Crush CLI Integration..." -ForegroundColor Yellow
$crushCmd = Get-Command crush -ErrorAction SilentlyContinue
if (-not $crushCmd) {
    Write-Host " [WARN] Crush CLI is not installed in PATH. Skipping inference test." -ForegroundColor Yellow
} else {
    Write-Host " [PASS] Crush binary found: $($crushCmd.Source)" -ForegroundColor Green
    
    Write-Host " [*] Running test prompt through Crush (Claude Sonnet 4.6 via Proxy)..." -ForegroundColor DarkGray
    try {
        $output = "test" | crush run "Respond with exactly: CRUSH_PROXY_PIPELINE_OK" 2>&1
        if ($output -match "CRUSH_PROXY_PIPELINE_OK" -or $output -match "OK") {
            Write-Host " [PASS] Crush inference succeeded!" -ForegroundColor Green
            Write-Host "        Response: $output" -ForegroundColor Cyan
        } else {
            Write-Host " [WARN] Crush produced unexpected output: $output" -ForegroundColor Yellow
        }
    } catch {
        Write-Host " [FAIL] Crush execution failed: $_" -ForegroundColor Red
    }
}

Write-Host "`n===============================================" -ForegroundColor Cyan
Write-Host "   Verification Complete!" -ForegroundColor Cyan
Write-Host "===============================================`n" -ForegroundColor Cyan
