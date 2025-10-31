// App entry: orchestrates UI, camera, scanner, hands, storage, api
// Note: heavy libs (Quagga, Tesseract, MediaPipe, idb) loaded dynamically in respective modules

import { initCamera, stopCamera, getFrameImageData, getVideoEl } from './camera.js';
import { initBarcodeScanner, stopBarcodeScanner, onIsbnDetected, ocrFromFrame } from './scanner.js';
import { initHands, onCursorMove, onGrab, onOpenHand, onWave, destroyHands, setBrowseMode } from './hand.js';
import { renderBook, openBookModal, closeBookModal, initUI, hydrateBooks, highlightAtCursor, getCurrentBookId, setSortMode, getSortMode } from './ui.js';
import { findBookByISBN, searchBookByText, updateBookCover, detectSeriesFromTitle } from './api.js';
import { storage, events } from './storage.js';

const qs = (sel, root = document) => root.querySelector(sel);

let motionCursorEnabled = true;
let motionCursorInitialized = false;

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
  const toggleMotionBtn = document.querySelector('[data-action="toggle-motion"]');
  const exportBtn = document.querySelector('[data-action="export"]');
  const importBtn = document.querySelector('[data-action="import"]');
  const importInput = document.getElementById('import-file');
  // Initialize toggle button label based on saved preference
  const isEnabled = localStorage.getItem('motionCursor') === 'on';
  if (toggleMotionBtn) toggleMotionBtn.textContent = isEnabled ? 'Disable Motion Cursor' : 'Enable Motion Cursor';
  const modal = document.getElementById('book-modal');
  const closeModalBtn = document.getElementById('close-modal');
  const deleteBtn = document.getElementById('delete-book');
  const sortFilter = document.getElementById('sort-filter');
  const themeFilter = document.getElementById('theme-filter');

  startBtn?.addEventListener('click', startScanMode);
  browseBtn?.addEventListener('click', startBrowseMode);
  stopBtn?.addEventListener('click', stopAll);
  toggleMotionBtn?.addEventListener('click', toggleMotionCursor);
  closeModalBtn?.addEventListener('click', () => modal.close());
  deleteBtn?.addEventListener('click', handleDeleteBook);

  // Export / Import handlers (if buttons exist)
  if (exportBtn) exportBtn.addEventListener('click', handleExport);
  if (importBtn) importBtn.addEventListener('click', () => importInput?.click());
  if (importInput) importInput.addEventListener('change', handleImportFile);

  // Load saved sort preference
  const savedSort = localStorage.getItem('librarySortMode') || 'series';
  setSortMode(savedSort);
  if (sortFilter) sortFilter.value = savedSort;

  // Load saved theme preference
  const savedTheme = localStorage.getItem('libraryTheme') || 'witchy';
  applyTheme(savedTheme);
  if (themeFilter) themeFilter.value = savedTheme;

  // Handle sort change
  sortFilter?.addEventListener('change', async (e) => {
    const newMode = e.target.value;
    console.log('[App] Changing sort mode to:', newMode);
    setSortMode(newMode);
    const books = await storage.getBooks();
    hydrateBooks(books);
  });

  // Handle theme change
  themeFilter?.addEventListener('change', (e) => {
    const newTheme = e.target.value;
    console.log('[App] Changing theme to:', newTheme);
    applyTheme(newTheme);
    localStorage.setItem('libraryTheme', newTheme);
  });
}

function applyTheme(theme) {
  const library = document.querySelector('.library');
  if (!library) return;

  // Remove all theme classes from library
  library.classList.remove('theme-witchy', 'theme-colorful', 'theme-minimal');

  // Add new theme class to library
  if (theme !== 'witchy') {
    library.classList.add(`theme-${theme}`);
  }

  // Also add theme class to body for header styling
  document.body.classList.remove('theme-witchy', 'theme-colorful', 'theme-minimal');
  document.body.classList.add(`theme-${theme}`);

  console.log('[App] Applied theme:', theme);
}

