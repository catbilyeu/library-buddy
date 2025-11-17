/** storage and cache helpers using Firebase Firestore */

import { getCurrentUser, addBook as firebaseAddBook, getBooks as firebaseGetBooks, removeBook as firebaseRemoveBook, getBook as firebaseGetBook, updateBook as firebaseUpdateBook } from './firebase.js';

const memCache = new Map();

// Get current user ID, throw error if not logged in
function getUserId() {
  const user = getCurrentUser();
  if (!user) {
    throw new Error('User not authenticated. Please log in to access your library.');
  }
  return user.uid;
}

export const storage = {
  async addBook(book) {
    try {
      const userId = getUserId();
      await firebaseAddBook(userId, book);
      events.emit('books:changed');
    } catch (error) {
      console.error('[Storage] Error adding book:', error);
      throw error;
    }
  },
  async getBooks() {
    try {
      const userId = getUserId();
      return await firebaseGetBooks(userId);
    } catch (error) {
      console.error('[Storage] Error fetching books:', error);
      // Return empty array if not logged in
      return [];
    }
  },
  async getBook(id) {
    try {
      const userId = getUserId();
      return await firebaseGetBook(userId, id);
    } catch (error) {
      console.error('[Storage] Error fetching book:', error);
      return null;
    }
  },
  async updateBook(id, updates) {
    try {
      const userId = getUserId();
      await firebaseUpdateBook(userId, id, updates);
      events.emit('books:changed');
    } catch (error) {
      console.error('[Storage] Error updating book:', error);
      throw error;
    }
  },
  async removeBook(id) {
    try {
      console.log('[Storage] removeBook called with id:', id);
      const userId = getUserId();
      await firebaseRemoveBook(userId, id);
      console.log('[Storage] Book deleted from database');
      events.emit('books:changed');
      console.log('[Storage] books:changed event emitted');
    } catch (error) {
      console.error('[Storage] Error removing book:', error);
      throw error;
    }
  },
  async clear() {
    try {
      const userId = getUserId();
      const books = await firebaseGetBooks(userId);
      // Delete all books one by one
      for (const book of books) {
        await firebaseRemoveBook(userId, book.id || book.isbn);
      }
      events.emit('books:changed');
    } catch (error) {
      console.error('[Storage] Error clearing books:', error);
      throw error;
    }
  },
  async cacheSet(key, value, ttl) {
    // Keep in-memory cache for API responses
    memCache.set(key, { value, ts: Date.now(), ttl });
  },
  async cacheGet(key) {
    if (memCache.has(key)) {
      const cached = memCache.get(key);
      // Check if cache is still valid
      if (!cached.ttl || (Date.now() - cached.ts) < cached.ttl) {
        return cached;
      }
      memCache.delete(key);
    }
    return null;
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
