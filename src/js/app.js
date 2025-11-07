// App entry: orchestrates UI, camera, scanner, hands, storage, api
// Note: heavy libs (Quagga, Tesseract, MediaPipe, idb) loaded dynamically in respective modules

import { initCamera, stopCamera, getFrameImageData, getVideoEl } from './camera.js';
import { initBarcodeScanner, stopBarcodeScanner, onIsbnDetected, ocrFromFrame } from './scanner.js';
import { initHands, onCursorMove, onGrab, onOpenHand, onWave, onSwipeUp, destroyHands, setBrowseMode } from './hand.js';
import { renderBook, openBookModal, closeBookModal, initUI, hydrateBooks, highlightAtCursor, getCurrentBookId, setSortMode, getSortMode, nextPage, prevPage, resetColorTracking } from './ui.js';
import { findBookByISBN, searchBookByText, updateBookCover, detectSeriesFromTitle } from './api.js';
import { storage, events } from './storage.js';

const qs = (sel, root = document) => root.querySelector(sel);

let motionCursorEnabled = true;
let motionCursorInitialized = false;
let recognition = null;
let isListening = false;

// Custom notification system to match theme
function showNotification(message, icon = 'ℹ️') {
  const modal = document.getElementById('notification-modal');
  const messageEl = document.getElementById('notification-message');
  const iconEl = document.getElementById('notification-icon');
  const okBtn = document.getElementById('notification-ok');

  if (!modal || !messageEl || !iconEl || !okBtn) return;

  messageEl.textContent = message;
  iconEl.textContent = icon;
  modal.showModal();

  // Move cursor to notification modal so it appears on top
  const cursor = document.getElementById('magic-cursor');
  if (cursor && !modal.contains(cursor)) {
    modal.appendChild(cursor);
  }

  return new Promise((resolve) => {
    const handleClose = () => {
      okBtn.removeEventListener('click', handleClose);
      modal.close();

      // Move cursor back to body
      if (cursor && modal.contains(cursor)) {
        document.body.appendChild(cursor);
      }

      resolve();
    };

    okBtn.addEventListener('click', handleClose);
  });
}

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
  const themeFilterMenu = document.getElementById('theme-filter-menu');
  const menuBtn = document.getElementById('menu-btn');
  const settingsMenu = document.getElementById('settings-menu');
  const closeMenuBtn = document.getElementById('close-menu-btn');

  startBtn?.addEventListener('click', startScanMode);
  toggleMotionBtn?.addEventListener('click', toggleMotionCursor);
  closeModalBtn?.addEventListener('click', () => modal.close());
  deleteBtn?.addEventListener('click', handleDeleteBook);

  // Close scanner button
  const closeScannerBtn = document.getElementById('close-scanner-btn');
  closeScannerBtn?.addEventListener('click', stopAll);

  // Library Card buttons
  const viewCardBtn = document.getElementById('view-card-btn');
  const closeCardBtn = document.getElementById('close-card-btn');
  const addBorrowerBtn = document.getElementById('add-borrower-btn');

  viewCardBtn?.addEventListener('click', openLibraryCard);
  closeCardBtn?.addEventListener('click', closeLibraryCard);
  addBorrowerBtn?.addEventListener('click', addBorrower);

  // Voice Search button
  const voiceSearchBtn = document.getElementById('voice-search-btn');
  voiceSearchBtn?.addEventListener('click', toggleVoiceSearch);

  // Pagination buttons
  const prevPageBtn = document.getElementById('prev-page');
  const nextPageBtn = document.getElementById('next-page');
  prevPageBtn?.addEventListener('click', prevPage);
  nextPageBtn?.addEventListener('click', nextPage);

  // Manual ISBN entry
  const manualIsbnInput = document.getElementById('manual-isbn');
  const addIsbnBtn = document.getElementById('add-isbn-btn');
  addIsbnBtn?.addEventListener('click', () => handleManualIsbn(manualIsbnInput));
  manualIsbnInput?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      handleManualIsbn(manualIsbnInput);
    }
  });

  // Search functionality
  const searchInput = document.getElementById('search-input');
  const searchBtn = document.getElementById('search-btn');
  const clearSearchBtn = document.getElementById('clear-search-btn');

  searchBtn?.addEventListener('click', () => handleSearch(searchInput));
  searchInput?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      handleSearch(searchInput);
    }
  });

  clearSearchBtn?.addEventListener('click', async () => {
    if (searchInput) searchInput.value = '';
    clearSearchBtn.classList.add('hidden');
    const books = await storage.getBooks();
    hydrateBooks(books);
  });

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
  if (themeFilterMenu) themeFilterMenu.value = savedTheme;

  // Handle sort change
  sortFilter?.addEventListener('change', async (e) => {
    const newMode = e.target.value;
    console.log('[App] Changing sort mode to:', newMode);
    setSortMode(newMode);
    const books = await storage.getBooks();
    hydrateBooks(books);
  });

  // Handle theme change from settings menu
  themeFilterMenu?.addEventListener('change', async (e) => {
    const newTheme = e.target.value;
    console.log('[App] Changing theme to:', newTheme);
    applyTheme(newTheme);
    localStorage.setItem('libraryTheme', newTheme);
    // Reset color tracking and re-render books with new theme colors
    resetColorTracking();
    const books = await storage.getBooks();
    hydrateBooks(books);
  });

  // Handle hamburger menu toggle
  menuBtn?.addEventListener('click', () => {
    settingsMenu?.classList.remove('hidden');
  });

  closeMenuBtn?.addEventListener('click', () => {
    settingsMenu?.classList.add('hidden');
  });

  // Close menu when clicking outside
  settingsMenu?.addEventListener('click', (e) => {
    if (e.target === settingsMenu) {
      settingsMenu.classList.add('hidden');
    }
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

// Library Card Management
async function openLibraryCard() {
  const bookId = getCurrentBookId();
  if (!bookId) return;

  const book = (await storage.getBooks()).find(b => (b.id || b.isbn) === bookId);
  if (!book) return;

  const modal = document.getElementById('library-card-modal');
  const titleEl = document.getElementById('card-book-title');
  const authorEl = document.getElementById('card-book-author');
  const borrowerList = document.getElementById('borrower-list');

  titleEl.textContent = book.title || 'Untitled';
  authorEl.textContent = book.author || 'Unknown Author';

  // Render borrower list
  renderBorrowerList(book);

  modal.showModal();

  // Move cursor to card modal
  const cursor = document.getElementById('magic-cursor');
  if (cursor && !modal.contains(cursor)) {
    modal.appendChild(cursor);
  }
}

function renderBorrowerList(book) {
  const borrowerList = document.getElementById('borrower-list');
  const borrowers = book.borrowers || [];

  if (borrowers.length === 0) {
    borrowerList.innerHTML = '<p class="empty-card-message">No borrowing history</p>';
    return;
  }

  borrowerList.innerHTML = borrowers.map((borrower, index) => `
    <div class="borrower-entry">
      <span class="borrower-name">${borrower.name}</span>
      <span class="borrower-date">${borrower.date}</span>
      <button class="remove-borrower-btn" data-index="${index}">Return</button>
    </div>
  `).join('');

  // Add event listeners to remove buttons
  borrowerList.querySelectorAll('.remove-borrower-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const index = parseInt(btn.getAttribute('data-index'));
      await removeBorrower(index);
    });
  });
}

