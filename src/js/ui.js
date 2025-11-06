/** UI helpers for rendering shelves and modal */

import { getCoverAlternatives } from './api.js';

const shelves = () => document.querySelector('[data-test-id="shelves"]');
const modal = () => document.getElementById('book-modal');
const modalTitle = () => document.querySelector('#book-modal .book-title');
const modalAuthor = () => document.querySelector('#book-modal .book-author');
const modalCover = () => document.querySelector('#book-modal .book-cover');

let currentBookId = null;
let coverSourceIndex = 0;
let alternativeSources = [];

export function getCurrentBookId() {
  return currentBookId;
}

export function initUI() {
  // Create a few starter shelf rows
  const container = shelves();
  container.innerHTML = '';
  container.setAttribute('role', 'list');
  for (let i = 0; i < 3; i++) {
    const shelf = document.createElement('div');
    shelf.className = 'shelf';
    shelf.setAttribute('role', 'group');
    container.appendChild(shelf);
  }
}

// Generate deterministic book color based on book ID/title
function getBookColor(bookId, title) {
  // Use book ID or title to generate a consistent color
  const seed = bookId || title || 'default';
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = ((hash << 5) - hash) + seed.charCodeAt(i);
    hash = hash & hash; // Convert to 32bit integer
  }

  const colors = [
    '#8B4513', '#A0522D', '#D2691E', // browns
    '#2F4F4F', '#556B2F', '#4B5320', // dark greens
    '#800020', '#8B0000', '#A52A2A', // burgundy/red
    '#1C3A4A', '#2C4F68', '#1E3A5F', // blues
    '#3B2F2F', '#4A4A4A', '#2B2B2B', // dark grays
    '#6B4423', '#8B6914', '#9B7653', // tan/ochre
  ];

  const index = Math.abs(hash) % colors.length;
  return colors[index];
}

export function renderBook(book, targetShelf = null) {
  // Use provided shelf or find one by cycling through shelves
  let target = targetShelf;
  if (!target) {
    const shelfEls = document.querySelectorAll('.shelf');
    if (shelfEls.length === 0) {
      console.error('[UI] No shelves found, cannot render book:', book.title);
      return;
    }
    const bookCount = document.querySelectorAll('.book-tile').length;
    const targetIndex = bookCount % shelfEls.length;
    target = shelfEls[targetIndex];
  }

  if (!target) {
    console.error('[UI] Target shelf is null/undefined for book:', book.title);
    return;
  }

  if (typeof target.appendChild !== 'function') {
    console.error('[UI] Target is not a DOM element:', target, 'for book:', book.title);
    return;
  }

  const tile = document.createElement('div');
  tile.className = 'book-tile';
  tile.setAttribute('role', 'listitem');
  tile.tabIndex = 0;
  tile.setAttribute('aria-label', `${book.title || 'Untitled'} by ${book.author || 'Unknown'}`);
  tile.setAttribute('data-id', book.id || book.isbn || '');
  tile.setAttribute('data-title', book.title || '');
  tile.setAttribute('data-author', book.author || '');
  if (book.coverUrl) tile.setAttribute('data-cover', book.coverUrl);

  // Use stored color if available, otherwise generate deterministically
  const spineColor = book.spineColor || getBookColor(book.id || book.isbn, book.title);

  // Store the color in data attribute so modal can use it
  tile.setAttribute('data-color', spineColor);

  // Store series info in data attributes
  if (book.series) {
    tile.setAttribute('data-series', book.series);
    if (book.seriesNumber) {
      tile.setAttribute('data-series-number', book.seriesNumber);
    }
  }

  // For now, always use colored spines (cover images on spines don't look good anyway)
  // We'll show the cover image only in the modal
  // Build DOM safely without innerHTML to avoid XSS
  const spine = document.createElement('div');
  spine.className = 'spine';
  spine.style.background = `linear-gradient(to right, ${spineColor} 0%, ${adjustBrightness(spineColor, 1.2)} 50%, ${spineColor} 100%)`;
  spine.style.backgroundSize = 'auto';

  if (book.series && book.seriesNumber) {
    const badge = document.createElement('div');
    badge.className = 'series-badge';
    badge.textContent = `#${book.seriesNumber}`;
    tile.appendChild(badge);
  }

  const titleEl = document.createElement('div');
  titleEl.className = 'title';
  titleEl.textContent = truncate(book.title || 'Untitled', 30);

  const authorEl = document.createElement('div');
  authorEl.className = 'author';
  authorEl.textContent = truncate(book.author || '', 25);

  tile.appendChild(spine);
  tile.appendChild(titleEl);
  tile.appendChild(authorEl);

  // Mouse/touch click handler
  tile.addEventListener('click', () => {
    const id = tile.getAttribute('data-id');
    const title = tile.getAttribute('data-title');
    const author = tile.getAttribute('data-author');
    const cover = tile.getAttribute('data-cover');
    const color = tile.getAttribute('data-color');
    openBookModal({ id, title, author, cover, color });
  });

  // Keyboard handlers for accessibility
  tile.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      const id = tile.getAttribute('data-id');
      const title = tile.getAttribute('data-title');
      const author = tile.getAttribute('data-author');
      const cover = tile.getAttribute('data-cover');
      const color = tile.getAttribute('data-color');
      openBookModal({ id, title, author, cover, color });
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      const deleteBtn = document.getElementById('delete-book');
      // Open modal first to confirm or use the existing delete flow
      const id = tile.getAttribute('data-id');
      const title = tile.getAttribute('data-title');
      const author = tile.getAttribute('data-author');
      const cover = tile.getAttribute('data-cover');
      const color = tile.getAttribute('data-color');
      openBookModal({ id, title, author, cover, color });
    } else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft' || e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      const tiles = Array.from(document.querySelectorAll('.book-tile'));
      const idx = tiles.indexOf(tile);
      let next = idx;
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = Math.min(tiles.length - 1, idx + 1);
      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = Math.max(0, idx - 1);
      tiles[next]?.focus();
    }
  });

  target.appendChild(tile);
}

