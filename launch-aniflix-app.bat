@echo off
title AniFlix Desktop App
cd /d "%~dp0"

if exist "dist-electron\AniFlix 2.0.0.exe" (
    start "" "dist-electron\AniFlix 2.0.0.exe"
) else (
    start "" "dist-electron\win-unpacked\AniFlix.exe"
)
