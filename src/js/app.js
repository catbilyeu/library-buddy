// App entry: orchestrates UI, camera, scanner, hands, storage, api
// Note: heavy libs (Quagga, Tesseract, MediaPipe, idb) loaded dynamically in respective modules

import { initCamera, stopCamera, getFrameImageData, getVideoEl } from './camera.js';
import { initBarcodeScanner, stopBarcodeScanner, onIsbnDetected, ocrFromFrame } from './scanner.js';
import { initHands, onCursorMove, onGrab, onOpenHand, onWave, destroyHands, setBrowseMode } from './hand.js';
import { renderBook, openBookModal, closeBookModal, initUI, hydrateBooks, highlightAtCursor, getCurrentBookId, setSortMode, getSortMode } from './ui.js';
import { findBookByISBN, searchBookByText, updateBookCover, detectSeriesFromTitle } from './api.js';
import { storage, events } from './storage.js';

const qs = (sel, root = document) => root.querySelector(sel);

async function registerSW() {
  if ('serviceWorker' in navigator) {
    try {
      await navigator.serviceWorker.register('../sw.js');
      console.info('[SW] Registered');
    } catch (e) {
      console.warn('[SW] Registration failed', e);
    }
  }
}

function setupControls() {
  const startBtn = document.querySelector('[data-action="start-scan"]');
  const browseBtn = document.querySelector('[data-action="browse-shelf"]');
  const stopBtn = document.querySelector('[data-action="stop"]');
  const modal = document.getElementById('book-modal');
  const closeModalBtn = document.getElementById('close-modal');
  const deleteBtn = document.getElementById('delete-book');
  const sortFilter = document.getElementById('sort-filter');

  startBtn?.addEventListener('click', startScanMode);
  browseBtn?.addEventListener('click', startBrowseMode);
  stopBtn?.addEventListener('click', stopAll);
  closeModalBtn?.addEventListener('click', () => modal.close());
  deleteBtn?.addEventListener('click', handleDeleteBook);

  // Load saved sort preference
  const savedSort = localStorage.getItem('librarySortMode') || 'series';
  setSortMode(savedSort);
  if (sortFilter) sortFilter.value = savedSort;

  // Handle sort change
  sortFilter?.addEventListener('change', async (e) => {
    const newMode = e.target.value;
    console.log('[App] Changing sort mode to:', newMode);
    setSortMode(newMode);
    const books = await storage.getBooks();
    hydrateBooks(books);
  });
}

async function handleDeleteBook() {
  const bookId = getCurrentBookId();
  console.log('[App] Delete button clicked, bookId:', bookId);

  if (!bookId) {
    console.error('[App] No book ID found');
    alert('Cannot delete: book ID is missing');
    return;
  }

  // Confirm deletion
  const confirmed = confirm('Are you sure you want to remove this book from your shelf?');
  console.log('[App] Deletion confirmed:', confirmed);

  if (!confirmed) return;

  try {
    console.log('[App] Calling storage.removeBook for:', bookId);
    await storage.removeBook(bookId);
    console.log('[App] Book removed successfully:', bookId);
    closeBookModal();
  } catch (error) {
    console.error('[App] Failed to remove book:', error);
    alert('Failed to remove book. Please try again.');
  }
}

async function startScanMode() {
  const overlay = document.querySelector('[data-test-id="webcam-overlay"]');
  overlay?.classList.remove('hidden');
  overlay?.setAttribute('aria-hidden', 'false');

  await initCamera();
  await initBarcodeScanner(getVideoEl());
  setBrowseMode(false);
  // Don't need hands in scan mode
}

async function startBrowseMode() {
  // Hide webcam overlay, show cursor
  const overlay = document.querySelector('[data-test-id="webcam-overlay"]');
  overlay?.classList.add('hidden');
  overlay?.setAttribute('aria-hidden', 'true');

  // Show cursor
  const cursor = document.getElementById('magic-cursor');
  cursor.style.display = 'block';

  await initCamera();
  await initHands(getVideoEl());
  setBrowseMode(true);
}

async function stopAll() {
  const overlay = document.querySelector('[data-test-id="webcam-overlay"]');
  overlay?.classList.add('hidden');
  overlay?.setAttribute('aria-hidden', 'true');

  // Hide cursor
  const cursor = document.getElementById('magic-cursor');
  cursor.style.display = 'none';

  stopBarcodeScanner();
  await stopCamera();
  destroyHands();
  setBrowseMode(false);
}