async function addBorrower() {
  const bookId = getCurrentBookId();
  if (!bookId) return;

  const nameInput = document.getElementById('borrower-name');
  const dateInput = document.getElementById('borrow-date');

  const name = nameInput.value.trim();
  const date = dateInput.value;

  if (!name) {
    await showNotification('Please enter a borrower name', 'ℹ️');
    return;
  }

  if (!date) {
    await showNotification('Please select a borrow date', 'ℹ️');
    return;
  }

  const books = await storage.getBooks();
  const book = books.find(b => (b.id || b.isbn) === bookId);
  if (!book) return;

  if (!book.borrowers) {
    book.borrowers = [];
  }

  book.borrowers.push({ name, date });
  await storage.addBook(book);

  // Clear inputs
  nameInput.value = '';
  dateInput.value = '';

  // Re-render list
  renderBorrowerList(book);
}

async function removeBorrower(index) {
  const bookId = getCurrentBookId();
  if (!bookId) return;

  const books = await storage.getBooks();
  const book = books.find(b => (b.id || b.isbn) === bookId);
  if (!book || !book.borrowers) return;

  book.borrowers.splice(index, 1);
  await storage.addBook(book);

  // Re-render list
  renderBorrowerList(book);
}

function closeLibraryCard() {
  const modal = document.getElementById('library-card-modal');
  modal.close();

  // Move cursor back to book modal
  const cursor = document.getElementById('magic-cursor');
  const bookModal = document.getElementById('book-modal');
  if (cursor && modal.contains(cursor) && bookModal) {
    bookModal.appendChild(cursor);
  }
}

