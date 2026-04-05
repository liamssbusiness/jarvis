@echo off
REM Installs JARVIS as a Windows startup program
REM Run this ONCE. After that, JARVIS will auto-launch every time your PC boots.

set SCRIPT_DIR=%~dp0
set STARTUP_FOLDER=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup
set SHORTCUT_NAME=JARVIS.lnk

echo.
echo ================================================
echo   Installing JARVIS Auto-Start
echo ================================================
echo.

REM Create a VBS script to generate the shortcut
set VBS_SCRIPT=%TEMP%\create-jarvis-shortcut.vbs
echo Set WshShell = CreateObject("WScript.Shell") > "%VBS_SCRIPT%"
echo Set Shortcut = WshShell.CreateShortcut("%STARTUP_FOLDER%\%SHORTCUT_NAME%") >> "%VBS_SCRIPT%"
echo Shortcut.TargetPath = "%SCRIPT_DIR%start-jarvis.bat" >> "%VBS_SCRIPT%"
echo Shortcut.WorkingDirectory = "%SCRIPT_DIR%" >> "%VBS_SCRIPT%"
echo Shortcut.WindowStyle = 7 >> "%VBS_SCRIPT%"
echo Shortcut.Description = "JARVIS Local Agent Auto-Start" >> "%VBS_SCRIPT%"
echo Shortcut.Save >> "%VBS_SCRIPT%"

cscript //nologo "%VBS_SCRIPT%"
del "%VBS_SCRIPT%"

if exist "%STARTUP_FOLDER%\%SHORTCUT_NAME%" (
    echo ✅ Installed successfully!
    echo.
    echo Location: %STARTUP_FOLDER%\%SHORTCUT_NAME%
    echo.
    echo JARVIS will now auto-start every time you log into Windows.
    echo To remove, delete the shortcut from that folder.
) else (
    echo ❌ Installation failed.
)

echo.
echo Want to start JARVIS right now? [Y/N]
set /p RUNNOW=
if /i "%RUNNOW%"=="Y" (
    start "" "%SCRIPT_DIR%start-jarvis.bat"
)

pause
