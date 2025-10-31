/** API helpers with caching via storage */
import { storage } from './storage.js';

const TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function now() { return Date.now(); }

function coverFrom(isbn) {
  if (!isbn) return '';
  // Use Open Library with better fallback handling
  return `https://covers.openlibrary.org/b/isbn/${isbn}-L.jpg`;
}

// Alternative cover sources for fallback
function getAlternateCoverSources(isbn) {
  if (!isbn) return [];
  return [
    `https://covers.openlibrary.org/b/isbn/${isbn}-L.jpg`,
    `https://covers.openlibrary.org/b/isbn/${isbn}-M.jpg`,
    // Try ISBN-10 format as well (some books only have ISBN-10 covers)
    ...(isbn.length === 13 ? [`https://covers.openlibrary.org/b/isbn/${convertISBN13to10(isbn)}-L.jpg`] : []),
  ];
}

// Convert ISBN-13 to ISBN-10 (some books only have ISBN-10 covers)
function convertISBN13to10(isbn13) {
  if (!isbn13 || isbn13.length !== 13) return isbn13;

  // Remove the 978 prefix
  let isbn10 = isbn13.substring(3, 12);

  // Calculate check digit
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    sum += parseInt(isbn10[i]) * (10 - i);
  }
  let checkDigit = (11 - (sum % 11)) % 11;
  isbn10 += checkDigit === 10 ? 'X' : checkDigit.toString();

  return isbn10;
}

async function cacheGet(key) {
  return storage.cacheGet(key);
}
async function cacheSet(key, value) {
  return storage.cacheSet(key, value, TTL_MS);
}

function normalizeBookFromIsbnJson(isbn, data, authorName) {
  const coverUrl = coverFrom(isbn);

  // Extract series information
  let series = null;
  let seriesNumber = null;

  if (data?.series && data.series.length > 0) {
    series = data.series[0];
  }

  // Try to extract series from subtitle or title
  if (!series && data?.subtitle) {
    const seriesMatch = data.subtitle.match(/\((.+?)\s*(?:#|Book|Vol\.?)\s*(\d+)\)/i);
    if (seriesMatch) {
      series = seriesMatch[1].trim();
      seriesNumber = parseInt(seriesMatch[2]);
    }
  }

  // Extract genre/subjects
  let genre = null;
  if (data?.subjects && data.subjects.length > 0) {
    // Get first subject as primary genre
    genre = data.subjects[0];
  }

  console.log('[API] Normalized book from ISBN:', isbn);
  console.log('[API] Cover URL generated:', coverUrl);
  console.log('[API] Book data:', { title: data?.title, author: authorName, series, seriesNumber, genre });

  return {
    id: isbn,
    title: data?.title || 'Untitled',
    author: authorName || (data?.authors?.[0]?.name || ''),
    isbn,
    coverUrl: coverUrl,
    series: series,
    seriesNumber: seriesNumber,
    genre: genre
  };
}

async function fetchAuthorName(key) {
  try {
    const r = await fetch(`https://openlibrary.org${key}.json`);
    if (!r.ok) return '';
    const j = await r.json();
    return j.name || '';
  } catch (_) { return ''; }
}

/**
 * Find book by ISBN using Open Library
 */
export async function findBookByISBN(isbn) {
  const cKey = `isbn:${isbn}`;
  const cached = await cacheGet(cKey);
  if (cached && (now() - cached.ts) < TTL_MS) return cached.value;
  const r = await fetch(`https://openlibrary.org/isbn/${isbn}.json`);
  if (!r.ok) throw new Error('ISBN not found');
  const data = await r.json();
  let authorName = '';
  if (data?.authors?.[0]?.key) {
    authorName = await fetchAuthorName(data.authors[0].key);
  }
  const book = normalizeBookFromIsbnJson(isbn, data, authorName);
  await cacheSet(cKey, book);
  return book;
}

/** Search by text via Open Library */
export async function searchBookByText(title = '', author = '') {
  const q = encodeURIComponent([title, author].filter(Boolean).join(' '));
  const cKey = `search:${q}`;
  const cached = await cacheGet(cKey);
  if (cached && (now() - cached.ts) < TTL_MS) return cached.value;
  const r = await fetch(`https://openlibrary.org/search.json?q=${q}&limit=10`);
  if (!r.ok) throw new Error('Search failed');
  const j = await r.json();
  const out = (j.docs || []).slice(0, 10).map(d => ({
    id: d.isbn?.[0] || d.key,
    title: d.title,
    author: (d.author_name && d.author_name[0]) || '',
    isbn: d.isbn?.[0] || '',
    coverUrl: coverFrom(d.isbn?.[0])
  }));
  await cacheSet(cKey, out);
  return out;
}

/** Update a book's cover URL to use the new source */
export function updateBookCover(book) {
  if (book.isbn || book.id) {
    const isbn = book.isbn || book.id;
    return {
      ...book,
      coverUrl: coverFrom(isbn)
    };
  }
  return book;
}

/** Get all alternative cover sources for an ISBN */
export function getCoverAlternatives(isbn) {
  return getAlternateCoverSources(isbn);
}