// Voice Search Functionality
function initVoiceRecognition() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

  if (!SpeechRecognition) {
    console.warn('[Voice] Speech recognition not supported');
    return false;
  }

  recognition = new SpeechRecognition();
  recognition.continuous = false;
  recognition.interimResults = false;
  recognition.lang = 'en-US';

  recognition.onstart = () => {
    console.log('[Voice] Listening started');
    isListening = true;
    const voiceBtn = document.getElementById('voice-search-btn');
    voiceBtn?.classList.add('listening');
  };

  recognition.onend = () => {
    console.log('[Voice] Listening ended');
    isListening = false;
    const voiceBtn = document.getElementById('voice-search-btn');
    voiceBtn?.classList.remove('listening');
  };

  recognition.onerror = (event) => {
    console.error('[Voice] Recognition error:', event.error);
    isListening = false;
    const voiceBtn = document.getElementById('voice-search-btn');
    voiceBtn?.classList.remove('listening');
  };

  recognition.onresult = async (event) => {
    const transcript = event.results[0][0].transcript.toLowerCase();
    console.log('[Voice] Heard:', transcript);
    await handleVoiceCommand(transcript);
  };

  return true;
}

async function handleVoiceCommand(transcript) {
  const books = await storage.getBooks();

  // Extract potential book title from the command
  // Patterns: "is [book] in my library", "do i have [book]", "is anyone borrowing [book]", "who has [book]"

  let bookTitle = null;
  let isBorrowingQuery = false;

  // Check for borrowing queries
  if (transcript.includes('borrowing') || transcript.includes('who has') || transcript.includes('who borrowed')) {
    isBorrowingQuery = true;

    // Extract book title after "borrowing" or "who has"
    if (transcript.includes('borrowing')) {
      bookTitle = transcript.split('borrowing')[1]?.trim();
    } else if (transcript.includes('who has')) {
      bookTitle = transcript.split('who has')[1]?.trim();
    } else if (transcript.includes('who borrowed')) {
      bookTitle = transcript.split('who borrowed')[1]?.trim();
    }
  }
  // Check for library search queries
  else if (transcript.includes('is') && (transcript.includes('in my library') || transcript.includes('in the library'))) {
    const match = transcript.match(/is\s+(.+?)\s+in\s+(my\s+)?library/);
    if (match) {
      bookTitle = match[1];
    }
  }
  else if (transcript.includes('do i have')) {
    bookTitle = transcript.split('do i have')[1]?.trim();
  }
  else if (transcript.includes('find')) {
    bookTitle = transcript.split('find')[1]?.trim();
  }
  else if (transcript.includes('search for')) {
    bookTitle = transcript.split('search for')[1]?.trim();
  }
  else {
    // If no specific pattern, try to use the whole transcript as the book title
    bookTitle = transcript;
  }

  if (!bookTitle) {
    await showNotification('Could not understand the book title. Try saying "Is [book name] in my library?"', '🎤');
    return;
  }

  // Clean up common words
  bookTitle = bookTitle.replace(/^(the|a|an)\s+/i, '').trim();

  console.log('[Voice] Searching for:', bookTitle, 'Borrowing query:', isBorrowingQuery);

  // Search for the book (case-insensitive)
  const foundBook = books.find(book => {
    const titleMatch = book.title?.toLowerCase().includes(bookTitle);
    const authorMatch = book.author?.toLowerCase().includes(bookTitle);
    return titleMatch || authorMatch;
  });

  if (foundBook) {
    console.log('[Voice] Found book:', foundBook.title);

    // Open the book modal
    openBookModal({
      id: foundBook.id,
      title: foundBook.title,
      author: foundBook.author,
      cover: foundBook.coverUrl,
      color: foundBook.spineColor
    });

    // If it's a borrowing query, also open the library card
    if (isBorrowingQuery) {
      // Wait a bit for the modal to open
      setTimeout(() => {
        openLibraryCard();
      }, 300);
    }
  } else {
    await showNotification(`"${bookTitle}" is not in your library`, '📚');
  }
}

