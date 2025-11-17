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

  const title = data?.title || '';

  // Special handling for popular series - check FIRST to override Open Library data
  // Empyrean series (Fourth Wing, Iron Flame, Onyx Storm)
  if (title.toLowerCase().includes('fourth wing') ||
      title.toLowerCase().includes('iron flame') ||
      title.toLowerCase().includes('onyx storm')) {
    series = 'The Empyrean';
    if (/fourth wing/i.test(title)) seriesNumber = 1;
    else if (/iron flame/i.test(title)) seriesNumber = 2;
    else if (/onyx storm/i.test(title)) seriesNumber = 3;
  }

  // Harry Potter
  else if (title.toLowerCase().includes('harry potter')) {
    series = 'Harry Potter';
    const hpPatterns = [
      /philosopher'?s stone/i,
      /sorcerer'?s stone/i,
      /chamber of secrets/i,
      /prisoner of azkaban/i,
      /goblet of fire/i,
      /order of the phoenix/i,
      /half-blood prince/i,
      /deathly hallows/i
    ];
    for (let i = 0; i < hpPatterns.length; i++) {
      if (hpPatterns[i].test(title)) {
        seriesNumber = i === 0 ? 1 : (i === 1 ? 1 : i);
        break;
      }
    }
  }

  // A Court of Thorns and Roses
  else if (title.toLowerCase().includes('court of')) {
    series = 'A Court of Thorns and Roses';
    if (/court of thorns and roses/i.test(title) && !/mist and fury|wings and ruin|frost and starlight|silver flames/i.test(title)) seriesNumber = 1;
    else if (/mist and fury/i.test(title)) seriesNumber = 2;
    else if (/wings and ruin/i.test(title)) seriesNumber = 3;
    else if (/frost and starlight/i.test(title)) seriesNumber = 4;
    else if (/silver flames/i.test(title)) seriesNumber = 5;
  }

  // The Crowns of Nyaxia series (Carissa Broadbent)
  else if (title.toLowerCase().includes('serpent and the wings') ||
           title.toLowerCase().includes('ashes and the star') ||
           title.toLowerCase().includes('crowns of nyaxia')) {
    series = 'The Crowns of Nyaxia';
    if (/serpent and the wings/i.test(title)) seriesNumber = 1;
    else if (/ashes and the star/i.test(title)) seriesNumber = 2;
  }

  // Harry Potter series (J.K. Rowling)
  else if (title.toLowerCase().includes('harry potter')) {
    series = 'Harry Potter';
    if (/philosopher'?s stone|sorcerer'?s stone/i.test(title)) seriesNumber = 1;
    else if (/chamber of secrets/i.test(title)) seriesNumber = 2;
    else if (/prisoner of azkaban/i.test(title)) seriesNumber = 3;
    else if (/goblet of fire/i.test(title)) seriesNumber = 4;
    else if (/order of the phoenix/i.test(title)) seriesNumber = 5;
    else if (/half-blood prince/i.test(title)) seriesNumber = 6;
    else if (/deathly hallows/i.test(title)) seriesNumber = 7;
  }

  // It Ends with Us series (Colleen Hoover)
  else if (title.toLowerCase().includes('it ends with us') ||
           title.toLowerCase().includes('it starts with us')) {
    series = 'It Ends with Us';
    if (/it ends with us/i.test(title)) seriesNumber = 1;
    else if (/it starts with us/i.test(title)) seriesNumber = 2;
  }

  // Fallback to Open Library series data if no hardcoded match
  if (!series && data?.series && data.series.length > 0) {
    // Extract series name and number from formats like "Harry Potter, #2" or "Series Name"
    const seriesStr = data.series[0];
    const seriesMatch = seriesStr.match(/^(.+?),?\s*#(\d+)$/);
    if (seriesMatch) {
      series = seriesMatch[1].trim();
      if (!seriesNumber) seriesNumber = parseInt(seriesMatch[2]);
    } else {
      series = seriesStr;
    }
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
  console.log('[API] Raw data:', data);
  console.log('[API] Author name fetched:', authorName);
  console.log('[API] Cover URL generated:', coverUrl);
  console.log('[API] Book data:', { title: data?.title, author: authorName, series, seriesNumber, genre });

  let finalAuthor = authorName || (data?.authors?.[0]?.name || '');

  // Hardcode authors for known series where Open Library might fail
  if (!finalAuthor || finalAuthor === 'TBD') {
    if (series === 'The Empyrean') {
      finalAuthor = 'Rebecca Yarros';
    } else if (series === 'Harry Potter') {
      finalAuthor = 'J.K. Rowling';
    } else if (series === 'The Crowns of Nyaxia') {
      finalAuthor = 'Carissa Broadbent';
    } else if (series === 'A Court of Thorns and Roses') {
      finalAuthor = 'Sarah J. Maas';
    } else if (series === 'It Ends with Us') {
      finalAuthor = 'Colleen Hoover';
    }
  }

  return {
    id: isbn,
    title: data?.title || 'Untitled',
    author: finalAuthor,
    isbn,
    coverUrl: coverUrl,
    series: series,
    seriesNumber: seriesNumber,
    genre: genre
  };
}

async function fetchAuthorName(key) {
  try {
    console.log('[API] Fetching author from:', key);
    const r = await fetch(`https://openlibrary.org${key}.json`);
    if (!r.ok) {
      console.warn('[API] Author fetch failed with status:', r.status);
      return '';
    }
    const j = await r.json();
    console.log('[API] Author data:', j);
    return j.name || '';
  } catch (e) {
    console.error('[API] Author fetch error:', e);
    return '';
  }
}

/**
 * Find book by ISBN using Open Library
 */
export async function findBookByISBN(isbn) {
  // Normalize ISBN by removing hyphens and spaces
  const normalizedIsbn = isbn.replace(/[-\s]/g, '');

  const CACHE_VERSION = 'v6'; // Increment this to invalidate old cached data
  const cKey = `isbn:${normalizedIsbn}:${CACHE_VERSION}`;
  const cached = await cacheGet(cKey);
  if (cached && (now() - cached.ts) < TTL_MS) {
    console.log('[API] Using cached book data for:', normalizedIsbn);
    return cached.value;
  }
  console.log('[API] Fetching fresh book data for:', normalizedIsbn);
  const r = await fetch(`https://openlibrary.org/isbn/${normalizedIsbn}.json`);
  if (!r.ok) throw new Error('ISBN not found');
  const data = await r.json();
  let authorName = '';
  if (data?.authors?.[0]?.key) {
    authorName = await fetchAuthorName(data.authors[0].key);
  }
  const book = normalizeBookFromIsbnJson(normalizedIsbn, data, authorName);
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

/** Detect and extract series info from a book title (for migration/fixing existing books) */
export function detectSeriesFromTitle(title) {
  const titleLower = (title || '').toLowerCase();

  // Harry Potter detection
  if (titleLower.includes('harry potter')) {
    const hpPatterns = [
      { pattern: /philosopher'?s stone/i, number: 1 },
      { pattern: /sorcerer'?s stone/i, number: 1 },
      { pattern: /chamber of secrets/i, number: 2 },
      { pattern: /prisoner of azkaban/i, number: 3 },
      { pattern: /goblet of fire/i, number: 4 },
      { pattern: /order of the phoenix/i, number: 5 },
      { pattern: /half-blood prince/i, number: 6 },
      { pattern: /deathly hallows/i, number: 7 }
    ];

    for (const { pattern, number } of hpPatterns) {
      if (pattern.test(title)) {
        return { series: 'Harry Potter', seriesNumber: number };
      }
    }

    return { series: 'Harry Potter', seriesNumber: null };
  }

  // Empyrean series
  if (titleLower.includes('fourth wing') || titleLower.includes('iron flame') || titleLower.includes('onyx storm')) {
    let seriesNumber = null;
    if (/fourth wing/i.test(title)) seriesNumber = 1;
    else if (/iron flame/i.test(title)) seriesNumber = 2;
    else if (/onyx storm/i.test(title)) seriesNumber = 3;
    return { series: 'The Empyrean', seriesNumber };
  }

  // A Court of Thorns and Roses
  if (titleLower.includes('court of')) {
    let seriesNumber = null;
    if (/court of thorns and roses/i.test(title) && !/mist and fury|wings and ruin|frost and starlight|silver flames/i.test(title)) seriesNumber = 1;
    else if (/mist and fury/i.test(title)) seriesNumber = 2;
    else if (/wings and ruin/i.test(title)) seriesNumber = 3;
    else if (/frost and starlight/i.test(title)) seriesNumber = 4;
    else if (/silver flames/i.test(title)) seriesNumber = 5;
    return { series: 'A Court of Thorns and Roses', seriesNumber };
  }

  // The Crowns of Nyaxia series
  if (titleLower.includes('serpent and the wings') ||
      titleLower.includes('ashes and the star') ||
      titleLower.includes('crowns of nyaxia')) {
    let seriesNumber = null;
    if (/serpent and the wings/i.test(title)) seriesNumber = 1;
    else if (/ashes and the star/i.test(title)) seriesNumber = 2;
    return { series: 'The Crowns of Nyaxia', seriesNumber };
  }

  // It Ends with Us series
  if (titleLower.includes('it ends with us') || titleLower.includes('it starts with us')) {
    let seriesNumber = null;
    if (/it ends with us/i.test(title)) seriesNumber = 1;
    else if (/it starts with us/i.test(title)) seriesNumber = 2;
    return { series: 'It Ends with Us', seriesNumber };
  }

  return { series: null, seriesNumber: null };
}

/** Normalize series name for sorting/grouping */
export function normalizeSeriesName(name) {
  if (!name) return '';
  let s = String(name).toLowerCase();
  s = s.replace(/\(\s*series\s*\)/g, ''); // Remove "(series)"
  s = s.replace(/^(the|a|an)\s+/, ''); // Remove articles
  s = s.replace(/[#:]|\(|\)|\[|\]|\{|\}|\./g, ' '); // Remove punctuation
  s = s.replace(/\b(book|bk|vol|volume)\s*\d+[\w\.-]*\b/g, ''); // Remove volume indicators
  s = s.replace(/\s{2,}/g, ' ').trim();
  return s;
}

/** Title case a string (for series names) */
export function titleCaseName(str) {
  if (!str) return '';
  const smallWords = /^(a|an|and|as|at|but|by|en|for|if|in|nor|of|on|or|per|the|to|v.?|vs.?|via)$/i;
  return str.toLowerCase().split(' ').map((word, index, array) => {
    if (index !== 0 && index !== array.length - 1 && smallWords.test(word)) {
      return word;
    }
    return word.charAt(0).toUpperCase() + word.slice(1);
  }).join(' ');
}

/** Check if a series string is actually just an edition/format label */
export function isEditionSeries(name) {
  if (!name) return false;
  const s = String(name).toLowerCase();
  const keywords = [
    'paperback', 'hardcover', 'mass market', 'special edition', 'collector',
    'signed', 'edges', 'painted edges', 'illustrated', 'box set', 'anniversary',
    'penguin classics', 'vintage international', 'oxford world\'s classics',
    'modern library', 'barnes & noble classics', 'folio society'
  ];
  return keywords.some(k => s.includes(k));
}

/** Extract volume number from title */
export function extractVolumeNumber(title) {
  if (!title) return null;

  // Try "(Series, 1)" pattern
  const seriesPattern = /\(([^,]+),\s*(\d+(?:\.\d+)?)\)/;
  const seriesMatch = title.match(seriesPattern);
  if (seriesMatch) return parseFloat(seriesMatch[2]);

  // Try "Book 1", "Vol 2", "Volume 3" patterns
  const bookPattern = /\b(?:book|vol\.?|volume)\s+(\d+(?:\.\d+)?)\b/i;
  const bookMatch = title.match(bookPattern);
  if (bookMatch) return parseFloat(bookMatch[1]);

  // Try "#1" pattern
  const hashPattern = /#(\d+(?:\.\d+)?)\b/;
  const hashMatch = title.match(hashPattern);
  if (hashMatch) return parseFloat(hashMatch[1]);

  // Try Roman numerals
  const romanPattern = /\b(?:book|vol\.?|volume)\s+(I{1,3}|IV|V|VI{0,3}|IX|X)\b/i;
  const romanMatch = title.match(romanPattern);
  if (romanMatch) {
    const romanNumerals = { 'I': 1, 'II': 2, 'III': 3, 'IV': 4, 'V': 5, 'VI': 6, 'VII': 7, 'VIII': 8, 'IX': 9, 'X': 10 };
    return romanNumerals[romanMatch[1].toUpperCase()] || null;
  }

  return null;
}

/** Get primary series from an array of series strings */
export function primarySeries(seriesArray) {
  if (!Array.isArray(seriesArray) || seriesArray.length === 0) return '';
  // Filter out edition labels and return the first valid series
  const validSeries = seriesArray.filter(s => s && !isEditionSeries(s));
  return validSeries[0] || '';
}

/** Search Google Books API for book metadata */
export async function searchGoogleBooks(query) {
  try {
    const q = encodeURIComponent(query || '');
    const response = await fetch(`https://www.googleapis.com/books/v1/volumes?q=${q}&maxResults=8`);
    if (!response.ok) throw new Error('Google Books search failed');

    const data = await response.json();
    const items = Array.isArray(data.items) ? data.items : [];

    return items.map(item => {
      const volumeInfo = item?.volumeInfo || {};
      const title = volumeInfo.title || '';
      const seriesDetected = detectSeriesFromTitle(title);

      return {
        id: item.id,
        title: title,
        authors: Array.isArray(volumeInfo.authors) ? volumeInfo.authors : [],
        image: (volumeInfo.imageLinks?.thumbnail || volumeInfo.imageLinks?.smallThumbnail || '').replace('http://', 'https://'),
        seriesGuess: seriesDetected.series,
        seriesNumberGuess: seriesDetected.seriesNumber
      };
    });
  } catch (error) {
    console.error('[API] Google Books search error:', error);
    return [];
  }
}
