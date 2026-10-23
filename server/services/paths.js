// server/services/paths.js - Single source of truth for on-disk data locations
//
// Historically every service resolved its own directory and some used process.cwd().
// That breaks as soon as the working directory is not the repository root, which is
// exactly what happens inside the Docker image (WORKDIR /app) and the packaged
// Electron app (cwd = install dir / read-only asar). The result was a media cache that
// was written somewhere else on every run, so replays never hit it.
//
// Precedence:
//   1. ANIFLIX_DATA_DIR  (Docker: /data, Electron: userData, user override)
//   2. <server>/data     (repository checkout default, where aniflix.db already lives)
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const SERVER_ROOT = path.resolve(__dirname, '..');
export const REPO_ROOT = path.resolve(SERVER_ROOT, '..');

function resolveDataDir() {
  if (process.env.ANIFLIX_DATA_DIR && process.env.ANIFLIX_DATA_DIR.trim()) {
    return path.resolve(process.env.ANIFLIX_DATA_DIR.trim());
  }
  return path.join(SERVER_ROOT, 'data');
}

export const DATA_DIR = resolveDataDir();

export function ensureDir(dir) {
  try {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return true;
  } catch {
    return false;
  }
}

// A writable cache root: prefer DATA_DIR, fall back to the OS temp dir when the data
// directory is read-only (e.g. a locked-down container mount).
export function resolveWritableCacheDir() {
  const preferred = path.join(DATA_DIR, 'cache');
  if (ensureDir(preferred)) {
    try {
      fs.accessSync(preferred, fs.constants.W_OK);
      return preferred;
    } catch {}
  }
  const fallback = path.join(os.tmpdir(), 'aniflix-cache');
  ensureDir(fallback);
  return fallback;
}
