/** storage and cache helpers using IndexedDB via idb */

let idbMod = null;
const memCache = new Map();

async function getIdb() {
  if (!idbMod) {
    idbMod = await import('https://cdn.jsdelivr.net/npm/idb@7/build/index.min.js');
  }
  return idbMod;
}

async function getDB() {
  const { openDB } = await getIdb();
  return openDB('homeLibrary', 1, {
    upgrade(db) {
      if (!db.objectStoreNames.contains('books')) {
        db.createObjectStore('books', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('apiCache')) {
        db.createObjectStore('apiCache', { keyPath: 'key' });
      }
    }
  });
}

export const storage = {
  async addBook(book) {
    const db = await getDB();
    await db.put('books', book);
    events.emit('books:changed');
  },
  async getBooks() {
    const db = await getDB();
    return db.getAll('books');
  },
  async getBook(id) {
    const db = await getDB();
    return db.get('books', id);
  },
  async removeBook(id) {
    console.log('[Storage] removeBook called with id:', id);
    const db = await getDB();
    console.log('[Storage] Database connection established');
    await db.delete('books', id);
    console.log('[Storage] Book deleted from database');
    events.emit('books:changed');
    console.log('[Storage] books:changed event emitted');
  },
  async clear() {
    const db = await getDB();
    await db.clear('books');
    events.emit('books:changed');
  },
  async cacheSet(key, value, ttl) {
    memCache.set(key, { value, ts: Date.now(), ttl });
    const db = await getDB();
    await db.put('apiCache', { key, value, ts: Date.now(), ttl });
  },
  async cacheGet(key) {
    if (memCache.has(key)) return memCache.get(key);
    const db = await getDB();
    return db.get('apiCache', key);
  }
};

// Simple PubSub for UI updates
export const events = (() => {
  const map = new Map();
  return {
    on(evt, fn) { const fns = map.get(evt) || []; fns.push(fn); map.set(evt, fns); },
    off(evt, fn) { const fns = map.get(evt) || []; map.set(evt, fns.filter(x => x !== fn)); },
    emit(evt, payload) { const fns = map.get(evt) || []; fns.forEach(fn => { try { fn(payload); } catch (_) {} }); }
  };
})();
