# scripts/deploy-docker.ps1 - Windows PowerShell Docker Deployment Script for AniFlix
# Supports Docker Desktop on Windows, WSL2, Synology Container Manager, and remote hosts.
#
# By default this deploys BOTH containers on a shared docker network:
#   - aniflix      (web server + API, ghcr.io/mangotimmy/ani_gui:latest)
#   - aniflix-rec  (LightFM + Annoy recommender, ghcr.io/mangotimmy/ani_gui-rec:latest)
# so the server can reach http://aniflix-rec:8080 through REC_SERVICE_URL.
# Use -SkipRecommender to deploy the web server alone (it then ranks content-based).

[CmdletBinding()]
param (
    [string]$Port = "3000",
    [string]$Image = "ghcr.io/mangotimmy/ani_gui:latest",
    [string]$ContainerName = "aniflix",
    [string]$RecImage = "ghcr.io/mangotimmy/ani_gui-rec:latest",
    [string]$RecContainerName = "aniflix-rec",
    [string]$Network = "aniflix-net",
    [int]$RecMemoryMb = 2000,
    [switch]$BuildLocal,
    [switch]$SkipRecommender,
    [switch]$SkipTrain,
    [switch]$Retrain,
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

# 3. Handle Local Build vs Remote Image Pull (web server)
if ($BuildLocal) {
    Write-Host "[*] Building local Docker image..." -ForegroundColor Yellow
    docker build -t $Image .
} else {
    Write-Host "[*] Pulling latest image from registry: $Image..." -ForegroundColor Yellow
    docker pull $Image
}

# 4. Recommender service: pull, train once, start, and attach to a shared network
$RecommenderAvailable = $false
if ($SkipRecommender) {
    Write-Host "[i] -SkipRecommender set: deploying the web server only (content-based ranking)." -ForegroundColor DarkGray
} else {
    Write-Host "[*] Pulling recommender image: $RecImage..." -ForegroundColor Yellow
    docker pull $RecImage
    if ($LASTEXITCODE -eq 0) {
        $RecommenderAvailable = $true
    } else {
        Write-Host "[!] Could not pull the recommender image." -ForegroundColor Yellow
        Write-Host "    Private GHCR packages need a login first: docker login ghcr.io" -ForegroundColor Yellow
        Write-Host "    Continuing with the web server only; the API falls back to content-based ranking." -ForegroundColor Yellow
    }
}

if ($RecommenderAvailable) {
    docker network create $Network 2>$null | Out-Null
    if ($LASTEXITCODE -eq 0) {
        Write-Host "[✓] Created docker network: $Network" -ForegroundColor Green
    } else {
        Write-Host "[i] Docker network '$Network' already exists." -ForegroundColor DarkGray
    }

    # 4a. Train the artifacts when they are missing (or when -Retrain is passed)
    $MappingFile = Join-Path $DataDir "id_mapping.json"
    $NeedsTraining = $Retrain -or (-not (Test-Path $MappingFile))
    if ($NeedsTraining -and -not $SkipTrain) {
        Write-Host "[*] Training recommendation artifacts into $DataDir (reads data/users/*.json)..." -ForegroundColor Yellow
        # A running service keeps the index memory-mapped; stop it so the files can be replaced.
        $existingRec = docker ps -a --filter "name=^/${RecContainerName}$" --format '{{.ID}}'
        if ($existingRec) {
            docker rm -f $RecContainerName | Out-Null
        }
        docker run --rm -v "${DataDir}:/app/data" $RecImage `
            python -m src.train --data-dir /app/data --artifact-dir /app/data
        if ($LASTEXITCODE -eq 0) {
            Write-Host "[✓] Recommendation artifacts trained." -ForegroundColor Green
        } else {
            Write-Host "[!] Training failed; the recommender will start but report unavailable." -ForegroundColor Yellow
            Write-Host "    The API keeps using content-based ranking until artifacts exist." -ForegroundColor Yellow
        }
    } elseif ($NeedsTraining) {
        Write-Host "[i] -SkipTrain set: the recommender will report unavailable until artifacts exist." -ForegroundColor DarkGray
    } else {
        Write-Host "[✓] Recommendation artifacts already present: $MappingFile" -ForegroundColor Green
    }

    # 4b. (Re)start the recommender container
    $existingRec = docker ps -a --filter "name=^/${RecContainerName}$" --format '{{.ID}}'
    if ($existingRec) {
        Write-Host "[*] Stopping and removing existing container '$RecContainerName'..." -ForegroundColor Yellow
        docker rm -f $RecContainerName | Out-Null
    }

    Write-Host "[*] Starting recommender container on network $Network..." -ForegroundColor Cyan
    $recRunArgs = @(
        "run", "-d",
        "--name", $RecContainerName,
        "--network", $Network,
        "--restart", "unless-stopped",
        "--memory", "${RecMemoryMb}m",
        "-v", "${DataDir}:/app/data",
        "-e", "REC_ARTIFACT_DIR=/app/data",
        "-e", "REC_PLATFORM_DATA_DIR=/app/data",
        "-e", "REC_DEFAULT_K=10",
        "-e", "REC_PREFETCH=0",
        $RecImage
    )
    & docker @recRunArgs
    if ($LASTEXITCODE -ne 0) {
        Write-Host "[!] Failed to start the recommender; continuing with the web server only." -ForegroundColor Yellow
        $RecommenderAvailable = $false
    }
}

# 5. Stop and remove existing web server container if running
$existing = docker ps -a --filter "name=^/${ContainerName}$" --format '{{.ID}}'
if ($existing) {
    Write-Host "[*] Stopping and removing existing container '$ContainerName'..." -ForegroundColor Yellow
    docker rm -f $ContainerName | Out-Null
}

# 6. Launch the web server, wired to the recommender when it is available
Write-Host "[*] Starting AniFlix container on port $Port..." -ForegroundColor Cyan

$dockerRunArgs = @(
    "run", "-d",
    "--name", $ContainerName,
    "-p", "${Port}:3000",
    "--dns", "1.1.1.1",
    "--dns", "8.8.8.8",
    "-v", "${DataDir}:/data",
    "-v", "${DownloadsDir}:/downloads",
    "-e", "NODE_ENV=production",
    "-e", "PORT=3000",
    "-e", "ANIFLIX_DATA_DIR=/data",
    "-e", "ANIFLIX_DOWNLOADS_DIR=/downloads"
)

if ($RecommenderAvailable) {
    $dockerRunArgs += @(
        "--network", $Network,
        "-e", "REC_SERVICE_URL=http://${RecContainerName}:8080",
        "-e", "REC_TIMEOUT_MS=600"
    )
}

$dockerRunArgs += @("--restart", "unless-stopped", $Image)

& docker @dockerRunArgs

if ($LASTEXITCODE -eq 0) {
    Write-Host "==========================================================" -ForegroundColor Green
    Write-Host "  [✓] AniFlix Docker Server successfully deployed!" -ForegroundColor Green
    Write-Host "  🌐 Web URL:       http://localhost:$Port" -ForegroundColor Cyan
    Write-Host "  📱 LAN / Proxy:   http://<Your-LAN-IP>:$Port" -ForegroundColor Cyan
    Write-Host "  📂 Downloads:     $DownloadsDir" -ForegroundColor White
    Write-Host "  💾 Data/DB:       $DataDir" -ForegroundColor White
    if ($RecommenderAvailable) {
        Write-Host "  🧠 Recommender:   http://${RecContainerName}:8080 (internal network $Network)" -ForegroundColor White
    }
    Write-Host "==========================================================" -ForegroundColor Green

    if ($RecommenderAvailable) {
        Write-Host "[*] Waiting for the recommender to answer /healthz..." -ForegroundColor Cyan
        $recHealthy = $false
        for ($attempt = 0; $attempt -lt 15; $attempt++) {
            Start-Sleep -Seconds 2
            docker exec $RecContainerName python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8080/healthz', timeout=3)" 2>$null | Out-Null
            if ($LASTEXITCODE -eq 0) { $recHealthy = $true; break }
        }
        if ($recHealthy) {
            Write-Host "[✓] Recommender is healthy." -ForegroundColor Green
        } else {
            Write-Host "[!] Recommender did not answer in time; check 'docker logs $RecContainerName'." -ForegroundColor Yellow
        }

        try {
            $engine = Invoke-RestMethod -Uri "http://localhost:${Port}/api/recommendations/engine" -TimeoutSec 10
            Write-Host "[✓] Ranking engine: mode=$($engine.mode) healthy=$($engine.healthy) items=$($engine.items) dataQuality=$($engine.dataQuality)" -ForegroundColor Green
            if ($engine.mode -ne "lightfm-annoy") {
                Write-Host "    Learned ranking is not active yet (reason: $($engine.reason))." -ForegroundColor DarkGray
            }
        } catch {
            Write-Host "[i] /api/recommendations/engine not reachable yet; the server may still be starting." -ForegroundColor DarkGray
        }
    }

    # Optional: Update plugins inside container
    if ($UpdatePlugins) {
        Write-Host "[*] Updating plugins inside container..." -ForegroundColor Yellow
        docker exec -it $ContainerName yt-dlp -U
    }
} else {
    Write-Host "[!] Container launch failed with exit code $LASTEXITCODE" -ForegroundColor Red
}
