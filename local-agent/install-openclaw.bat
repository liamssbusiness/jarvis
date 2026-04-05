@echo off
REM JARVIS OpenClaw installer
REM Installs an autonomous coding agent (OpenClaw or Claude Code) globally
REM and wires up an Anthropic API key for Liam.

setlocal enabledelayedexpansion
echo.
echo ============================================================
echo   J.A.R.V.I.S  OpenClaw installer
echo ============================================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js not found on PATH. Install Node 18+ first.
  exit /b 1
)
where npm >nul 2>nul
if errorlevel 1 (
  echo [ERROR] npm not found on PATH.
  exit /b 1
)

echo [1/4] Installing the coding agent globally...
echo       Trying: npm i -g @anthropic-ai/claude-code
call npm install -g @anthropic-ai/claude-code
if errorlevel 1 (
  echo [WARN] Claude Code install failed; trying openclaw...
  call npm install -g openclaw
)

echo.
echo [2/4] Checking for ANTHROPIC_API_KEY...
if "%ANTHROPIC_API_KEY%"=="" (
  set /p ANTHROPIC_API_KEY="Paste your Anthropic API key (sk-ant-...): "
  setx ANTHROPIC_API_KEY "!ANTHROPIC_API_KEY!" >nul
  echo       Saved to user environment (takes effect in new shells).
) else (
  echo       Found existing ANTHROPIC_API_KEY.
)

echo.
echo [3/4] Creating jarvis-logs directory...
if not exist "%USERPROFILE%\jarvis-logs" mkdir "%USERPROFILE%\jarvis-logs"
if not exist "%USERPROFILE%\jarvis-logs\openclaw-tasks" mkdir "%USERPROFILE%\jarvis-logs\openclaw-tasks"
echo       %USERPROFILE%\jarvis-logs

echo.
echo [4/4] Smoke test...
where claude >nul 2>nul
if not errorlevel 1 (
  echo       claude CLI found. Version:
  call claude --version
  goto :done
)
where openclaw >nul 2>nul
if not errorlevel 1 (
  echo       openclaw CLI found. Version:
  call openclaw --version
  goto :done
)
echo [WARN] Neither claude nor openclaw is on PATH after install.
echo        Open a fresh terminal and re-run this script.
exit /b 1

:done
echo.
echo ============================================================
echo   Install complete.
echo   Next: start the local agent (start-jarvis.bat) and send
echo   "build something" in Telegram to test the flow.
echo ============================================================
endlocal
