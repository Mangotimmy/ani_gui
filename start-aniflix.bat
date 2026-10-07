@echo off
title AniFlix - Netflix-Style GUI for ani-cli
color 0C
cls
echo ============================================================
echo.
echo           AniFlix - Anime Streaming & Downloader
echo            Powered by ani-cli, yt-dlp & aria2c
echo.
echo ============================================================
echo.
echo [*] Adding Scoop tools to PATH...
set "PATH=C:\Users\Atszl\scoop\shims;%PATH%"

cd /d "%~dp0"

echo [*] Launching AniFlix server at http://localhost:3001 ...
echo [*] Opening in your default browser...
echo.

start "" "http://localhost:3001"

node server/index.js
if %errorlevel% neq 0 (
    echo.
    echo [!] Server exited. Press any key to exit...
    pause >nul
)
