import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { findBinary } from './environment.js';

export function launchMpv({ streamUrl, title, subtitleUrl, referer, profile = 'igpu', enableUpscale = false }) {
  const mpvExecutable = findBinary('mpv', 'mpv');
  const isHighQuality = profile === 'high-quality' || enableUpscale === true;

  const args = [
    streamUrl,
    `--force-media-title=${title || 'AniFlix Stream'}`,
    '--geometry=1280x720',
    '--autofit=85%',
    '--hr-seek=yes',
    '--gpu-context=d3d11'
  ];

  if (isHighQuality) {
    // High-Quality Profile for Dedicated GPUs
    args.push(
      '--hwdec=auto-safe',
      '--vo=gpu-next,gpu',
      '--scale=spline36',
      '--cscale=spline36',
      '--video-sync=display-resample'
    );
  } else {
    // iGPU Low-Power / Intel QuickSync Profile (0% 3D engine overhead)
    args.push(
      '--hwdec=d3d11va,auto-safe',
      '--vo=gpu',
      '--scale=bilinear',
      '--cscale=bilinear'
    );
  }

  if (referer) {
    args.push(`--referrer=${referer}`);
  }
  if (subtitleUrl) {
    args.push(`--sub-file=${subtitleUrl}`);
  }

  try {
    const child = spawn(mpvExecutable, args, {
      detached: true,
      stdio: 'ignore',
      windowsHide: false
    });
    child.unref();
    return { success: true, message: `Launched MPV for ${title}` };
  } catch (err) {
    console.error('Failed to launch MPV:', err);
    return { success: false, error: err.message };
  }
}

export function openFolder(folderPath) {
  try {
    const target = typeof folderPath === 'string' && folderPath.trim() 
      ? folderPath.trim() 
      : null;

    if (!target) {
      return { success: false, error: 'Invalid folder path provided' };
    }

    if (!fs.existsSync(target)) {
      fs.mkdirSync(target, { recursive: true });
    }

    // Check platform / headless environment
    const platform = process.platform;
    const isHeadless = Boolean(process.env.DOCKER_CONTAINER || process.env.ANIFLIX_CONTAINER || fs.existsSync('/.dockerenv'));

    if (isHeadless) {
      // In Docker or headless container, desktop file managers don't exist
      return { success: true, mode: 'web', message: 'Running in container, fallback to web downloads view' };
    }

    let command = '';
    let args = [];

    if (platform === 'win32') {
      command = 'explorer.exe';
      args = [target];
    } else if (platform === 'darwin') {
      command = 'open';
      args = [target];
    } else {
      command = 'xdg-open';
      args = [target];
    }

    const child = spawn(command, args, {
      detached: true,
      stdio: 'ignore'
    });
    child.unref();
    return { success: true, mode: 'desktop' };
  } catch (err) {
    console.error('Failed to open folder:', err);
    return { success: false, error: err.message, mode: 'web' };
  }
}

export function openMagnetLink(magnetUrl) {
  try {
    if (!magnetUrl) throw new Error('Missing magnet URL');
    const child = spawn('cmd.exe', ['/c', 'start', '', magnetUrl], {
      detached: true,
      stdio: 'ignore'
    });
    child.unref();
    return { success: true };
  } catch (err) {
    console.error('Failed to open magnet link:', err);
    return { success: false, error: err.message };
  }
}

