param(
    [Parameter(Position=0)]
    [ValidateSet("me", "son", "codex", "status", "list")]
    [string]$Target = "status"
)

$userHome = $env:USERPROFILE
$baseConfig = "$userHome\.antigravity"
$profilesDir = "$userHome\.antigravity-profiles"
$sonDir = "$profilesDir\son"
$meDir = "$profilesDir\me"
$codexDir = "$profilesDir\codex"
$cliDir = "$userHome\.gemini\antigravity-cli"
$tokenFile = "$cliDir\antigravity-oauth-token"
$sonToken = "$sonDir\antigravity-oauth-token"
$meToken = "$meDir\antigravity-oauth-token"
$codexAuth = "$userHome\.codex\auth.json"

function Get-ActiveProfile {
    if (Test-Path $tokenFile) {
        try {
            $content = Get-Content $tokenFile -Raw | ConvertFrom-Json
            if ($content.id_token) {
                $parts = $content.id_token.Split('.')
                if ($parts.Length -ge 2) {
                    $payload = $parts[1]
                    while ($payload.Length % 4 -ne 0) { $payload += "=" }
                    $json = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String($payload)) | ConvertFrom-Json
                    if ($json.email) {
                        return "$($json.email)"
                    }
                }
            }
            if ($content.email) {
                return "$($content.email)"
            }
        } catch {}
    }
    if (Test-Path $baseConfig) {
        $targetPath = (Get-Item $baseConfig).Target
        if ($targetPath -like "*\me*") { return "me (Primary: tukroschu@gmail.com)" }
        if ($targetPath -like "*\son*") { return "son (Secondary: arsen.k111999@gmail.com)" }
        if ($targetPath -like "*\codex*") { return "codex (OpenAI: arsen.k111999@gmail.com)" }
    }
    return "Not configured / Ready for login"
}

if ($Target -eq "status" -or $Target -eq "list") {
    Write-Host "`n--- Antigravity Profile Status ---" -ForegroundColor Cyan
    Write-Host "Active Account: $(Get-ActiveProfile)" -ForegroundColor Yellow
    Write-Host "Available profiles: 'me', 'son', 'codex'" -ForegroundColor DarkGray
    Write-Host "Tip: Use /logout and /login inside 'agy' to change active Google credentials.`n" -ForegroundColor DarkGray
    return
}

# 1. Save current active token to its respective profile if found
if (Test-Path $tokenFile) {
    try {
        $curr = Get-Content $tokenFile -Raw
        if ($curr -like "*arsen*") {
            Copy-Item -Path $tokenFile -Destination $sonToken -Force
        } elseif ($curr -like "*tukroschu*") {
            Copy-Item -Path $tokenFile -Destination $meToken -Force
        }
    } catch {}
}

# 2. Switch junction
$destPath = "$profilesDir\$Target"
if (-not (Test-Path $destPath)) {
    New-Item -ItemType Directory -Force -Path $destPath | Out-Null
}

if (Test-Path $baseConfig) {
    $item = Get-Item $baseConfig
    if ($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) {
        [System.IO.Directory]::Delete($baseConfig)
    } else {
        Remove-Item -Path $baseConfig -Recurse -Force
    }
}
New-Item -ItemType Junction -Path $baseConfig -Target $destPath | Out-Null

# 3. Swap active token in CLI directory
if ($Target -eq "son" -or $Target -eq "codex") {
    if (Test-Path $sonToken) {
        Copy-Item -Path $sonToken -Destination $tokenFile -Force
    }
} elseif ($Target -eq "me") {
    if (Test-Path $meToken) {
        Copy-Item -Path $meToken -Destination $tokenFile -Force
    } else {
        if (Test-Path $tokenFile) {
            Remove-Item -Path $tokenFile -Force
        }
    }
}

# 4. Sync antigravity-proxy accounts.json if present
$proxyAccounts = "$userHome\.config\antigravity-proxy\accounts.json"
if (Test-Path $proxyAccounts) {
    try {
        $accJson = Get-Content $proxyAccounts -Raw | ConvertFrom-Json
        if ($Target -eq "me") {
            for ($i = 0; $i -lt $accJson.accounts.Count; $i++) {
                if ($accJson.accounts[$i].email -like "*tukroschu*") {
                    $accJson.activeIndex = $i
                    break
                }
            }
        } elseif ($Target -eq "son" -or $Target -eq "codex") {
            for ($i = 0; $i -lt $accJson.accounts.Count; $i++) {
                if ($accJson.accounts[$i].email -like "*arsen*") {
                    $accJson.activeIndex = $i
                    break
                }
            }
        }
        $accJson | ConvertTo-Json -Depth 10 | Set-Content -Path $proxyAccounts -Encoding UTF8
    } catch {}
}

Write-Host "[OK] Antigravity CLI active profile switched to: $Target" -ForegroundColor Green
Write-Host "[TIP] If switching to a new account, type '/logout' then '/login' in 'agy' to update Windows Keyring." -ForegroundColor Cyan
