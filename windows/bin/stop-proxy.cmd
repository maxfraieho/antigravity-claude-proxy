@echo off
setlocal

echo [*] Looking for Antigravity Claude Proxy on port 8080...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :8080 ^| findstr LISTENING') do (
    echo [*] Terminating process PID %%a...
    taskkill /F /PID %%a >nul 2>&1
)

echo [OK] Proxy stopped.
