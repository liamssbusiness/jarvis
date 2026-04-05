@echo off
REM JARVIS Auto-Start Script
REM Runs the local agent + cloudflare tunnel + updates Vercel with new tunnel URL
REM Place a shortcut to this in shell:startup to auto-launch with Windows

title JARVIS Local Agent

echo.
echo ================================================
echo   J.A.R.V.I.S  Auto-Start v1.0
echo ================================================
echo.

set SCRIPT_DIR=%~dp0
cd /d "%SCRIPT_DIR%"

echo [1/4] Starting local agent on port 3002...
start "JARVIS Agent" /MIN cmd /c "set LOCAL_AGENT_SECRET=jarvis-liam-secure-2026 && node http-bridge.js"

timeout /t 3 /nobreak >nul

echo [2/4] Starting Cloudflare tunnel...
start "JARVIS Tunnel" /MIN cmd /c "npx cloudflared tunnel --url http://localhost:3002 > tunnel-output.log 2>&1"

echo [3/4] Waiting for tunnel URL (15 seconds)...
timeout /t 15 /nobreak >nul

echo [4/4] Updating Vercel with new tunnel URL...
node update-vercel-url.js

echo.
echo ================================================
echo   JARVIS is LIVE. Keep this window open.
echo   Close it to shut down JARVIS PC control.
echo ================================================
echo.
echo Press Ctrl+C to stop, or close this window.
pause >nul
