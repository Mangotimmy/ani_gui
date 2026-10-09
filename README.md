# 🎬 AniFlix 2.0 (アニメフリックス)

<div align="center">

![AniFlix Banner](https://img.shields.io/badge/AniFlix-v2.0.0-E50914?style=for-the-badge&logo=netflix&logoColor=white)
[![Docker Image](https://img.shields.io/badge/Docker-Ready-2496ED?style=for-the-badge&logo=docker&logoColor=white)](https://github.com/Atszl/aniflix)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=for-the-badge)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-20+-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![Multi-Platform](https://img.shields.io/badge/Platforms-Web%20|%20iOS%20|%20iPadOS%20|%20Android%20|%20Windows%20|%20NAS-blueviolet?style=for-the-badge)](https://github.com/Atszl/aniflix)

<p align="center">
  <b>A Cinematic streaming platform Web & Desktop Anime Streaming Hub, Batch Downloader & NAS Media Server</b><br>
  streaming platform 風格影院級動漫串流平台 • 批次下載器 • Synology NAS / Docker 私有雲伺服器
</p>
platform 
[English](#-english) | [繁體中文](#-繁體中文) | [Docker NAS Deployment](#-docker--nas-deployment) | [API & Tech Specs](#-technical-architecture)

</div>

---

## 🌟 Highlights & Features / 核心特色

### 📺 1. straming platform-Style Streaming Experience
- **Cinematic Hero Spotlight**: High-definition backdrop art, ratings, synopsis, and instant play controls.
- **Dynamic Year & Seasonal Catalog**: Real-time browsing for **2026, 2027, 2028+** and historical archives down to 1970.
- **9 Auto-Filtered Carousels**: *Trending Now*, *This Season*, *Top Rated*, *Recommendations*, *Favorites*, *Continue Watching*, *Action*, *Fantasy*, and *Upcoming*.
- **Safe Mode Protection**: Default R-18 / Adult content filter toggle across carousels, search, and BitTorrent magnets.

### 🎯 2. Intelligent Anime Resolver & Accurate Episode Tracking
- **Multi-Candidate Querying**: Concurrently queries Romaji, English, and Japanese native titles to eliminate wrong-video mismatches.
- **Strict Similarity Matching**: Token overlap threshold ($\ge 0.40$) and `data-jname` scraping ensure 100% correct anime streams.
- **Aired-Episodes Cap**: Automatically caps released episodes based on AniList next airing schedule (`maxAiredCap = nextAiring.episode - 1`). Upcoming episodes are accurately marked as *Airing Soon*.

### 📱 3. Cross-Platform Mobile & Tablet Support (iOS, iPadOS, Android)
- **Automatic Client Detection**: Detects mobile devices and LAN remote access to adapt controls.
- **External Player Deep-Links**: Direct 1-tap playback via **Infuse**, **VLC**, **IINA**, **PotPlayer**, and **nPlayer** on iPad, iPhone, and Android.
- **Local Desktop MPV Acceleration**: Hardware-accelerated local desktop MPV playback when accessed on localhost.

### ⚡ 4. High-Throughput Batch Downloader
- **Aria2c & yt-dlp Turbo Acceleration**: 16 concurrent fragments with multi-thread download management.
- **Clean Process Tree Termination**: Clean termination of child processes (`taskkill /pid /T /F` on Windows, `SIGTERM` on Linux) to prevent orphaned background CPU/RAM leaks.
- **Throttled SSE Real-Time Updates**: Progress broadcast capped to prevent browser re-render thrashing.

### 💾 5. Complete User Data Backup & Restore
- **Multiple Export Formats**: Export favorites, watch history, playback progress, and settings to **JSON**, **XML**, or **CSV**.
- **1-Click Restore**: Seamless restoration of user backups with XML and JSON parsing.

### 🌐 6. Multi-Language Localization (i18n)
- Full user interface and anime metadata localization in **繁體中文 (Traditional Chinese)**, **简体中文 (Simplified Chinese)**, **日本語 (Japanese)**, and **English**.
- Real-time subtitle translation via AI WebVTT engine.

---

## 🐳 Docker & NAS Deployment

Deploy AniFlix effortlessly on **Synology DSM 7.2 (Container Manager)**, **QNAP Container Station**, **Unraid**, **TrueNAS**, or any Linux Docker host.

### Quick Start with Docker Compose

1. Create a `docker-compose.yml` file:

```yaml
version: '3.8'

services:
  aniflix:
    image: ghcr.io/Mangotimmy/ani_gui:latest
    container_name: aniflix
    restart: unless-stopped
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
      - PORT=3000
      - TZ=Asia/Taipei
      - ANIFLIX_DATA_DIR=/data
      - ANIFLIX_DOWNLOADS_DIR=/downloads
    volumes:
      - ./data:/data
      - ./downloads:/downloads
    deploy:
      resources:
        limits:
          memory: 1024M
```

2. Launch container:
```bash
docker compose up -d
```

3. Open `http://<your-nas-ip>:3000` on any device (PC, iPad, iPhone, Android TV, Mac).

### Synology Container Manager Setup
1. Open **Container Manager** > **Project** > **Create**.
2. Set Project Name to `aniflix` and upload or paste the `docker-compose.yml`.
3. Map `/data` to your Docker share folder (e.g., `/docker/aniflix/data`).
4. Map `/downloads` to your media storage folder (e.g., `/volume1/video/Anime`).
5. Click **Apply** and access AniFlix directly in your browser!

---

## 💻 Local Desktop Setup (Windows / macOS / Linux)

### Prerequisites
- [Node.js](https://nodejs.org/) v20.0.0 or higher
- [yt-dlp](https://github.com/yt-dlp/yt-dlp) and [ffmpeg](https://ffmpeg.org/) (optional for local downloading and MPV playback)

### Installation

```bash
# Clone the repository
git clone https://github.com/Atszl/aniflix.git
cd aniflix

# Install dependencies
npm install

# Start development mode (Client on :3000, Server on :3001)
npm run dev
```

### Production Build
```bash
# Build frontend assets
npm run build

# Start production server on port 3000
npm start
```

---

## ⌨️ Player Keyboard Shortcuts

| Shortcut | Action |
| :--- | :--- |
| <kbd>Space</kbd> / <kbd>K</kbd> | Play / Pause |
| <kbd>←</kbd> / <kbd>→</kbd> | Seek Backward / Forward 10 seconds |
| <kbd>↑</kbd> / <kbd>↓</kbd> | Increase / Decrease Volume |
| <kbd>F</kbd> | Toggle Fullscreen |
| <kbd>M</kbd> | Toggle Mute |
| <kbd>Esc</kbd> | Exit Player / Close Modal |

---

## 🏗️ Technical Architecture

```
┌────────────────────────────────────────────────────────┐
│                   AniFlix Web Client                   │
│   React 18 • Vite • TailwindCSS • HLS.js • Lucide UI   │
└───────────────────────────┬────────────────────────────┘
                            │ (REST / SSE / WebSockets)
┌───────────────────────────▼────────────────────────────┐
│                  AniFlix Express Core                  │
│       Node.js • BoundedCache LRU • ChineseTitleService │
└──────┬────────────────────┬────────────────────┬───────┘
       │                    │                    │
┌──────▼──────┐      ┌──────▼──────┐      ┌──────▼──────┐
│ Stream & Ep │      │  Metadata   │      │ Downloader  │
│  Resolver   │      │   Aggregator│      │   Engine    │
│ (Similarity │      │  (AniList & │      │  (yt-dlp &  │
│ Cutoff ≥0.4)│      │   Bangumi)  │      │   aria2c)   │
└─────────────┘      └─────────────┘      └─────────────┘
```

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).
Built with passion for anime fans worldwide.