function adjustBrightness(hex, factor) {
  const num = parseInt(hex.replace('#', ''), 16);
  const r = Math.min(255, Math.floor((num >> 16) * factor));
  const g = Math.min(255, Math.floor(((num >> 8) & 0x00FF) * factor));
  const b = Math.min(255, Math.floor((num & 0x0000FF) * factor));
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

function truncate(str, len) {
  return str.length > len ? str.substring(0, len - 1) + '…' : str;
}

let currentSortMode = 'series';
let currentPage = 1;
let totalPages = 1;
let allBooks = [];
const SHELVES_PER_PAGE = 3; // Number of shelves to show per page

export function setSortMode(mode) {
  currentSortMode = mode;
  localStorage.setItem('librarySortMode', mode);
}

export function getSortMode() {
  return currentSortMode;
}

export function setPage(page) {
  currentPage = Math.max(1, Math.min(page, totalPages));
  renderCurrentPage();
  updatePaginationUI();
}

export function nextPage() {
  if (currentPage < totalPages) {
    setPage(currentPage + 1);
  }
}

export function prevPage() {
  if (currentPage > 1) {
    setPage(currentPage - 1);
  }
}

function updatePaginationUI() {
  const prevBtn = document.getElementById('prev-page');
  const nextBtn = document.getElementById('next-page');
  const pageInfo = document.getElementById('page-info');

  if (prevBtn) prevBtn.disabled = currentPage === 1;
  if (nextBtn) nextBtn.disabled = currentPage === totalPages;
  if (pageInfo) pageInfo.textContent = `Page ${currentPage} of ${totalPages}`;
}

function renderCurrentPage() {
  const allShelves = Array.from(document.querySelectorAll('.shelf'));

  // Calculate which shelves to show
  const startIdx = (currentPage - 1) * SHELVES_PER_PAGE;
  const endIdx = startIdx + SHELVES_PER_PAGE;

  // Show/hide shelves based on current page
  allShelves.forEach((shelf, idx) => {
    if (idx >= startIdx && idx < endIdx) {
      shelf.style.display = 'flex';
    } else {
      shelf.style.display = 'none';
    }
  });
}

export function hydrateBooks(books = []) {
  console.log('[UI] Sorting books by:', currentSortMode);

  let sortedBooks = [...books];
  currentPage = 1; // Reset to first page when rehydrating

  switch (currentSortMode) {
    case 'author':
      // Sort by author's last name, then render across multiple shelves in chunks
      sortedBooks.sort((a, b) => {
        const getLastName = (fullName) => {
          if (!fullName || fullName === 'Unknown') return 'zzz'; // Put unknowns at end
          const parts = fullName.trim().split(' ');
          return parts[parts.length - 1].toLowerCase();
        };
        const lastNameA = getLastName(a.author);
        const lastNameB = getLastName(b.author);
        return lastNameA.localeCompare(lastNameB);
      });
      {
        const perShelf = 12;
        const container = shelves();
        container.innerHTML = '';
        container.setAttribute('role', 'list');
        const nShelves = Math.max(1, Math.ceil(sortedBooks.length / perShelf));
        for (let i = 0; i < nShelves; i++) {
          const shelf = document.createElement('div');
          shelf.className = 'shelf';
          shelf.setAttribute('role', 'group');
          container.appendChild(shelf);
        }
        const shelfEls = document.querySelectorAll('.shelf');
        sortedBooks.forEach((b, i) => renderBook(b, shelfEls[Math.floor(i / perShelf)]));
      }
      break;

    case 'genre':
      // Group by genre, render each genre on its own shelf
      {
        const container = shelves();
        container.innerHTML = '';
        container.setAttribute('role', 'list');
        const genreGroups = new Map();
        sortedBooks.forEach(book => {
          const genre = book.genre || 'Uncategorized';
          if (!genreGroups.has(genre)) genreGroups.set(genre, []);
          genreGroups.get(genre).push(book);
        });
        const genres = Array.from(genreGroups.keys()).sort();
        genres.forEach((genre) => {
          const shelf = document.createElement('div');
          shelf.className = 'shelf';
          shelf.setAttribute('role', 'group');
          shelf.setAttribute('aria-label', `Genre: ${genre}`);
          container.appendChild(shelf);
          genreGroups.get(genre).forEach((b) => renderBook(b, shelf));
        });
      }
      break;

    case 'color':
      // Sort by ROYGBIV + White, Brown, Grey, Black order
      {
        const toHsl = (hex) => {
          const n = parseInt((hex || '#000000').replace('#', ''), 16);
          const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
          const r1 = r/255, g1 = g/255, b1 = b/255;
          const max = Math.max(r1, g1, b1), min = Math.min(r1, g1, b1);
          let h, s, l = (max + min) / 2;
          if (max === min) { h = s = 0; }
          else {
            const d = max - min;
            s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
            switch (max) {
              case r1: h = (g1 - b1) / d + (g1 < b1 ? 6 : 0); break;
              case g1: h = (b1 - r1) / d + 2; break;
              case b1: h = (r1 - g1) / d + 4; break;
            }
            h /= 6;
          }
          return { h: h || 0, s: s || 0, l: l || 0 };
        };

        const getColorOrder = (hex) => {
          const hsl = toHsl(hex);
          const h = hsl.h * 360; // Convert to degrees
          const s = hsl.s;
          const l = hsl.l;

          // White (high lightness, low saturation)
          if (l > 0.85 && s < 0.2) return { category: 0, hue: h };

          // Black (low lightness)
          if (l < 0.15) return { category: 10, hue: h };

          // Grey (low saturation, medium lightness)
          if (s < 0.2 && l >= 0.15 && l <= 0.85) return { category: 9, hue: h };

          // Brown (orange/yellow hue with low lightness/saturation)
          if ((h >= 20 && h <= 45) && l < 0.5 && s < 0.7) return { category: 8, hue: h };

          // ROYGBIV order based on hue
          // Red: 0-15, 345-360
          if ((h >= 345 || h < 15) && s >= 0.2) return { category: 1, hue: h };
          // Orange: 15-45
          if (h >= 15 && h < 45 && s >= 0.2) return { category: 2, hue: h };
          // Yellow: 45-75
          if (h >= 45 && h < 75 && s >= 0.2) return { category: 3, hue: h };
          // Green: 75-165
          if (h >= 75 && h < 165 && s >= 0.2) return { category: 4, hue: h };
          // Blue: 165-255
          if (h >= 165 && h < 255 && s >= 0.2) return { category: 5, hue: h };
          // Indigo: 255-285
          if (h >= 255 && h < 285 && s >= 0.2) return { category: 6, hue: h };
          // Violet: 285-345
          if (h >= 285 && h < 345 && s >= 0.2) return { category: 7, hue: h };

          // Default fallback
          return { category: 9, hue: h };
        };

        sortedBooks.sort((a, b) => {
          const colorA = getColorOrder(a.spineColor || '#000000');
          const colorB = getColorOrder(b.spineColor || '#000000');

          // First sort by category (ROYGBIV order)
          if (colorA.category !== colorB.category) {
            return colorA.category - colorB.category;
          }

          // Within same category, sort by hue
          return colorA.hue - colorB.hue;
        });
        const perShelf = 12;
        const container = shelves();
        container.innerHTML = '';
        container.setAttribute('role', 'list');
        const nShelves = Math.max(1, Math.ceil(sortedBooks.length / perShelf));
        for (let i = 0; i < nShelves; i++) {
          const shelf = document.createElement('div');
          shelf.className = 'shelf';
          shelf.setAttribute('role', 'group');
          container.appendChild(shelf);
        }
        const shelfEls = document.querySelectorAll('.shelf');
        sortedBooks.forEach((b, i) => renderBook(b, shelfEls[Math.floor(i / perShelf)]));
      }
      break;

    case 'series':
    default:
      // Sort by author (last name), keeping series grouped together
      const getLastName = (fullName) => {
        if (!fullName || fullName === 'Unknown') return 'zzz';
        const parts = fullName.trim().split(' ');
        return parts[parts.length - 1].toLowerCase();
      };

      // Group by author first
      const byAuthor = new Map();
      books.forEach(book => {
        const author = book.author || 'Unknown';
        if (!byAuthor.has(author)) byAuthor.set(author, []);
        byAuthor.get(author).push(book);
      });

      // Within each author, group by series
      const sortedFlat = [];
      Array.from(byAuthor.keys())
        .sort((a, b) => getLastName(a).localeCompare(getLastName(b)))
        .forEach(author => {
          const authorBooks = byAuthor.get(author);

          // Group by series within this author
          const seriesMap = new Map();
          const standaloneBooks = [];

          authorBooks.forEach(book => {
            if (book.series) {
              if (!seriesMap.has(book.series)) seriesMap.set(book.series, []);
              seriesMap.get(book.series).push(book);
            } else {
              standaloneBooks.push(book);
            }
          });

          // Sort each series by series number
          seriesMap.forEach(seriesBooks => {
            seriesBooks.sort((a, b) => (a.seriesNumber || 0) - (b.seriesNumber || 0));
          });

          // Add series books (sorted alphabetically by series name)
          Array.from(seriesMap.keys()).sort().forEach(seriesName => {
            // Only add divider if there are already books in the list
            if (sortedFlat.length > 0) {
              sortedFlat.push({ type: 'divider', label: seriesName });
            }
            sortedFlat.push(...seriesMap.get(seriesName));
          });

          // Add standalone books for this author
          if (standaloneBooks.length > 0) {
            // Only add divider if there are already books in the list
            if (sortedFlat.length > 0) {
              sortedFlat.push({ type: 'divider', label: `${author} - Other` });
            }
            sortedFlat.push(...standaloneBooks);
          }
        });

      // Render with dividers - distribute across shelves with horizontal scrolling
      const container = shelves();
      container.innerHTML = '';
      container.setAttribute('role', 'list');

      // Estimate items per shelf based on screen width (no hard limit, just for distribution)
      const estimatedItemsPerShelf = Math.floor(window.innerWidth / 80); // Roughly 80px per book/divider
      const totalItems = sortedFlat.length;
      const nShelves = Math.max(3, Math.ceil(totalItems / estimatedItemsPerShelf));

      for (let i = 0; i < nShelves; i++) {
        const shelf = document.createElement('div');
        shelf.className = 'shelf';
        shelf.setAttribute('role', 'group');
        container.appendChild(shelf);
      }

      const shelfEls = document.querySelectorAll('.shelf');
      let currentShelfIndex = 0;
      let itemsOnCurrentShelf = 0;

      sortedFlat.forEach(item => {
        // Move to next shelf if we've exceeded the estimated items for this shelf
        if (itemsOnCurrentShelf >= estimatedItemsPerShelf && currentShelfIndex < nShelves - 1) {
          currentShelfIndex++;
          itemsOnCurrentShelf = 0;
        }

        if (item.type === 'divider') {
          // Add series divider
          const divider = document.createElement('div');
          divider.className = 'series-divider';
          divider.textContent = '❧';
          shelfEls[currentShelfIndex]?.appendChild(divider);
          itemsOnCurrentShelf++;
        } else {
          // Add book
          renderBook(item, shelfEls[currentShelfIndex]);
          itemsOnCurrentShelf++;
        }
      });
      break;
  }

  // Update pagination based on number of shelves rendered
  const shelfCount = document.querySelectorAll('.shelf').length;
  totalPages = Math.max(1, Math.ceil(shelfCount / SHELVES_PER_PAGE));
  currentPage = 1; // Reset to page 1 after rehydration
  renderCurrentPage(); // Show only first page of shelves
  updatePaginationUI();
}

export function highlightAtCursor({ x, y }) {
  // Remove book highlights
  document.querySelectorAll('.book-tile').forEach(el => el.classList.remove('highlight'));

  // Remove button highlights
  document.querySelectorAll('button').forEach(btn => btn.classList.remove('cursor-hover'));

  const el = document.elementFromPoint(x, y);

  // Highlight books
  const tile = el?.closest?.('.book-tile');
  if (tile) {
    tile.classList.add('highlight');
    return;
  }

  // Highlight buttons
  if (el && el.tagName === 'BUTTON') {
    el.classList.add('cursor-hover');
  }
}

function isImageBlankOrBlack(img) {
  // Create a canvas to analyze the image
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');

  canvas.width = img.naturalWidth || img.width;
  canvas.height = img.naturalHeight || img.height;

  try {
    ctx.drawImage(img, 0, 0);

    // Sample pixels from the center area
    const centerX = Math.floor(canvas.width / 2);
    const centerY = Math.floor(canvas.height / 2);
    const sampleSize = 20;

    const imageData = ctx.getImageData(
      Math.max(0, centerX - sampleSize),
      Math.max(0, centerY - sampleSize),
      Math.min(sampleSize * 2, canvas.width),
      Math.min(sampleSize * 2, canvas.height)
    );

    // Calculate average brightness
    let totalBrightness = 0;
    let pixelCount = 0;

    for (let i = 0; i < imageData.data.length; i += 4) {
      const r = imageData.data[i];
      const g = imageData.data[i + 1];
      const b = imageData.data[i + 2];
      const brightness = (r + g + b) / 3;
      totalBrightness += brightness;
      pixelCount++;
    }

    const avgBrightness = totalBrightness / pixelCount;

    // If average brightness is very low (< 10) or very high (> 245), likely placeholder
    const isBlank = avgBrightness < 10 || avgBrightness > 245;
    console.log('[UI] Image brightness analysis:', avgBrightness, 'isBlank:', isBlank);
    return isBlank;
  } catch (e) {
    console.warn('[UI] Could not analyze image:', e);
    return false; // If we can't analyze, assume it's okay
  }
}

function createPlaceholderCover(title, author, baseColor) {
  const canvas = document.createElement('canvas');
  canvas.width = 300;
  canvas.height = 450;
  const ctx = canvas.getContext('2d');

  // Use the same color as the spine
  const color1 = baseColor || '#3a5a40';
  const color2 = adjustBrightness(color1, 0.7); // Darker shade

  // Gradient background
  const gradient = ctx.createLinearGradient(0, 0, 0, 450);
  gradient.addColorStop(0, color1);
  gradient.addColorStop(1, color2);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 300, 450);

  // Border
  ctx.strokeStyle = 'rgba(200,164,82,0.3)';
  ctx.lineWidth = 3;
  ctx.strokeRect(10, 10, 280, 430);

  // Title
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 24px system-ui';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const words = (title || 'Untitled').split(' ');
  const lines = [];
  let currentLine = '';

  words.forEach(word => {
    const testLine = currentLine + word + ' ';
    const metrics = ctx.measureText(testLine);
    if (metrics.width > 260 && currentLine !== '') {
      lines.push(currentLine);
      currentLine = word + ' ';
    } else {
      currentLine = testLine;
    }
  });
  lines.push(currentLine);

  const startY = 150;
  lines.forEach((line, i) => {
    ctx.fillText(line.trim(), 150, startY + (i * 30));
  });

  // Author
  if (author) {
    ctx.font = 'italic 18px system-ui';
    ctx.fillStyle = 'rgba(200,164,82,0.9)';
    ctx.fillText(author, 150, 300);
  }

  return canvas.toDataURL();
}

