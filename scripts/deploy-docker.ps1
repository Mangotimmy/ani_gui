# scripts/deploy-docker.ps1 - Windows PowerShell Docker Deployment Script for AniFlix
# Supports Docker Desktop on Windows, WSL2, Synology Container Manager, and remote hosts.

[CmdletBinding()]
param (
    [string]$Port = "3000",
    [string]$Image = "ghcr.io/atszl/aniflix:latest",
    [string]$ContainerName = "aniflix",
    [switch]$BuildLocal,
    [switch]$UpdatePlugins
)

$ErrorActionPreference = "Stop"

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "  🎬 AniFlix Docker Server Deployment Helper (PowerShell)  " -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan

# 1. Check if Docker is installed and running
try {
    $dockerVersion = docker version --format '{{.Server.Version}}' 2>$null
    if (-not $dockerVersion) {
        throw "Docker daemon not responding."
    }
    Write-Host "[✓] Docker is running (Engine: $dockerVersion)" -ForegroundColor Green
} catch {
    Write-Host "[!] Docker is not running or not installed on this system." -ForegroundColor Red
    Write-Host "    Please ensure Docker Desktop is running or WSL2 Docker service is active." -ForegroundColor Yellow
    exit 1
}

# 2. Prepare persistent data and downloads directories
$CurrentDir = (Get-Location).Path
$DataDir = Join-Path $CurrentDir "data"
$DownloadsDir = Join-Path $CurrentDir "downloads"

if (-not (Test-Path $DataDir)) {
    New-Item -ItemType Directory -Path $DataDir -Force | Out-Null
    Write-Host "[✓] Created persistent data directory: $DataDir" -ForegroundColor Green
}

if (-not (Test-Path $DownloadsDir)) {
    New-Item -ItemType Directory -Path $DownloadsDir -Force | Out-Null
    Write-Host "[✓] Created persistent downloads directory: $DownloadsDir" -ForegroundColor Green
}

# 3. Handle Local Build vs Remote Image Pull
if ($BuildLocal) {
    Write-Host "[*] Building local Docker image..." -ForegroundColor Yellow
    docker build -t $Image .
} else {
    Write-Host "[*] Pulling latest image from registry: $Image..." -ForegroundColor Yellow
    docker pull $Image
}

# 4. Stop and remove existing container if running
$existing = docker ps -a --filter "name=^/${ContainerName}$" --format '{{.ID}}'
if ($existing) {
    Write-Host "[*] Stopping and removing existing container '$ContainerName'..." -ForegroundColor Yellow
    docker rm -f $ContainerName | Out-Null
}

# 5. Launch container with PowerShell backtick parameter syntax
Write-Host "[*] Starting AniFlix container on port $Port..." -ForegroundColor Cyan

$dockerRunArgs = @(
    "run", "-d",
    "--name", $ContainerName,
    "-p", "${Port}:3000",
    "-v", "${DataDir}:/data",
    "-v", "${DownloadsDir}:/downloads",
    "-e", "NODE_ENV=production",
    "-e", "PORT=3000",
    "-e", "ANIFLIX_DATA_DIR=/data",
    "-e", "ANIFLIX_DOWNLOADS_DIR=/downloads",
    "--restart", "unless-stopped",
    $Image
)

& docker @dockerRunArgs

if ($LASTEXITCODE -eq 0) {
    Write-Host "==========================================================" -ForegroundColor Green
    Write-Host "  [✓] AniFlix Docker Server successfully deployed!" -ForegroundColor Green
    Write-Host "  🌐 Web Interface: http://localhost:$Port" -ForegroundColor Cyan
    Write-Host "  📱 Mobile / LAN:  http://<Your-LAN-IP>:$Port" -ForegroundColor Cyan
    Write-Host "  📂 Downloads:     $DownloadsDir" -ForegroundColor White
    Write-Host "  💾 Data/DB:       $DataDir" -ForegroundColor White
    Write-Host "==========================================================" -ForegroundColor Green

    # Optional: Update plugins inside container
    if ($UpdatePlugins) {
        Write-Host "[*] Updating plugins inside container..." -ForegroundColor Yellow
        docker exec -it $ContainerName yt-dlp -U
    }
} else {
    Write-Host "[!] Container launch failed with exit code $LASTEXITCODE" -ForegroundColor Red
}
