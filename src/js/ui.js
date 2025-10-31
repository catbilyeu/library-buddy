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
  for (let i = 0; i < 3; i++) {
    const shelf = document.createElement('div');
    shelf.className = 'shelf';
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

export function renderBook(book) {
  // Find a shelf with room (cycle through shelves)
  const shelfEls = document.querySelectorAll('.shelf');
  const bookCount = document.querySelectorAll('.book-tile').length;
  const targetIndex = bookCount % shelfEls.length;
  const target = shelfEls[targetIndex] || shelfEls[0] || shelves();

  const tile = document.createElement('div');
  tile.className = 'book-tile';
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
  const seriesLabel = book.series && book.seriesNumber
    ? `<div class="series-badge">#${book.seriesNumber}</div>`
    : '';

  tile.innerHTML = `
    <div class="spine" style="background: linear-gradient(to right, ${spineColor} 0%, ${adjustBrightness(spineColor, 1.2)} 50%, ${spineColor} 100%) !important; background-size: auto !important;"></div>
    ${seriesLabel}
    <div class="title">${truncate(book.title || 'Untitled', 30)}</div>
    <div class="author">${truncate(book.author || '', 25)}</div>
  `;

  // Add click handler
  tile.addEventListener('click', () => {
    const id = tile.getAttribute('data-id');
    const title = tile.getAttribute('data-title');
    const author = tile.getAttribute('data-author');
    const cover = tile.getAttribute('data-cover');
    const color = tile.getAttribute('data-color');
    openBookModal({ id, title, author, cover, color });
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

export function setSortMode(mode) {
  currentSortMode = mode;
  localStorage.setItem('librarySortMode', mode);
}

export function getSortMode() {
  return currentSortMode;
}

export function hydrateBooks(books = []) {
  // Clear shelves then render
  initUI();

  console.log('[UI] Sorting books by:', currentSortMode);

  let sortedBooks = [...books];

  switch (currentSortMode) {
    case 'author':
      sortedBooks.sort((a, b) => {
        const authorA = (a.author || 'Unknown').toLowerCase();
        const authorB = (b.author || 'Unknown').toLowerCase();
        return authorA.localeCompare(authorB);
      });
      sortedBooks.forEach(renderBook);
      break;

    case 'genre':
      const genreGroups = new Map();
      sortedBooks.forEach(book => {
        const genre = book.genre || 'Uncategorized';
        if (!genreGroups.has(genre)) {
          genreGroups.set(genre, []);
        }
        genreGroups.get(genre).push(book);
      });
      // Sort by genre name, then render
      Array.from(genreGroups.keys()).sort().forEach(genre => {
        genreGroups.get(genre).forEach(renderBook);
      });
      break;

    case 'color':
      sortedBooks.sort((a, b) => {
        const colorA = a.spineColor || '#000000';
        const colorB = b.spineColor || '#000000';
        return colorA.localeCompare(colorB);
      });
      sortedBooks.forEach(renderBook);
      break;

    case 'series':
    default:
      // Group books by series
      const grouped = new Map();
      const standalone = [];

      books.forEach(book => {
        if (book.series) {
          if (!grouped.has(book.series)) {
            grouped.set(book.series, []);
          }
          grouped.get(book.series).push(book);
        } else {
          standalone.push(book);
        }
      });

      // Sort series books by series number
      grouped.forEach(seriesBooks => {
        seriesBooks.sort((a, b) => {
          const numA = a.seriesNumber || 0;
          const numB = b.seriesNumber || 0;
          return numA - numB;
        });
      });

      // Render series books first (grouped together)
      grouped.forEach((seriesBooks, seriesName) => {
        console.log('[UI] Rendering series:', seriesName, 'with', seriesBooks.length, 'books');
        seriesBooks.forEach(book => renderBook(book));
      });

      // Then render standalone books
      standalone.forEach(renderBook);
      break;
  }
}

export function highlightAtCursor({ x, y }) {
  document.querySelectorAll('.book-tile').forEach(el => el.classList.remove('highlight'));
  const el = document.elementFromPoint(x, y);
  const tile = el?.closest?.('.book-tile');
  if (tile) tile.classList.add('highlight');
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
  modalTitle().textContent = title || 'Untitled';
  modalAuthor().textContent = author || '';

  console.log('[UI] Opening modal for book:', { id, title, author, cover, color });

  // Get all alternative cover sources
  alternativeSources = getCoverAlternatives(id);
  coverSourceIndex = 0;

  if (cover && cover !== 'null' && cover !== 'undefined' && alternativeSources.length > 0) {
    console.log('[UI] Available cover sources:', alternativeSources);
    const coverImg = modalCover();

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
}

export function closeBookModal() {
  try {
    modal().close();
    currentBookId = null;
  } catch (_) {}
}