function tryNextCoverSource(coverImg, title, author, color) {
  coverSourceIndex++;
  if (coverSourceIndex < alternativeSources.length) {
    const nextUrl = alternativeSources[coverSourceIndex];
    console.log(`[UI] Trying alternative source ${coverSourceIndex + 1}/${alternativeSources.length}:`, nextUrl);
    coverImg.crossOrigin = 'anonymous'; // Ensure CORS for next source too
    coverImg.src = nextUrl;
  } else {
    console.warn('[UI] All cover sources failed, using placeholder with color:', color);
    // Create a nice placeholder using the same color as the spine
    coverImg.crossOrigin = null;
    coverImg.src = createPlaceholderCover(title, author, color);
    coverImg.style.display = 'block';
  }
}

export function openBookModal({ id, title, author, cover, color }) {
  currentBookId = id;

  // Clear previous content immediately to prevent cached display
  const coverImg = modalCover();
  coverImg.style.display = 'none';
  coverImg.src = '';
  coverImg.onerror = null;
  coverImg.onload = null;

  modalTitle().textContent = title || 'Untitled';
  modalAuthor().textContent = author || '';

  console.log('[UI] Opening modal for book:', { id, title, author, cover, color });

  // Get all alternative cover sources
  alternativeSources = getCoverAlternatives(id);
  coverSourceIndex = 0;

  if (cover && cover !== 'null' && cover !== 'undefined' && alternativeSources.length > 0) {
    console.log('[UI] Available cover sources:', alternativeSources);

    // Enable CORS for canvas analysis
    coverImg.crossOrigin = 'anonymous';
    coverImg.src = alternativeSources[0];
    coverImg.style.display = 'block';

    // Add error handler with cascading fallbacks
    coverImg.onerror = () => {
      console.warn(`[UI] Cover source ${coverSourceIndex + 1} failed to load`);
      tryNextCoverSource(coverImg, title, author, color);
    };

    coverImg.onload = () => {
      console.log('[UI] Cover image loaded from source:', alternativeSources[coverSourceIndex]);

      // Check if the image is actually blank/black (common with placeholder images)
      if (isImageBlankOrBlack(coverImg)) {
        console.warn('[UI] Cover image is blank/black, trying next source');
        tryNextCoverSource(coverImg, title, author, color);
      } else {
        console.log('[UI] Cover image validated successfully');
      }
    };
  } else {
    console.warn('[UI] No cover URL provided, using placeholder');
    const coverImg = modalCover();
    coverImg.crossOrigin = null;
    coverImg.src = createPlaceholderCover(title, author, color);
    coverImg.style.display = 'block';
  }

  modal().showModal();

  // Move cursor to be inside the modal so it appears on top
  const cursor = document.getElementById('magic-cursor');
  if (cursor && !modal().contains(cursor)) {
    modal().appendChild(cursor);
  }
}

export function closeBookModal() {
  try {
    modal().close();
    currentBookId = null;

    // Move cursor back to body
    const cursor = document.getElementById('magic-cursor');
    if (cursor && modal().contains(cursor)) {
      document.body.appendChild(cursor);
    }
  } catch (_) {}
}