async function handleExport() {
  console.log('[App] Exporting library...');
  const books = await storage.getBooks();
  const dataStr = JSON.stringify(books, null, 2);
  const dataBlob = new Blob([dataStr], { type: 'application/json' });
  const url = URL.createObjectURL(dataBlob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `library-buddy-export-${Date.now()}.json`;
  link.click();
  URL.revokeObjectURL(url);
  console.log('[App] Exported', books.length, 'books');
}

async function handleImportFile(event) {
  const file = event.target.files?.[0];
  if (!file) return;

  console.log('[App] Importing library from file:', file.name);
  try {
    const text = await file.text();
    const books = JSON.parse(text);
    console.log('[App] Parsed', books.length, 'books from import');

    // Add all books to storage
    for (const book of books) {
      await storage.addBook(book);
    }

    console.log('[App] Import complete');
    alert(`Successfully imported ${books.length} books!`);
  } catch (error) {
    console.error('[App] Import failed:', error);
    alert('Failed to import library. Please check the file format.');
  }
}

async function handleDeleteBook() {
  const bookId = getCurrentBookId();
  console.log('[App] Delete button clicked, bookId:', bookId);

  if (!bookId) {
    console.error('[App] No book ID found');
    alert('Cannot delete: book ID is missing');
    return;
  }

  // Get book title for confirmation modal
  const bookTitle = document.querySelector('#book-modal .book-title')?.textContent || 'this book';

  // Show custom confirmation modal
  const confirmModal = document.getElementById('confirm-delete-modal');
  const confirmBookTitle = document.querySelector('.confirm-book-title');
  const confirmBtn = document.getElementById('confirm-delete');
  const cancelBtn = document.getElementById('cancel-delete');

  if (confirmBookTitle) confirmBookTitle.textContent = `"${bookTitle}"`;
  confirmModal.showModal();

  // Wait for user choice
  const userConfirmed = await new Promise((resolve) => {
    const handleConfirm = () => {
      cleanup();
      resolve(true);
    };
    const handleCancel = () => {
      cleanup();
      resolve(false);
    };
    const cleanup = () => {
      confirmBtn.removeEventListener('click', handleConfirm);
      cancelBtn.removeEventListener('click', handleCancel);
      confirmModal.close();
    };

    confirmBtn.addEventListener('click', handleConfirm);
    cancelBtn.addEventListener('click', handleCancel);
  });

  if (!userConfirmed) {
    console.log('[App] Deletion cancelled by user');
    return;
  }

  // Delete the book
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

  // Ensure hand tracking is stopped while scanning
  try { destroyHands(); } catch (_) {}
  const cursor = document.getElementById('magic-cursor');
  if (cursor) cursor.style.display = 'none';

  await initCamera();
  await initBarcodeScanner(getVideoEl());
  setBrowseMode(false);
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

async function toggleMotionCursor() {
  const cursor = document.getElementById('magic-cursor');
  const toggleBtn = document.getElementById('toggle-motion-btn');

  if (motionCursorEnabled) {
    // Disable motion cursor
    cursor.style.display = 'none';
    motionCursorEnabled = false;
    localStorage.setItem('motionCursor', 'off');
    toggleBtn.textContent = 'Enable Motion Cursor';
    console.log('[App] Motion cursor disabled');
  } else {
    // Enable motion cursor
    cursor.style.display = 'block';
    motionCursorEnabled = true;
    localStorage.setItem('motionCursor', 'on');
    toggleBtn.textContent = 'Disable Motion Cursor';
    console.log('[App] Motion cursor enabled');

    // Start hand tracking if not already initialized
    if (!motionCursorInitialized) {
      await startMotionCursor();
    }
  }
}

async function startMotionCursor() {
  console.log('[App] Starting motion cursor...');
  const cursor = document.getElementById('magic-cursor');
  cursor.style.display = 'block';

  try {
    await initCamera();
    await initHands(getVideoEl());
    motionCursorInitialized = true;
    console.log('[App] Motion cursor initialized successfully');
  } catch (error) {
    console.error('[App] Failed to initialize motion cursor:', error);
    alert('Failed to start motion cursor. Please check camera permissions.');
    motionCursorEnabled = false;
    cursor.style.display = 'none';
  }
}

async function stopAll() {
  const overlay = document.querySelector('[data-test-id="webcam-overlay"]');
  overlay?.classList.add('hidden');
  overlay?.setAttribute('aria-hidden', 'true');

  // Always stop scanners, hands, and camera when pressing Stop
  stopBarcodeScanner();
  destroyHands();
  await stopCamera();

  // Reset motion cursor state and UI
  motionCursorEnabled = false;
  motionCursorInitialized = false;
  localStorage.setItem('motionCursor', 'off');
  const cursor = document.getElementById('magic-cursor');
  if (cursor) cursor.style.display = 'none';
  const toggleBtn = document.getElementById('toggle-motion-btn');
  if (toggleBtn) toggleBtn.textContent = 'Enable Motion Cursor';

  setBrowseMode(false);
  console.log('[App] Stopped all camera operations');
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

  // Grab to open modal or click buttons
  onGrab(() => {
    // Check if hovering over a book
    const highlighted = document.querySelector('.book-tile.highlight');
    if (highlighted) {
      const id = highlighted.getAttribute('data-id');
      const title = highlighted.getAttribute('data-title');
      const author = highlighted.getAttribute('data-author');
      const cover = highlighted.getAttribute('data-cover');
      const color = highlighted.getAttribute('data-color');
      openBookModal({ id, title, author, cover, color });
      return;
    }

    // Check if hovering over a button
    const cursor = document.getElementById('magic-cursor');
    const cursorRect = cursor.getBoundingClientRect();
    const x = cursorRect.left + cursorRect.width / 2;
    const y = cursorRect.top + cursorRect.height / 2;
    const element = document.elementFromPoint(x, y);

    if (element && element.tagName === 'BUTTON') {
      console.log('[App] Motion cursor clicked button:', element.textContent);
      element.click();
    }
  });

  // Wave to close modal or scanner
  onWave(() => {
    const modal = document.getElementById('book-modal');
    if (modal && modal.open) {
      console.log('[App] Wave detected, closing modal');
      closeBookModal();
      return;
    }

    // Check if scanner overlay is visible
    const overlay = document.querySelector('[data-test-id="webcam-overlay"]');
    if (overlay && !overlay.classList.contains('hidden')) {
      console.log('[App] Wave detected, closing scanner');
      stopAll();
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
  console.log('[App] Boot: Found', books.length, 'books in storage');
  console.log('[App] Books:', books);
  hydrateBooks(books);

  // Do not auto-start the camera; wait for explicit user action.
  const wasEnabled = localStorage.getItem('motionCursor') === 'on';
  if (wasEnabled) {
    console.log('[App] Restoring motion cursor from previous session...');
    motionCursorEnabled = true;
    motionCursorInitialized = false;
    await startMotionCursor();
  } else {
    console.log('[App] Motion cursor is opt-in. Use the toggle to enable.');
  }
}

boot();