function toggleVoiceSearch() {
  if (!recognition) {
    const initialized = initVoiceRecognition();
    if (!initialized) {
      showNotification('Voice search is not supported in your browser', '❌');
      return;
    }
  }

  if (isListening) {
    recognition.stop();
  } else {
    recognition.start();
  }
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
    await showNotification(`Successfully imported ${books.length} books!`, '✅');
  } catch (error) {
    console.error('[App] Import failed:', error);
    await showNotification('Failed to import library. Please check the file format.', '❌');
  }
}

async function handleSearch(inputElement) {
  if (!inputElement) return;

  const query = inputElement.value.trim();
  const clearSearchBtn = document.getElementById('clear-search-btn');

  if (!query) {
    // If search is empty, show all books and hide clear button
    const books = await storage.getBooks();
    hydrateBooks(books);
    clearSearchBtn?.classList.add('hidden');
    return;
  }

  console.log('[App] Searching for:', query);

  try {
    const books = await storage.getBooks();
    const queryLower = query.toLowerCase();

    // Case-insensitive search across title, author, and series
    const matchingBooks = books.filter(book => {
      const titleMatch = book.title?.toLowerCase().includes(queryLower);
      const authorMatch = book.author?.toLowerCase().includes(queryLower);
      const seriesMatch = book.series?.toLowerCase().includes(queryLower);
      return titleMatch || authorMatch || seriesMatch;
    });

    if (matchingBooks.length > 0) {
      console.log('[App] Found', matchingBooks.length, 'matching books');

      // Check for exact match or single result
      const exactMatch = matchingBooks.find(book =>
        book.title?.toLowerCase() === queryLower ||
        book.author?.toLowerCase() === queryLower
      );

      if (exactMatch || matchingBooks.length === 1) {
        // Open modal directly for exact match or single result
        const book = exactMatch || matchingBooks[0];
        console.log('[App] Opening book modal for:', book.title);
        openBookModal({
          id: book.id,
          title: book.title,
          author: book.author,
          cover: book.coverUrl,
          color: book.spineColor
        });
        inputElement.value = '';
        clearSearchBtn?.classList.add('hidden');
      } else {
        // Display all matching books
        hydrateBooks(matchingBooks);
        // Show the clear button
        clearSearchBtn?.classList.remove('hidden');
      }
    } else {
      console.log('[App] No books found in library');
      await showNotification(`No books found matching: "${query}"`, '🔍');
      // Hide clear button since no results to clear
      clearSearchBtn?.classList.add('hidden');
    }
  } catch (error) {
    console.error('[App] Search failed:', error);
    await showNotification('Search failed. Please try again.', '❌');
  }
}

async function handleManualIsbn(inputElement) {
  if (!inputElement) return;

  const isbn = inputElement.value.trim();
  if (!isbn) {
    await showNotification('Please enter an ISBN', 'ℹ️');
    return;
  }

  console.log('[App] Manual ISBN entry:', isbn);

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
      inputElement.value = '';
      console.log('[App] Book added successfully:', book.title);
    } else {
      await showNotification('Book not found. Please check the ISBN and try again.', '📚');
    }
  } catch (error) {
    console.error('[App] Failed to fetch book:', error);
    await showNotification('Failed to fetch book data. Please try again.', '❌');
  }
}

