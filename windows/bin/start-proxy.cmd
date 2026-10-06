@echo off
setlocal

set "USER_HOME=%USERPROFILE%"
set "PROXY_DIR=%USER_HOME%\Documents\GitHub\antigravity-claude-proxy"
set "BIN_DIR=%USER_HOME%\bin"

if not exist "%PROXY_DIR%" (
    echo [ERROR] Proxy directory not found: %PROXY_DIR%
    exit /b 1
)

:: Check if already running on port 8080
netstat -ano | findstr :8080 | findstr LISTENING >nul
if %errorlevel% equ 0 (
    echo [OK] Antigravity Claude Proxy is already listening on port 8080.
    exit /b 0
)

if "%1"=="--foreground" (
    echo [*] Starting Antigravity Claude Proxy in foreground...
    cd /d "%PROXY_DIR%"
    node src/index.js
) else (
    echo [*] Starting Antigravity Claude Proxy in background...
    schtasks /run /tn AntigravityProxy >nul 2>&1
    if %errorlevel% neq 0 (
        if exist "%BIN_DIR%\start-proxy.vbs" (
            wscript.exe "%BIN_DIR%\start-proxy.vbs"
        ) else (
            wscript.exe "%~dp0start-proxy.vbs"
        )
    )
    ping 127.0.0.1 -n 3 >nul 2>&1
    echo [OK] Proxy launched. Web UI available at: http://localhost:8080/
)
