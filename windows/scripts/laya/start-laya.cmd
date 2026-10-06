@echo off
setlocal

set "USER_HOME=%USERPROFILE%"
set "LAYA_DIR=%USER_HOME%\bin\laya"

if not exist "%LAYA_DIR%\laya_daemon.py" (
    echo [ERROR] Laya daemon script not found: %LAYA_DIR%\laya_daemon.py
    exit /b 1
)

:: Check if already running on port 9623
netstat -ano | findstr :9623 | findstr LISTENING >nul
if %errorlevel% equ 0 (
    echo [OK] Laya Decision Engine is already listening on port 9623.
    exit /b 0
)

if "%1"=="--foreground" (
    echo [*] Starting Laya Decision Engine in foreground...
    python "%LAYA_DIR%\laya_daemon.py" --host 0.0.0.0 --port 9623
) else (
    echo [*] Starting Laya Decision Engine in background...
    schtasks /run /tn LayaDecisionEngine >nul 2>&1
    if %errorlevel% neq 0 (
        start /b pythonw "%LAYA_DIR%\laya_daemon.py" --host 0.0.0.0 --port 9623
    )
    powershell -NoProfile -Command "Start-Sleep -Milliseconds 1200"
    echo [OK] Laya Decision Engine launched on port 9623.
)
