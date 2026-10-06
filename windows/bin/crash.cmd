@echo off
setlocal
set "GEMINI_API_KEY="
set "GOOGLE_API_KEY="

if /i "%~1"=="--raw" (
    shift
    "C:\Users\vokov\AppData\Local\Programs\crush\crush.exe" %*
) else (
    powershell -NoProfile -ExecutionPolicy Bypass -File "C:\Users\vokov\bin\crash.ps1" %*
)
