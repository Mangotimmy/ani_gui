// server/services/cache.js - High-performance bounded LRU cache with TTL auto-eviction
// Prevents Node.js V8 heap memory leaks by capping maximum cache size and expiring stale items.

export class BoundedCache {
  /**
   * @param {number} maxSize - Maximum number of items in cache (default 300)
   * @param {number} defaultTtlMs - Default time-to-live in ms (default 1 hour)
   */
  constructor(maxSize = 300, defaultTtlMs = 60 * 60 * 1000) {
    this.maxSize = maxSize;
    this.defaultTtlMs = defaultTtlMs;
    this.cache = new Map();
  }

  get(key) {
    const entry = this.cache.get(key);
    if (!entry) return undefined;

    if (Date.now() > entry.expiry) {
      this.cache.delete(key);
      return undefined;
    }

    // Refresh LRU order (delete & re-insert)
    this.cache.delete(key);
    this.cache.set(key, entry);
    return entry.value;
  }

  set(key, value, customTtlMs) {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.maxSize) {
      // Evict oldest item (first key in Map)
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey !== undefined) {
        this.cache.delete(oldestKey);
      }
    }

    const expiry = Date.now() + (customTtlMs || this.defaultTtlMs);
    this.cache.set(key, { value, expiry });
    return this;
  }

  has(key) {
    return this.get(key) !== undefined;
  }

  delete(key) {
    return this.cache.delete(key);
  }

  clear() {
    this.cache.clear();
  }

  get size() {
    return this.cache.size;
  }

  *entries() {
    const now = Date.now();
    for (const [key, entry] of this.cache.entries()) {
      if (now <= entry.expiry) {
        yield [key, entry.value];
      }
    }
  }

  *keys() {
    const now = Date.now();
    for (const [key, entry] of this.cache.entries()) {
      if (now <= entry.expiry) {
        yield key;
      }
    }
  }

  *values() {
    const now = Date.now();
    for (const entry of this.cache.values()) {
      if (now <= entry.expiry) {
        yield entry.value;
      }
    }
  }

  [Symbol.iterator]() {
    return this.entries();
  }
}
