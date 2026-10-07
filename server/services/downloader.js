// downloader.js - Batch anime downloader engine using yt-dlp and aria2c
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { resolveStream } from './streamResolver.js';
import { findBinary } from './environment.js';

const ytDlpPath = findBinary('yt-dlp', 'yt-dlp');
const aria2cPath = findBinary('aria2c', 'aria2');
const ffmpegPath = findBinary('ffmpeg', 'ffmpeg');

// Default download folder: ~/Downloads/Anime (or ANIFLIX_DOWNLOADS_DIR in Docker / NAS)
export const DEFAULT_DOWNLOAD_DIR = process.env.ANIFLIX_DOWNLOADS_DIR || path.join(os.homedir(), 'Downloads', 'Anime');

// In-memory queue & task manager
class DownloadManager {
  constructor() {
    this.tasks = new Map(); // id -> task
    this.listeners = new Set(); // SSE client response streams
    this.maxConcurrent = 3;
    this.downloadDir = DEFAULT_DOWNLOAD_DIR;

    if (!fs.existsSync(this.downloadDir)) {
      fs.mkdirSync(this.downloadDir, { recursive: true });
    }
  }

  setDownloadDir(dir) {
    if (dir && typeof dir === 'string') {
      this.downloadDir = dir;
      if (!fs.existsSync(this.downloadDir)) {
        fs.mkdirSync(this.downloadDir, { recursive: true });
      }
    }
    return this.downloadDir;
  }

  addSubscriber(res) {
    this.listeners.add(res);
    // Send initial snapshot of all tasks
    const snapshot = Array.from(this.tasks.values());
    res.write(`data: ${JSON.stringify({ type: 'SNAPSHOT', tasks: snapshot })}\n\n`);

    res.on('close', () => {
      this.listeners.delete(res);
    });
  }

  broadcast(event) {
    const payload = `data: ${JSON.stringify(event)}\n\n`;
    for (const res of this.listeners) {
      try {
        res.write(payload);
      } catch (err) {
        this.listeners.delete(res);
      }
    }
  }

