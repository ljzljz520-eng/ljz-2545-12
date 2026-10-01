// 离线缓存：带 TTL 的快照。过期不静默当作新数据，由 UI 明确标注“缓存已过期”。
// localStorage 不可用（隐私模式/SSR）时降级为内存缓存。

export class OfflineCache {
  constructor({ namespace = 'manxing.hazards', storage } = {}) {
    this.ns = namespace;
    this.memory = new Map();
    this.storage = storage ?? detectStorage();
  }

  save(key, data, { ttlMs, savedAt = Date.now() }) {
    const entry = { data, savedAt, ttlMs };
    try {
      this.storage.setItem(this.k(key), JSON.stringify(entry));
    } catch {
      this.memory.set(key, entry);
    }
    return entry;
  }

  load(key, now = Date.now()) {
    let entry = null;
    try {
      const raw = this.storage.getItem(this.k(key));
      entry = raw ? JSON.parse(raw) : null;
    } catch {
      entry = this.memory.get(key) ?? null;
    }
    if (!entry) return { status: 'missing', data: null, savedAt: null, ageMs: null };
    const ageMs = now - entry.savedAt;
    if (entry.ttlMs != null && ageMs > entry.ttlMs) {
      return { status: 'expired', data: entry.data, savedAt: entry.savedAt, ageMs };
    }
    return { status: 'fresh', data: entry.data, savedAt: entry.savedAt, ageMs };
  }

  clear(key) {
    try { this.storage.removeItem(this.k(key)); } catch { /* noop */ }
    this.memory.delete(key);
  }

  k(key) { return `${this.ns}.${key}`; }
}

export function detectStorage() {
  try {
    const s = globalThis.localStorage;
    const probe = '__probe__';
    s.setItem(probe, '1'); s.removeItem(probe);
    return s;
  } catch {
    return memoryStorage();
  }
}

export function memoryStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
  };
}