function setupEvents() {
  // ISBN detected
  onIsbnDetected(async (isbn) => {
    console.log('[Scan] ISBN detected', isbn);
    try {
      const book = await findBookByISBN(isbn);
      if (book) {
        // Generate and save spine color
        if (!book.spineColor) {
          const getBookColor = (bookId, title) => {
            const seed = bookId || title || 'default';
            let hash = 0;
            for (let i = 0; i < seed.length; i++) {
              hash = ((hash << 5) - hash) + seed.charCodeAt(i);
              hash = hash & hash;
            }
            const colors = [
              '#8B4513', '#A0522D', '#D2691E',
              '#2F4F4F', '#556B2F', '#4B5320',
              '#800020', '#8B0000', '#A52A2A',
              '#1C3A4A', '#2C4F68', '#1E3A5F',
              '#3B2F2F', '#4A4A4A', '#2B2B2B',
              '#6B4423', '#8B6914', '#9B7653',
            ];
            const index = Math.abs(hash) % colors.length;
            return colors[index];
          };
          book.spineColor = getBookColor(book.id || book.isbn, book.title);
        }
        await storage.addBook(book);
        renderBook(book);
      }
    } catch (e) {
      console.warn('Failed to fetch book by ISBN', e);
    }
  });

  // Cursor move from hands
  onCursorMove(({ x, y }) => {
    const cursor = document.getElementById('magic-cursor');
    cursor.style.left = `${x}px`;
    cursor.style.top = `${y}px`;
    highlightAtCursor({ x, y });
  });

  // Grab to open modal
  onGrab(() => {
    const highlighted = document.querySelector('.book-tile.highlight');
    if (highlighted) {
      const id = highlighted.getAttribute('data-id');
      const title = highlighted.getAttribute('data-title');
      const author = highlighted.getAttribute('data-author');
      const cover = highlighted.getAttribute('data-cover');
      const color = highlighted.getAttribute('data-color');
      openBookModal({ id, title, author, cover, color });
    }
  });

  // Wave to close modal
  onWave(() => {
    const modal = document.getElementById('book-modal');
    if (modal && modal.open) {
      console.log('[App] Wave detected, closing modal');
      closeBookModal();
    }
  });

  events.on('books:changed', async () => {
    console.log('[App] books:changed event received');
    const books = await storage.getBooks();
    console.log('[App] Rehydrating books, count:', books.length);
    hydrateBooks(books);
  });
}

async function migrateExistingBooks() {
  console.log('[App] Running book migration to detect series...');
  const books = await storage.getBooks();
  console.log('[App] Found', books.length, 'books to check');
  let updated = 0;

  for (const book of books) {
    console.log('[App] Checking book:', book.title, 'existing series:', book.series, 'seriesNumber:', book.seriesNumber);

    // Always check for series info
    const seriesInfo = detectSeriesFromTitle(book.title);
    console.log('[App] Detection result:', seriesInfo);

    // Update if series detected and either no series exists OR series number is different
    if (seriesInfo.series && (seriesInfo.series !== book.series || seriesInfo.seriesNumber !== book.seriesNumber)) {
      console.log('[App] Updating series for:', book.title, 'from', book.series, book.seriesNumber, 'to', seriesInfo.series, seriesInfo.seriesNumber);
      book.series = seriesInfo.series;
      book.seriesNumber = seriesInfo.seriesNumber;
      await storage.addBook(book);
      updated++;
    }
  }

  console.log('[App] Migration complete, updated', updated, 'books');
  if (updated > 0) {
    return true;
  }
  return false;
}

// Expose migration function globally for manual triggering
window.migrateSeries = async function() {
  console.log('[App] Manual migration triggered');
  await migrateExistingBooks();
  const books = await storage.getBooks();
  hydrateBooks(books);
  console.log('[App] Migration complete, books re-rendered');
};

async function boot() {
  await registerSW();
  initUI();
  setupControls();
  setupEvents();

  // Run migration to fix existing books without series info
  const migrated = await migrateExistingBooks();

  const books = await storage.getBooks();
  hydrateBooks(books);
}

boot();
