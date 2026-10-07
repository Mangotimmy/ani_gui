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
    if (!fs.existsSync(folderPath)) {
      fs.mkdirSync(folderPath, { recursive: true });
    }
    const child = spawn('explorer.exe', [folderPath], {
      detached: true,
      stdio: 'ignore'
    });
    child.unref();
    return { success: true };
  } catch (err) {
    console.error('Failed to open explorer:', err);
    return { success: false, error: err.message };
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