async function handleDeleteBook() {
  const bookId = getCurrentBookId();
  console.log('[App] Delete button clicked, bookId:', bookId);

  if (!bookId) {
    console.error('[App] No book ID found');
    await showNotification('Cannot delete: book ID is missing', '❌');
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

  // Move cursor to confirmation modal so it appears on top
  const cursor = document.getElementById('magic-cursor');
  if (cursor && !confirmModal.contains(cursor)) {
    confirmModal.appendChild(cursor);
  }

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

      // Move cursor back to the book modal (since it's still open)
      const bookModal = document.getElementById('book-modal');
      if (cursor && confirmModal.contains(cursor) && bookModal) {
        bookModal.appendChild(cursor);
      }
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
    await showNotification('Failed to remove book. Please try again.', '❌');
  }
}

async function startScanMode() {
  const overlay = document.querySelector('[data-test-id="webcam-overlay"]');
  overlay?.classList.remove('hidden');
  overlay?.setAttribute('aria-hidden', 'false');

  // Move cursor into overlay so it's accessible
  const cursor = document.getElementById('magic-cursor');
  if (cursor && overlay && !overlay.contains(cursor)) {
    overlay.appendChild(cursor);
  }

  await initCamera();
  await initBarcodeScanner(getVideoEl());
  setBrowseMode(false);
}

async function toggleMotionCursor() {
  const cursor = document.getElementById('magic-cursor');
  const toggleBtn = document.getElementById('toggle-motion-btn');

  if (motionCursorEnabled && motionCursorInitialized) {
    // Disable motion cursor
    console.log('[App] Disabling motion cursor...');
    cursor.style.display = 'none';
    motionCursorEnabled = false;
    motionCursorInitialized = false;
    localStorage.setItem('motionCursor', 'off');
    toggleBtn.textContent = 'Enable Motion Cursor';

    // Stop hand tracking and camera
    destroyHands();
    await new Promise(resolve => setTimeout(resolve, 100));
    await stopCamera();

    console.log('[App] Motion cursor disabled');
  } else {
    // Enable motion cursor
    console.log('[App] Enabling motion cursor...');

    try {
      // Start hand tracking first
      await startMotionCursor();

      // Only update state if successful
      cursor.style.display = 'block';
      motionCursorEnabled = true;
      motionCursorInitialized = true;
      localStorage.setItem('motionCursor', 'on');
      toggleBtn.textContent = 'Disable Motion Cursor';

      console.log('[App] Motion cursor enabled');
    } catch (error) {
      console.error('[App] Failed to enable motion cursor:', error);
      // Reset state on failure
      cursor.style.display = 'none';
      motionCursorEnabled = false;
      motionCursorInitialized = false;
      localStorage.setItem('motionCursor', 'off');
      toggleBtn.textContent = 'Enable Motion Cursor';
    }
  }
}

async function startMotionCursor() {
  console.log('[App] Starting motion cursor...');

  await initCamera();
  await initHands(getVideoEl());
  console.log('[App] Motion cursor initialized successfully');
}

async function stopAll() {
  console.log('[App] Stopping all camera operations...');

  const overlay = document.querySelector('[data-test-id="webcam-overlay"]');
  overlay?.classList.add('hidden');
  overlay?.setAttribute('aria-hidden', 'true');

  // Move cursor back to body
  const cursor = document.getElementById('magic-cursor');
  if (cursor && overlay && overlay.contains(cursor)) {
    document.body.appendChild(cursor);
  }

  // Stop in the correct order: scanner first, then hands (which uses camera), then camera itself
  stopBarcodeScanner();

  // Destroy hands/MediaPipe first (it manages its own camera internally)
  destroyHands();

  // Small delay to ensure MediaPipe releases the camera
  await new Promise(resolve => setTimeout(resolve, 100));

  // Now stop our camera module
  await stopCamera();

  // Reset motion cursor state and UI
  motionCursorEnabled = false;
  motionCursorInitialized = false;
  localStorage.setItem('motionCursor', 'off');
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

  // Swipe up to open library card (when book modal is open)
  onSwipeUp(() => {
    const bookModal = document.getElementById('book-modal');
    const libraryCardModal = document.getElementById('library-card-modal');

    // Only open library card if book modal is open and library card is not already open
    if (bookModal && bookModal.open && (!libraryCardModal || !libraryCardModal.open)) {
      console.log('[App] Swipe up detected, opening library card');
      openLibraryCard();
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
