@echo off
setlocal
echo [*] Stopping Laya Decision Engine on port 9623...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :9623 ^| findstr LISTENING') do (
    echo [*] Terminating process PID %%a
    taskkill /F /PID %%a >nul 2>&1
)
echo [OK] Laya Decision Engine stopped.