  sanitizeFilename(name) {
    return name.replace(/[<>:"/\\|?*]/g, '_').replace(/\s+/g, ' ').trim();
  }

  // Queue a single download or batch
  queueDownloads({ animeTitle, episodeNumbers, quality = 'best', audio = 'sub', streamUrls = {} }) {
    const queuedTasks = [];
    const sanitizedTitle = this.sanitizeFilename(animeTitle);
    const animeDir = path.join(this.downloadDir, sanitizedTitle);
    if (!fs.existsSync(animeDir)) {
      fs.mkdirSync(animeDir, { recursive: true });
    }

    for (const ep of episodeNumbers) {
      const id = `${sanitizedTitle}-E${ep}-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`;
      const filename = `${sanitizedTitle} - Episode ${ep} [${audio.toUpperCase()}]`;

      const task = {
        id,
        animeTitle,
        episode: ep,
        quality,
        audio,
        streamUrl: streamUrls[ep] || null,
        filename,
        progress: 0,
        speed: '0 KiB/s',
        eta: '--:--',
        totalSize: 'Unknown',
        status: 'QUEUED', // QUEUED, DOWNLOADING, COMPLETED, ERROR, CANCELLED
        error: null,
        outputPath: path.join(animeDir, `${filename}.mp4`),
        animeDir,
        createdAt: new Date().toISOString()
      };

      this.tasks.set(id, task);
      queuedTasks.push(task);
    }

    this.broadcast({ type: 'TASKS_ADDED', tasks: queuedTasks });
    this.processQueue();
    return queuedTasks;
  }

  getActiveCount() {
    let count = 0;
    for (const t of this.tasks.values()) {
      if (t.status === 'DOWNLOADING') count++;
    }
    return count;
  }

  processQueue() {
    while (this.getActiveCount() < this.maxConcurrent) {
      const nextTask = Array.from(this.tasks.values()).find(t => t.status === 'QUEUED');
      if (!nextTask) break;
      this.startTask(nextTask);
    }
  }

  async startTask(task) {
    task.status = 'DOWNLOADING';
    this.broadcast({ type: 'TASK_UPDATED', task });

    // Ensure real stream URL is resolved
    if (!task.streamUrl) {
      try {
        console.log(`[Downloader] Resolving stream for download task: ${task.animeTitle} Ep ${task.episode}`);
        const streamData = await resolveStream({
          animeTitle: task.animeTitle,
          episode: task.episode,
          mode: task.audio,
          quality: task.quality
        });
        if (streamData.success && streamData.streamUrl) {
          task.streamUrl = streamData.streamUrl;
          task.referer = streamData.referer || 'https://zokoanime.video/';
        } else {
          throw new Error(streamData.error || 'Failed to resolve stream for episode');
        }
      } catch (err) {
        task.status = 'ERROR';
        task.error = err.message;
        this.broadcast({ type: 'TASK_UPDATED', task });
        this.processQueue();
        return;
      }
    }

    task.startedAt = Date.now();
    task.lastBroadcastTime = 0;

    // Build optimized yt-dlp arguments for maximum throughput
    const outputPath = path.join(this.downloadDir, `${task.filename}.%(ext)s`);
    const args = [
      '--no-check-certificates',
      '--no-warnings',
      '--no-mtime',
      '--concurrent-fragments', '16',
      '--buffer-size', '16M',
      '--http-chunk-size', '10M',
      '--retries', '10',
      '--fragment-retries', '10',
      '--file-access-retries', '5',
      '--socket-timeout', '15',
      '--downloader-args', 'ffmpeg_i:-hwaccel auto',
      '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      '--referer', task.referer || 'https://zokoanime.video/',
      '-o', outputPath,
      task.streamUrl
    ];

    console.log(`Starting download [${task.id}] with yt-dlp:`, ytDlpPath, args.slice(0, 10).join(' '));

    const child = spawn(ytDlpPath, args, { windowsHide: true });
    task.process = child;

    child.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      let hasUpdate = false;

      // 1. Percentage
      const pctMatch = text.match(/\[download\]\s+([\d.]+)%/i);
      if (pctMatch) {
        task.progress = Math.min(99.9, parseFloat(pctMatch[1]));
        hasUpdate = true;
      }

      // 2. Total / estimated size (supports "of ~ 315.40MiB", "of ~315MiB", "of 150.00MiB")
      const sizeMatch = text.match(/of\s+~?\s*([\d.]+\s*[a-zA-Z]+)/i);
      if (sizeMatch) {
        task.totalSize = sizeMatch[1].trim();
        hasUpdate = true;
      }

      // 3. Download speed (e.g. "at 25.60MiB/s")
      const speedMatch = text.match(/at\s+([\d.]+\s*[a-zA-Z]+\/s)/i);
      if (speedMatch) {
        task.speed = speedMatch[1].trim();
        hasUpdate = true;
      }

      // 4. Exact ETA (e.g. "ETA 01:25")
      const etaMatch = text.match(/ETA\s+([0-9:]+)/i);
      if (etaMatch) {
        task.eta = etaMatch[1].trim();
        hasUpdate = true;
      } else if (task.progress > 0 && task.startedAt) {
        // Dynamic fallback ETA calculation from elapsed time and progress
        const elapsed = (Date.now() - task.startedAt) / 1000;
        if (elapsed > 1.5) {
          const totalEst = elapsed / (task.progress / 100);
          const rem = Math.max(0, Math.round(totalEst - elapsed));
          const m = Math.floor(rem / 60);
          const s = rem % 60;
          if (m < 60) {
            task.eta = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
          } else {
            const h = Math.floor(m / 60);
            const remM = m % 60;
            task.eta = `${String(h).padStart(2, '0')}:${String(remM).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
          }
          hasUpdate = true;
        }
      }

      // 5. Fragment count fallback
      const fragMatch = text.match(/\(frag\s+(\d+)\/(\d+)\)/i);
      if (fragMatch) {
        const cur = parseInt(fragMatch[1]);
        const total = parseInt(fragMatch[2]);
        if (total > 0) {
          if (!pctMatch) {
            task.progress = Math.min(99.9, Math.round((cur / total) * 1000) / 10);
          }
          if (!sizeMatch && task.totalSize === 'Unknown') {
            task.totalSize = `${total} frags`;
          }
          hasUpdate = true;
        }
      }

      // Throttle broadcast to every 500ms per task to prevent SSE flood and UI freeze
      if (hasUpdate) {
        const now = Date.now();
        if (now - (task.lastBroadcastTime || 0) >= 500) {
          task.lastBroadcastTime = now;
          this.broadcast({ type: 'TASK_UPDATED', task: { ...task, process: undefined } });
        }
      }
    });

    child.stderr.on('data', (chunk) => {
      const errText = chunk.toString();
      console.warn(`[yt-dlp err] ${task.id}:`, errText.trim());
    });

    child.on('close', (code) => {
      task.process = undefined;
      if (code === 0) {
        task.status = 'COMPLETED';
        task.progress = 100;
        task.eta = '00:00';
        task.speed = 'Done';
      } else if (task.status !== 'CANCELLED') {
        task.status = 'ERROR';
        task.error = `yt-dlp exited with code ${code}`;
      }
      this.broadcast({ type: 'TASK_UPDATED', task });
      this.processQueue();
    });

    child.on('error', (err) => {
      task.process = undefined;
      task.status = 'ERROR';
      task.error = err.message;
      this.broadcast({ type: 'TASK_UPDATED', task });
      this.processQueue();
    });
  }

  cancelTask(id) {
    const task = this.tasks.get(id);
    if (!task) return false;

    if (task.process) {
      try {
        if (process.platform === 'win32' && task.process.pid) {
          // Cleanly terminate full process tree (yt-dlp + ffmpeg/aria2c child processes)
          spawn('taskkill', ['/pid', task.process.pid.toString(), '/T', '/F']);
        } else {
          task.process.kill('SIGTERM');
        }
      } catch (e) {
        console.warn(`[Downloader] Error terminating process for task ${id}:`, e.message);
      }
    }
    task.status = 'CANCELLED';
    this.broadcast({ type: 'TASK_UPDATED', task: { ...task, process: undefined } });
    this.processQueue();
    return true;
  }

  clearCompleted() {
    for (const [id, task] of this.tasks.entries()) {
      if (task.status === 'COMPLETED' || task.status === 'CANCELLED' || task.status === 'ERROR') {
        this.tasks.delete(id);
      }
    }
    const snapshot = Array.from(this.tasks.values());
    this.broadcast({ type: 'SNAPSHOT', tasks: snapshot });
  }

  getAllTasks() {
    return Array.from(this.tasks.values()).map(t => ({ ...t, process: undefined }));
  }
}

export const downloadManager = new DownloadManager();
