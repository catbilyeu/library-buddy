// App entry: orchestrates UI, camera, scanner, hands, storage, api
// Note: heavy libs (Quagga, Tesseract, MediaPipe, idb) loaded dynamically in respective modules

import { initCamera, stopCamera, getFrameImageData, getVideoEl } from './camera.js';
import { initBarcodeScanner, stopBarcodeScanner, onIsbnDetected, ocrFromFrame } from './scanner.js';
import { initHands, onCursorMove, onGrab, onOpenHand, onWave, onSwipeUp, destroyHands, setBrowseMode } from './hand.js';
import { renderBook, openBookModal, closeBookModal, initUI, hydrateBooks, highlightAtCursor, getCurrentBookId, setSortMode, getSortMode, nextPage, prevPage, resetColorTracking, getBookColor, openEditSeriesDialog, openReenrichDialog } from './ui.js';
import { findBookByISBN, searchBookByText, updateBookCover, detectSeriesFromTitle } from './api.js';
import { storage, events } from './storage.js';
import { loginWithGoogle, logout, onAuthChange, getCurrentUser } from './firebase.js';

const qs = (sel, root = document) => root.querySelector(sel);

let handsFreeModeEnabled = true;
let handsFreeModeInitialized = false;
let recognition = null;
let isListening = false;
let continuousListening = false; // Track if we're in continuous mode

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
  const toggleHandsFreeBtn = document.getElementById('toggle-hands-free-btn');
  const toggleCursorBtn = document.getElementById('toggle-cursor-btn');
  const toggleVoiceBtn = document.getElementById('toggle-voice-btn');
  const exportBtn = document.querySelector('[data-action="export"]');
  const importBtn = document.querySelector('[data-action="import"]');
  const importInput = document.getElementById('import-file');

  // Auth buttons
  const loginBtn = document.getElementById('login-btn');
  const logoutBtn = document.getElementById('logout-btn');
  const modalLoginBtn = document.getElementById('modal-login-btn');

  loginBtn?.addEventListener('click', handleLogin);
  logoutBtn?.addEventListener('click', handleLogout);
  modalLoginBtn?.addEventListener('click', handleLogin);

  // Initialize button states based on saved preferences
  const cursorEnabled = localStorage.getItem('handCursorEnabled') === 'on';
  const voiceEnabled = localStorage.getItem('voiceCommandsEnabled') === 'on';
  if (toggleCursorBtn && cursorEnabled) toggleCursorBtn.classList.add('active');
  if (toggleVoiceBtn && voiceEnabled) toggleVoiceBtn.classList.add('active');

  // Update hands-free button text based on state
  if (toggleHandsFreeBtn && cursorEnabled && voiceEnabled) {
    toggleHandsFreeBtn.textContent = 'Disable Hands Free Mode';
  }

  const modal = document.getElementById('book-modal');
  const closeModalBtn = document.getElementById('close-modal');
  const deleteBtn = document.getElementById('delete-book');
  const editSeriesBtn = document.getElementById('edit-series-btn');
  const reenrichBtn = document.getElementById('reenrich-btn');
  const sortFilter = document.getElementById('sort-filter');
  const themeFilterMenu = document.getElementById('theme-filter-menu');
  const menuBtn = document.getElementById('menu-btn');
  const settingsMenu = document.getElementById('settings-menu');
  const closeMenuBtn = document.getElementById('close-menu-btn');

  startBtn?.addEventListener('click', startScanMode);
  toggleHandsFreeBtn?.addEventListener('click', toggleHandsFreeMode);
  toggleCursorBtn?.addEventListener('click', toggleHandCursor);
  toggleVoiceBtn?.addEventListener('click', toggleVoiceCommands);
  closeModalBtn?.addEventListener('click', () => modal.close());
  deleteBtn?.addEventListener('click', handleDeleteBook);
  editSeriesBtn?.addEventListener('click', openEditSeriesDialog);
  reenrichBtn?.addEventListener('click', openReenrichDialog);

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

    // Regenerate colors for all books with new theme palette
    const books = await storage.getBooks();
    for (const book of books) {
      // Generate new color from new theme
      book.spineColor = getBookColor(book.id || book.isbn, book.title, book.series);
      await storage.addBook(book);
    }

    // Re-render with new colors
    const updatedBooks = await storage.getBooks();
    hydrateBooks(updatedBooks);
  });

  // Handle hamburger menu toggle
  menuBtn?.addEventListener('click', () => {
    // Only allow menu to open if user is authenticated
    const currentUser = getCurrentUser();
    if (currentUser) {
      settingsMenu?.classList.remove('hidden');
    }
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
  library.classList.remove('theme-witchy', 'theme-colorful', 'theme-minimal', 'theme-bookshelf');

  // Add new theme class to library
  if (theme !== 'witchy') {
    library.classList.add(`theme-${theme}`);
  }

  // Also add theme class to body for header styling
  document.body.classList.remove('theme-witchy', 'theme-colorful', 'theme-minimal', 'theme-bookshelf');
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

  borrowerList.innerHTML = borrowers.map((borrower, index) => {
    const isReturned = borrower.returnDate;
    const statusClass = isReturned ? 'returned' : 'active';
    const dateDisplay = isReturned
      ? `${borrower.date} - ${borrower.returnDate}`
      : borrower.date;

    return `
      <div class="borrower-entry ${statusClass}">
        <span class="borrower-name">${borrower.name}</span>
        <span class="borrower-date">${dateDisplay}</span>
        ${!isReturned ? `<button class="return-borrower-btn" data-index="${index}">Return</button>` : '<span class="returned-badge">Returned</span>'}
      </div>
    `;
  }).join('');

  // Add event listeners to return buttons
  borrowerList.querySelectorAll('.return-borrower-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const index = parseInt(btn.getAttribute('data-index'));
      await returnBorrower(index);
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

async function returnBorrower(index, returnDate = null) {
  const bookId = getCurrentBookId();
  if (!bookId) return;

  const books = await storage.getBooks();
  const book = books.find(b => (b.id || b.isbn) === bookId);
  if (!book || !book.borrowers) return;

  // Set return date instead of removing the entry
  const today = returnDate || new Date().toISOString().split('T')[0];
  book.borrowers[index].returnDate = today;
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

// Date parsing helper for voice commands
function parseVoiceDate(dateString) {
  const today = new Date();
  const lowerDate = dateString.toLowerCase();

  // Handle "today"
  if (lowerDate.includes('today')) {
    return today.toISOString().split('T')[0];
  }

  // Handle "yesterday"
  if (lowerDate.includes('yesterday')) {
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    return yesterday.toISOString().split('T')[0];
  }

  // Handle "last [day of week]" (e.g., "last wednesday")
  const dayMatch = lowerDate.match(/last\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)/);
  if (dayMatch) {
    const targetDay = dayMatch[1];
    const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const targetDayIndex = days.indexOf(targetDay);
    const currentDayIndex = today.getDay();

    let daysAgo = currentDayIndex - targetDayIndex;
    if (daysAgo <= 0) daysAgo += 7; // Go back to last week

    const targetDate = new Date(today);
    targetDate.setDate(targetDate.getDate() - daysAgo);
    return targetDate.toISOString().split('T')[0];
  }

  // Handle "on [month] [day]" (e.g., "on nov 1st", "on november 1")
  const monthDayMatch = lowerDate.match(/on\s+(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d+)/);
  if (monthDayMatch) {
    const monthStr = monthDayMatch[1];
    const day = parseInt(monthDayMatch[2]);

    const monthMap = {
      'jan': 0, 'january': 0,
      'feb': 1, 'february': 1,
      'mar': 2, 'march': 2,
      'apr': 3, 'april': 3,
      'may': 4,
      'jun': 5, 'june': 5,
      'jul': 6, 'july': 6,
      'aug': 7, 'august': 7,
      'sep': 8, 'september': 8,
      'oct': 9, 'october': 9,
      'nov': 10, 'november': 10,
      'dec': 11, 'december': 11
    };

    const month = monthMap[monthStr];
    if (month !== undefined) {
      const targetDate = new Date(today.getFullYear(), month, day);
      // If the date is in the future, assume last year
      if (targetDate > today) {
        targetDate.setFullYear(today.getFullYear() - 1);
      }
      return targetDate.toISOString().split('T')[0];
    }
  }

  // Default to today if we can't parse
  return today.toISOString().split('T')[0];
}

// Voice Search Functionality
function initVoiceRecognition(continuous = false) {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

  if (!SpeechRecognition) {
    console.warn('[Voice] Speech recognition not supported');
    return false;
  }

  recognition = new SpeechRecognition();
  recognition.continuous = continuous;
  recognition.interimResults = false;
  recognition.lang = 'en-US';
  continuousListening = continuous;

  recognition.onstart = () => {
    console.log('[Voice] Listening started (continuous:', continuous, ')');
    isListening = true;
    const voiceBtn = document.getElementById('voice-search-btn');
    voiceBtn?.classList.add('listening');
  };

  recognition.onend = () => {
    console.log('[Voice] Listening ended');
    isListening = false;
    const voiceBtn = document.getElementById('voice-search-btn');
    voiceBtn?.classList.remove('listening');

    // Restart if in continuous mode and hands free mode is still enabled
    if (continuousListening && handsFreeModeEnabled && handsFreeModeInitialized) {
      console.log('[Voice] Restarting continuous listening...');
      setTimeout(() => {
        if (recognition && continuousListening) {
          recognition.start();
        }
      }, 100);
    }
  };

  recognition.onerror = (event) => {
    console.error('[Voice] Recognition error:', event.error);
    isListening = false;
    const voiceBtn = document.getElementById('voice-search-btn');
    voiceBtn?.classList.remove('listening');

    // Restart if in continuous mode and it's not a fatal error
    if (continuousListening && handsFreeModeEnabled && event.error !== 'no-speech') {
      console.log('[Voice] Restarting after error...');
      setTimeout(() => {
        if (recognition && continuousListening) {
          recognition.start();
        }
      }, 1000);
    }
  };

  recognition.onresult = async (event) => {
    const transcript = event.results[event.results.length - 1][0].transcript.toLowerCase();
    console.log('[Voice] Heard:', transcript);
    console.log('[Voice] Confidence:', event.results[event.results.length - 1][0].confidence);
    await handleVoiceCommand(transcript);
  };

  return true;
}

async function handleVoiceCommand(transcript) {
  // Check for "disable hands free" command (with flexible matching for "hands free" / "hands-free" / "handsfree")
  const disablePatterns = [
    'disable hands free',
    'disable hands-free',
    'disable handsfree',
    'turn off hands free',
    'turn off hands-free',
    'turn off handsfree',
    'stop hands free',
    'stop hands-free',
    'stop handsfree'
  ];

  if (disablePatterns.some(pattern => transcript.includes(pattern))) {
    console.log('[Voice] Disabling hands free mode');
    await toggleHandsFreeMode();
    return;
  }

  // Check for "remove" or "delete" book command
  if (transcript.includes('remove') || transcript.includes('delete')) {
    console.log('[Voice] Remove book command detected');

    // Extract book title after "remove" or "delete"
    let bookTitle = null;
    if (transcript.includes('remove')) {
      // Pattern: "remove [book] from my library"
      const match = transcript.match(/remove\s+(.+?)\s+from\s+(my\s+)?library/);
      if (match) {
        bookTitle = match[1];
      } else {
        // Just "remove [book]"
        bookTitle = transcript.split('remove')[1]?.trim();
      }
    } else if (transcript.includes('delete')) {
      // Pattern: "delete [book] from my library"
      const match = transcript.match(/delete\s+(.+?)\s+from\s+(my\s+)?library/);
      if (match) {
        bookTitle = match[1];
      } else {
        // Just "delete [book]"
        bookTitle = transcript.split('delete')[1]?.trim();
      }
    }

    if (!bookTitle) {
      await showNotification('Could not understand which book to remove. Try "Remove [book name] from my library"', '🎤');
      return;
    }

    // Clean up common words
    bookTitle = bookTitle.replace(/^(the|a|an)\s+/i, '').trim();

    console.log('[Voice] Attempting to remove book:', bookTitle);

    // Search for the book (case-insensitive)
    const books = await storage.getBooks();
    const foundBook = books.find(book => {
      const titleMatch = book.title?.toLowerCase().includes(bookTitle);
      const authorMatch = book.author?.toLowerCase().includes(bookTitle);
      return titleMatch || authorMatch;
    });

    if (foundBook) {
      console.log('[Voice] Found book to remove:', foundBook.title);

      // Remove the book
      try {
        await storage.removeBook(foundBook.id || foundBook.isbn);
        await showNotification(`"${foundBook.title}" has been removed from your library`, '✅');
        console.log('[Voice] Book removed successfully');
      } catch (error) {
        console.error('[Voice] Failed to remove book:', error);
        await showNotification('Failed to remove book. Please try again.', '❌');
      }
    } else {
      await showNotification(`"${bookTitle}" was not found in your library`, '📚');
    }

    return;
  }

  // Check for borrowing command (e.g., "hannah started borrowing fourth wing today")
  if (transcript.includes('started borrowing') || transcript.includes('borrowed') || transcript.includes('is borrowing')) {
    console.log('[Voice] Borrowing command detected');

    // Pattern: "[name] started borrowing [book] [date]" or "[name] is borrowing [book] [date]"
    let borrowerName = null;
    let bookTitle = null;
    let dateString = '';

    const borrowingMatch = transcript.match(/(.+?)\s+(?:started borrowing|borrowed|is borrowing)\s+(.+)/);
    if (borrowingMatch) {
      borrowerName = borrowingMatch[1].trim();
      const restOfCommand = borrowingMatch[2].trim();

      // Extract date indicators from the end
      const datePatterns = [
        /(.+?)\s+(today|yesterday|last\s+(?:sunday|monday|tuesday|wednesday|thursday|friday|saturday)|on\s+\w+\s+\d+(?:st|nd|rd|th)?)$/i,
        /(.+)$/ // Fallback if no date specified
      ];

      let matched = false;
      for (const pattern of datePatterns) {
        const match = restOfCommand.match(pattern);
        if (match) {
          bookTitle = match[1].trim();
          dateString = match[2] || 'today';
          matched = true;
          console.log('[Voice] Pattern matched - Book:', bookTitle, 'Date:', dateString);
          break;
        }
      }

      if (!matched) {
        // No date pattern matched, treat entire rest as book title
        bookTitle = restOfCommand;
        dateString = 'today';
        console.log('[Voice] No date pattern - Book:', bookTitle, 'Date:', dateString);
      }
    }

    if (!borrowerName || !bookTitle) {
      await showNotification('Could not understand. Try "[name] started borrowing [book] today"', '🎤');
      return;
    }

    // Clean up book title
    bookTitle = bookTitle.replace(/^(the|a|an)\s+/i, '').trim();

    console.log('[Voice] Borrower:', borrowerName, 'Book:', bookTitle, 'Date:', dateString);

    // Find the book
    const books = await storage.getBooks();
    const foundBook = books.find(book => {
      const titleMatch = book.title?.toLowerCase().includes(bookTitle);
      return titleMatch;
    });

    if (foundBook) {
      const borrowDate = parseVoiceDate(dateString);

      console.log('[Voice] Parsed borrow date:', borrowDate);
      console.log('[Voice] Adding borrower to book:', foundBook.title);

      if (!foundBook.borrowers) {
        foundBook.borrowers = [];
      }

      foundBook.borrowers.push({ name: borrowerName, date: borrowDate });

      console.log('[Voice] Book borrowers after push:', foundBook.borrowers);

      await storage.addBook(foundBook);

      console.log('[Voice] Book saved to storage');

      await showNotification(`${borrowerName} started borrowing "${foundBook.title}" on ${borrowDate}`, '✅');
      console.log('[Voice] Borrower added successfully');
    } else {
      await showNotification(`"${bookTitle}" was not found in your library`, '📚');
    }

    return;
  }

  // Check for return command (e.g., "hannah returned fourth wing today")
  if (transcript.includes('returned')) {
    console.log('[Voice] Return command detected');

    // Pattern: "[name] returned [book] [date]"
    let borrowerName = null;
    let bookTitle = null;
    let dateString = '';

    const returnMatch = transcript.match(/(.+?)\s+returned\s+(.+)/);
    if (returnMatch) {
      borrowerName = returnMatch[1].trim();
      const restOfCommand = returnMatch[2].trim();

      // Extract date indicators from the end
      const datePatterns = [
        /(.+?)\s+(today|yesterday|last\s+(?:sunday|monday|tuesday|wednesday|thursday|friday|saturday)|on\s+\w+\s+\d+(?:st|nd|rd|th)?)$/i,
        /(.+)$/ // Fallback if no date specified
      ];

      let matched = false;
      for (const pattern of datePatterns) {
        const match = restOfCommand.match(pattern);
        if (match) {
          bookTitle = match[1].trim();
          dateString = match[2] || 'today';
          matched = true;
          console.log('[Voice] Pattern matched - Book:', bookTitle, 'Date:', dateString);
          break;
        }
      }

      if (!matched) {
        // No date pattern matched, treat entire rest as book title
        bookTitle = restOfCommand;
        dateString = 'today';
        console.log('[Voice] No date pattern - Book:', bookTitle, 'Date:', dateString);
      }
    }

    if (!borrowerName || !bookTitle) {
      await showNotification('Could not understand. Try "[name] returned [book] today"', '🎤');
      return;
    }

    // Clean up book title
    bookTitle = bookTitle.replace(/^(the|a|an)\s+/i, '').trim();

    console.log('[Voice] Borrower:', borrowerName, 'Book:', bookTitle, 'Return date:', dateString);

    // Find the book
    const books = await storage.getBooks();
    const foundBook = books.find(book => {
      const titleMatch = book.title?.toLowerCase().includes(bookTitle);
      return titleMatch;
    });

    if (foundBook) {
      const returnDate = parseVoiceDate(dateString);

      // Find the active borrower (no return date)
      const borrowerIndex = foundBook.borrowers?.findIndex(b =>
        b.name.toLowerCase() === borrowerName.toLowerCase() && !b.returnDate
      );

      if (borrowerIndex !== undefined && borrowerIndex >= 0) {
        foundBook.borrowers[borrowerIndex].returnDate = returnDate;
        await storage.addBook(foundBook);

        await showNotification(`${borrowerName} returned "${foundBook.title}" on ${returnDate}`, '✅');
        console.log('[Voice] Return recorded successfully');
      } else {
        await showNotification(`${borrowerName} is not currently borrowing "${foundBook.title}"`, 'ℹ️');
      }
    } else {
      await showNotification(`"${bookTitle}" was not found in your library`, '📚');
    }

    return;
  }

  // Check for "open scanner" command (context: should NOT contain "book")
  if ((transcript.includes('open scanner') || transcript.includes('scan') || transcript.includes('scanner')) && !transcript.includes('book')) {
    console.log('[Voice] Opening scanner');
    await startScanMode();
    return;
  }

  // Check for "close" command (context: should NOT contain "book" or "scanner")
  if (transcript.includes('close') && !transcript.includes('book') && !transcript.includes('scanner')) {
    console.log('[Voice] Close command detected');

    // Close notification modal if open
    const notificationModal = document.getElementById('notification-modal');
    if (notificationModal && notificationModal.open) {
      console.log('[Voice] Closing notification modal');
      const okBtn = document.getElementById('notification-ok');
      okBtn?.click();
      return;
    }

    // Close library card modal if open
    const libraryCardModal = document.getElementById('library-card-modal');
    if (libraryCardModal && libraryCardModal.open) {
      console.log('[Voice] Closing library card modal');
      closeLibraryCard();
      return;
    }

    // Close book modal if open
    const bookModal = document.getElementById('book-modal');
    if (bookModal && bookModal.open) {
      console.log('[Voice] Closing book modal');
      closeBookModal();
      return;
    }

    // Close scanner overlay if open (but keep hands free mode active)
    const overlay = document.querySelector('[data-test-id="webcam-overlay"]');
    if (overlay && !overlay.classList.contains('hidden')) {
      console.log('[Voice] Closing scanner (keeping hands free mode active)');
      overlay.classList.add('hidden');
      overlay.setAttribute('aria-hidden', 'true');

      // Move cursor back to body
      const cursor = document.getElementById('magic-cursor');
      if (cursor && overlay && overlay.contains(cursor)) {
        document.body.appendChild(cursor);
      }

      // Stop scanner but keep hands free mode active
      stopBarcodeScanner();
      setBrowseMode(true); // Keep browse mode active for hands free
      return;
    }

    // Close settings menu if open
    const settingsMenu = document.getElementById('settings-menu');
    if (settingsMenu && !settingsMenu.classList.contains('hidden')) {
      console.log('[Voice] Closing settings menu');
      settingsMenu.classList.add('hidden');
      return;
    }

    // Nothing to close
    await showNotification('Nothing to close', 'ℹ️');
    return;
  }

  // Book search and borrowing queries
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
    await showNotification('Could not understand the command. Try "Is [book name] in my library?" or "Open scanner" or "Close"', '🎤');
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
      // Generate and save spine color using theme-based color system
      if (!book.spineColor) {
        book.spineColor = getBookColor(book.id || book.isbn, book.title, book.series);
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

async function toggleHandsFreeMode() {
  const toggleBtn = document.getElementById('toggle-hands-free-btn');
  const cursorBtn = document.getElementById('toggle-cursor-btn');
  const voiceBtn = document.getElementById('toggle-voice-btn');

  const cursorEnabled = localStorage.getItem('handCursorEnabled') === 'on';
  const voiceEnabled = localStorage.getItem('voiceCommandsEnabled') === 'on';
  const bothEnabled = cursorEnabled && voiceEnabled;

  if (bothEnabled) {
    // Disable both
    console.log('[App] Disabling hands free mode...');

    if (cursorEnabled) await toggleHandCursor();
    if (voiceEnabled) await toggleVoiceCommands();

    toggleBtn.textContent = 'Enable Hands Free Mode';
    console.log('[App] Hands free mode disabled');
  } else {
    // Enable both
    console.log('[App] Enabling hands free mode...');

    if (!cursorEnabled) await toggleHandCursor();
    if (!voiceEnabled) await toggleVoiceCommands();

    toggleBtn.textContent = 'Disable Hands Free Mode';
    console.log('[App] Hands free mode enabled');
  }
}

async function toggleHandCursor() {
  const cursor = document.getElementById('magic-cursor');
  const toggleBtn = document.getElementById('toggle-cursor-btn');
  const handsFreeBtn = document.getElementById('toggle-hands-free-btn');
  const handCursorEnabled = localStorage.getItem('handCursorEnabled') === 'on';

  if (handCursorEnabled) {
    // Disable hand cursor
    console.log('[App] Disabling hand cursor...');
    cursor.style.display = 'none';
    handsFreeModeEnabled = false;
    handsFreeModeInitialized = false;
    localStorage.setItem('handCursorEnabled', 'off');
    toggleBtn.classList.remove('active');

    // Stop hand tracking and camera
    destroyHands();
    await new Promise(resolve => setTimeout(resolve, 100));

    // Only stop camera if voice is also disabled
    const voiceEnabled = localStorage.getItem('voiceCommandsEnabled') === 'on';
    if (!voiceEnabled) {
      await stopCamera();
    }

    // Update hands-free button
    if (handsFreeBtn) handsFreeBtn.textContent = 'Enable Hands Free Mode';

    console.log('[App] Hand cursor disabled');
  } else {
    // Enable hand cursor
    console.log('[App] Enabling hand cursor...');

    try {
      // Start camera if not already started
      await initCamera();
      await initHands(getVideoEl());
      setBrowseMode(true); // Enable browse mode for grab detection

      cursor.style.display = 'block';
      handsFreeModeEnabled = true;
      handsFreeModeInitialized = true;
      localStorage.setItem('handCursorEnabled', 'on');
      toggleBtn.classList.add('active');

      // Update hands-free button if both are now enabled
      const voiceEnabled = localStorage.getItem('voiceCommandsEnabled') === 'on';
      if (handsFreeBtn && voiceEnabled) {
        handsFreeBtn.textContent = 'Disable Hands Free Mode';
      }

      console.log('[App] Hand cursor enabled');
    } catch (error) {
      console.error('[App] Failed to enable hand cursor:', error);
      cursor.style.display = 'none';
      handsFreeModeEnabled = false;
      handsFreeModeInitialized = false;
      localStorage.setItem('handCursorEnabled', 'off');
      toggleBtn.classList.remove('active');
    }
  }
}

async function toggleVoiceCommands() {
  const toggleBtn = document.getElementById('toggle-voice-btn');
  const handsFreeBtn = document.getElementById('toggle-hands-free-btn');
  const voiceEnabled = localStorage.getItem('voiceCommandsEnabled') === 'on';

  if (voiceEnabled) {
    // Disable voice commands
    console.log('[App] Disabling voice commands...');
    continuousListening = false;
    localStorage.setItem('voiceCommandsEnabled', 'off');
    toggleBtn.classList.remove('active');

    // Stop voice recognition
    if (recognition) {
      try {
        console.log('[App] Stopping voice recognition...');
        isListening = false;
        recognition.stop();
        recognition.abort(); // Force abort to ensure it stops
        recognition = null;
        console.log('[App] Voice recognition stopped');
      } catch (err) {
        console.warn('[App] Error stopping voice recognition:', err);
      }
    }

    // Only stop camera if hand cursor is also disabled
    const handCursorEnabled = localStorage.getItem('handCursorEnabled') === 'on';
    if (!handCursorEnabled) {
      await stopCamera();
    }

    // Update hands-free button
    if (handsFreeBtn) handsFreeBtn.textContent = 'Enable Hands Free Mode';

    console.log('[App] Voice commands disabled');
  } else {
    // Enable voice commands
    console.log('[App] Enabling voice commands...');

    try {
      // Start camera if not already started
      await initCamera();

      // Start continuous voice recognition
      const voiceInitialized = initVoiceRecognition(true);
      if (voiceInitialized) {
        recognition.start();
        continuousListening = true;
        localStorage.setItem('voiceCommandsEnabled', 'on');
        toggleBtn.classList.add('active');

        // Update hands-free button if both are now enabled
        const handCursorEnabled = localStorage.getItem('handCursorEnabled') === 'on';
        if (handsFreeBtn && handCursorEnabled) {
          handsFreeBtn.textContent = 'Disable Hands Free Mode';
        }

        console.log('[App] Voice commands enabled');
      } else {
        throw new Error('Voice recognition not available');
      }
    } catch (error) {
      console.error('[App] Failed to enable voice commands:', error);
      continuousListening = false;
      localStorage.setItem('voiceCommandsEnabled', 'off');
      toggleBtn.classList.remove('active');
    }
  }
}

async function startHandsFreeMode() {
  console.log('[App] Starting hands free mode...');

  // Start camera and hand tracking
  await initCamera();
  await initHands(getVideoEl());
  setBrowseMode(true); // Enable browse mode for grab detection
  console.log('[App] Hand tracking initialized successfully');

  // Start continuous voice recognition
  const voiceInitialized = initVoiceRecognition(true);
  if (voiceInitialized) {
    recognition.start();
    console.log('[App] Continuous voice recognition started');
  } else {
    console.warn('[App] Voice recognition not available, continuing with hand tracking only');
  }

  console.log('[App] Hands free mode initialized successfully');
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

  // Reset hands free mode state and UI
  handsFreeModeEnabled = false;
  handsFreeModeInitialized = false;
  continuousListening = false;
  localStorage.setItem('handCursorEnabled', 'off');
  localStorage.setItem('voiceCommandsEnabled', 'off');
  if (cursor) cursor.style.display = 'none';

  const toggleCursorBtn = document.getElementById('toggle-cursor-btn');
  const toggleVoiceBtn = document.getElementById('toggle-voice-btn');
  if (toggleCursorBtn) toggleCursorBtn.classList.remove('active');
  if (toggleVoiceBtn) toggleVoiceBtn.classList.remove('active');

  // Stop voice recognition
  if (recognition && isListening) {
    recognition.stop();
    recognition = null;
  }

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
        // Generate and save spine color using theme-based color system
        if (!book.spineColor) {
          book.spineColor = getBookColor(book.id || book.isbn, book.title, book.series);
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
    if (!cursor) return;

    // Ensure cursor is visible
    if (cursor.style.display !== 'block') {
      cursor.style.display = 'block';
    }

    // Check if cursor is trapped in a hidden or closed element
    const parent = cursor.parentElement;
    if (parent && parent !== document.body) {
      // Check if parent is a dialog that's not open, or has display:none/hidden class
      const isHiddenDialog = parent.tagName === 'DIALOG' && !parent.open;
      const isHidden = parent.classList.contains('hidden') ||
                      parent.getAttribute('aria-hidden') === 'true' ||
                      window.getComputedStyle(parent).display === 'none';

      // If parent is hidden, closed, or not an open dialog, move cursor back to body
      // Exception: keep cursor in open dialogs (they're in the top layer)
      if (isHiddenDialog || (isHidden && !(parent.tagName === 'DIALOG' && parent.open))) {
        document.body.appendChild(cursor);
      }
    }

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

async function ensureBookColors() {
  console.log('[App] Ensuring all books have spine colors...');
  const books = await storage.getBooks();
  let updated = 0;

  for (const book of books) {
    if (!book.spineColor) {
      book.spineColor = getBookColor(book.id || book.isbn, book.title, book.series);
      await storage.addBook(book);
      updated++;
      console.log('[App] Added color to:', book.title, '→', book.spineColor);
    }
  }

  if (updated > 0) {
    console.log('[App] Updated', updated, 'books with spine colors');
    return true;
  }
  return false;
}

// Authentication handlers
async function handleLogin() {
  try {
    console.log('[App] Attempting Google login...');
    await loginWithGoogle();
    await showNotification('Successfully signed in!', '✅');
  } catch (error) {
    console.error('[App] Login error:', error);
    await showNotification('Failed to sign in. Please try again.', '❌');
  }
}

async function handleLogout() {
  try {
    console.log('[App] Logging out...');
    await logout();
    await showNotification('Signed out successfully', '👋');
  } catch (error) {
    console.error('[App] Logout error:', error);
    await showNotification('Failed to sign out. Please try again.', '❌');
  }
}

function updateAuthUI(user) {
  const loginBtn = document.getElementById('login-btn');
  const userInfo = document.getElementById('user-info');
  const userEmail = document.getElementById('user-email');
  const signinModal = document.getElementById('signin-modal');
  const settingsMenu = document.getElementById('settings-menu');

  if (user) {
    // User is logged in
    console.log('[App] User logged in:', user.email);
    loginBtn?.classList.add('hidden');
    userInfo?.classList.remove('hidden');
    if (userEmail) userEmail.textContent = user.email;

    // Close sign-in modal if open
    if (signinModal && signinModal.open) {
      signinModal.close();
    }
  } else {
    // User is logged out
    console.log('[App] User logged out');
    loginBtn?.classList.remove('hidden');
    userInfo?.classList.add('hidden');

    // Close settings menu if open
    if (settingsMenu && !settingsMenu.classList.contains('hidden')) {
      settingsMenu.classList.add('hidden');
    }

    // Show sign-in modal
    if (signinModal && !signinModal.open) {
      signinModal.showModal();
    }
  }
}

async function boot() {
  await registerSW();
  initUI();
  setupControls();
  setupEvents();

  // Show sign-in modal immediately if not authenticated
  const signinModal = document.getElementById('signin-modal');
  const settingsMenu = document.getElementById('settings-menu');
  const currentUser = getCurrentUser();

  if (!currentUser) {
    // Close menu and show sign-in modal
    if (settingsMenu) {
      settingsMenu.classList.add('hidden');
    }
    if (signinModal) {
      signinModal.showModal();
    }
  }

  // Set up authentication state listener
  onAuthChange(async (user) => {
    updateAuthUI(user);

    if (user) {
      // User is logged in - load their library
      console.log('[App] Loading library for user:', user.email);

      // Run migration to fix existing books without series info
      const migrated = await migrateExistingBooks();

      // Ensure all books have spine colors
      await ensureBookColors();

      const books = await storage.getBooks();
      console.log('[App] Found', books.length, 'books in storage');
      hydrateBooks(books);
    } else {
      // User is logged out - clear the library view
      console.log('[App] User logged out - clearing library view');
      hydrateBooks([]);
    }
  });

  // Add resize listener for bookshelf theme responsiveness
  let resizeTimeout;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(async () => {
      const books = await storage.getBooks();
      hydrateBooks(books);
    }, 300); // Debounce resize
  });

  // Restore hand cursor and voice commands from previous session if they were enabled
  const handCursorWasEnabled = localStorage.getItem('handCursorEnabled') === 'on';
  const voiceWasEnabled = localStorage.getItem('voiceCommandsEnabled') === 'on';

  if (handCursorWasEnabled || voiceWasEnabled) {
    console.log('[App] Restoring features from previous session...');

    if (handCursorWasEnabled) {
      console.log('[App] Restoring hand cursor...');
      await toggleHandCursor();
    }

    if (voiceWasEnabled) {
      console.log('[App] Restoring voice commands...');
      await toggleVoiceCommands();
    }
  } else {
    console.log('[App] Hand cursor and voice commands are opt-in. Use the toggle buttons to enable.');
  }
}

boot();
