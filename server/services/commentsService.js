// server/services/commentsService.js - Local (per-server) anime comments storage
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const MAX_TEXT = 500;
const MAX_PER_ANIME = 200;

function getCommentsDir() {
  const dataDir = process.env.ANIFLIX_DATA_DIR || path.join(process.cwd(), 'data');
  const dir = path.join(dataDir, 'comments');
  if (!fs.existsSync(dir)) {
    try { fs.mkdirSync(dir, { recursive: true }); } catch {}
  }
  return dir;
}

function filePathFor(animeId) {
  const id = String(animeId).replace(/[^0-9a-zA-Z_-]/g, '').slice(0, 32);
  if (!id) return null;
  return path.join(getCommentsDir(), `${id}.json`);
}

function readAll(file) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeAtomic(file, list) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(list), 'utf8');
  fs.renameSync(tmp, file);
}

export function listComments(animeId) {
  const file = filePathFor(animeId);
  if (!file) return [];
  return readAll(file).sort((a, b) => b.createdAt - a.createdAt);
}

export function addComment(animeId, { author, text }) {
  const file = filePathFor(animeId);
  if (!file) throw new Error('Invalid anime id');
  const clean = typeof text === 'string' ? text.trim().slice(0, MAX_TEXT) : '';
  if (!clean) throw new Error('Comment is empty');
  const name = (typeof author === 'string' ? author.trim() : '').replace(/[<>]/g, '').slice(0, 32) || 'Guest';

  const list = readAll(file);
  const comment = { id: crypto.randomUUID(), author: name, text: clean, createdAt: Date.now() };
  list.push(comment);
  writeAtomic(file, list.slice(-MAX_PER_ANIME));
  return comment;
}

export function deleteComment(animeId, commentId, author) {
  const file = filePathFor(animeId);
  if (!file) return false;
  const list = readAll(file);
  const target = list.find(c => c.id === commentId);
  if (!target || target.author !== author) return false;
  writeAtomic(file, list.filter(c => c.id !== commentId));
  return true;
}
