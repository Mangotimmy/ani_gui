// server/services/userService.js - Multi-User Profile & Data Synchronization Service
import fs from 'fs';
import path from 'path';
import { DATA_DIR } from './paths.js';

function getUsersDir() {
  const usersDir = path.join(DATA_DIR, 'users');
  if (!fs.existsSync(usersDir)) {
    try {
      fs.mkdirSync(usersDir, { recursive: true });
    } catch {}
  }
  return usersDir;
}

function sanitizeUsername(username) {
  if (!username || typeof username !== 'string') return 'Default';
  // Allow unicode letters/numbers, hyphens, and underscores; remove special filesystem characters
  const clean = username.trim().replace(/[<>:"/\\|?*\x00-\x1F]/g, '').slice(0, 32);
  return clean || 'Default';
}

function getUserFilePath(username) {
  const clean = sanitizeUsername(username);
  return path.join(getUsersDir(), `${clean}.json`);
}

/**
 * List all registered user profiles on the server
 */
export function listUsers() {
  try {
    const dir = getUsersDir();
    if (!fs.existsSync(dir)) return [];
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
    const users = [];

    for (const file of files) {
      try {
        const content = fs.readFileSync(path.join(dir, file), 'utf-8');
        const parsed = JSON.parse(content);
        users.push({
          username: parsed.username || path.basename(file, '.json'),
          displayName: parsed.displayName || parsed.username || path.basename(file, '.json'),
          avatar: parsed.avatar || 'cat',
          favoritesCount: Array.isArray(parsed.favorites) ? parsed.favorites.length : 0,
          historyCount: Array.isArray(parsed.watchHistory) ? parsed.watchHistory.length : 0,
          updatedAt: parsed.updatedAt || parsed.createdAt || Date.now()
        });
      } catch {}
    }

    // Sort by most recently active
    return users.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  } catch (err) {
    console.warn('[UserService] Failed to list users:', err.message);
    return [];
  }
}

/**
 * Retrieve or initialize a user profile by username
 */
export function getUser(username) {
  const clean = sanitizeUsername(username);
  const filePath = getUserFilePath(clean);

  try {
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf-8');
      const parsed = JSON.parse(content);
      return {
        username: clean,
        displayName: parsed.displayName || clean,
        avatar: parsed.avatar || 'cat',
        favorites: Array.isArray(parsed.favorites) ? parsed.favorites : [],
        watchHistory: Array.isArray(parsed.watchHistory) ? parsed.watchHistory : [],
        settings: parsed.settings || {},
        updatedAt: parsed.updatedAt || Date.now(),
        createdAt: parsed.createdAt || Date.now()
      };
    }
  } catch (err) {
    console.warn(`[UserService] Failed to read user ${clean}:`, err.message);
  }

  // Create default new user profile
  const newUser = {
    username: clean,
    displayName: clean,
    avatar: 'cat',
    favorites: [],
    watchHistory: [],
    settings: {},
    updatedAt: Date.now(),
    createdAt: Date.now()
  };

  saveUser(clean, newUser);
  return newUser;
}

/**
 * Persist user data (favorites, watch history, settings) to disk
 */
export function saveUser(username, data = {}) {
  const clean = sanitizeUsername(username);
  const filePath = getUserFilePath(clean);

  try {
    const existing = fs.existsSync(filePath)
      ? JSON.parse(fs.readFileSync(filePath, 'utf-8'))
      : { createdAt: Date.now() };

    // Guard against runaway payloads from a corrupted localStorage copy.
    const MAX_ITEMS = 5000;
    const updated = {
      username: clean,
      displayName: data.displayName || existing.displayName || clean,
      avatar: data.avatar || existing.avatar || 'cat',
      favorites: Array.isArray(data.favorites) ? data.favorites.slice(0, MAX_ITEMS) : (existing.favorites || []),
      watchHistory: Array.isArray(data.watchHistory) ? data.watchHistory.slice(0, MAX_ITEMS) : (existing.watchHistory || []),
      settings: data.settings !== undefined ? { ...existing.settings, ...data.settings } : (existing.settings || {}),
      updatedAt: Date.now(),
      createdAt: existing.createdAt || Date.now()
    };

    // Atomic write: a crash or a concurrent request must never leave a truncated profile.
    const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(tempPath, JSON.stringify(updated, null, 2), 'utf-8');
    fs.renameSync(tempPath, filePath);
    return updated;
  } catch (err) {
    console.error(`[UserService] Failed to save user ${clean}:`, err.message);
    return null;
  }
}

/**
 * Delete a user profile
 */
export function deleteUser(username) {
  const clean = sanitizeUsername(username);
  const filePath = getUserFilePath(clean);
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      return true;
    }
  } catch (err) {
    console.warn(`[UserService] Failed to delete user ${clean}:`, err.message);
  }
  return false;
}
