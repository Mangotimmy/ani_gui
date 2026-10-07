# start-aniflix.ps1 - PowerShell launcher for AniFlix
Write-Host "============================================================" -ForegroundColor Red
Write-Host "         AniFlix - Anime Streaming & Downloader" -ForegroundColor White
Write-Host "          Powered by ani-cli, yt-dlp & aria2c" -ForegroundColor Gray
Write-Host "============================================================" -ForegroundColor Red

$env:PATH = "C:\Users\Atszl\scoop\shims;" + $env:PATH
Set-Location -Path $PSScriptRoot

Write-Host "`n[*] Starting AniFlix server at http://localhost:3001 ..." -ForegroundColor Cyan
Start-Process "http://localhost:3001"

node server/index.js
