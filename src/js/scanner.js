/**
 * Scanning utilities for real books via the webcam.
 * Strategy:
 * 1) Prefer the native BarcodeDetector API (fast, no overlays)
 * 2) Fallback to ZXing (@zxing/browser) decoding directly from the provided video element
 * 3) Provide OCR helpers as a last resort
 */

let listeners = { isbn: [] };
let running = false;
let rafId = null;
let pauseUntil = 0;

// ZXing fallback
let zxingReader = null;
let zxingControls = null;

export function onIsbnDetected(fn) { listeners.isbn.push(fn); }

function emitIsbn(code) {
  if (!code) return;
  // Basic ISBN/EAN-13 guard
  if (/^\d{13}$/.test(code)) {
    listeners.isbn.forEach((fn) => fn(code));
  }
}

async function tryBarcodeDetector(videoEl) {
  // Detect support
  // eslint-disable-next-line no-undef
  if (typeof window.BarcodeDetector !== 'function') return false;
  let formats = [];
  try {
    // @ts-ignore
    formats = await window.BarcodeDetector.getSupportedFormats?.();
  } catch (_) {
    // ignore
  }
  const preferred = ['ean_13', 'ean_8', 'upc_a', 'isbn'];
  const useFormats = formats?.length ? preferred.filter((f) => formats.includes(f)) : ['ean_13'];
  if (!useFormats.length) useFormats.push('ean_13');

  // @ts-ignore
  const detector = new window.BarcodeDetector({ formats: useFormats });

  const loop = async () => {
    if (!running) return;
    const now = Date.now();
    if (now < pauseUntil) { rafId = requestAnimationFrame(loop); return; }
    try {
      const codes = await detector.detect(videoEl);
      if (codes && codes.length) {
        const text = codes[0]?.rawValue || codes[0]?.raw || '';
        if (text) {
          emitIsbn(text);
          // Pause briefly to prevent floods
          pauseUntil = Date.now() + 2000;
        }
      }
    } catch (e) {
      // swallow detector errors
    }
    rafId = requestAnimationFrame(loop);
  };

  running = true;
  loop();
  return true;
}

async function tryZXing(videoEl) {
  try {
    const mod = await import('https://cdn.jsdelivr.net/npm/@zxing/browser@0.1.1/esm/index.min.js');
    const { BrowserMultiFormatReader } = mod;
    // Hints are optional; EAN_13 by default works well
    zxingReader = new BrowserMultiFormatReader();
    zxingControls = await zxingReader.decodeFromVideoDevice(
      undefined,
      videoEl,
      (result, err, controls) => {
        if (result) {
          emitIsbn(result.getText());
          // Pause scans for a bit
          pauseUntil = Date.now() + 2000;
        }
        // NotFoundException is normal while scanning; ignore err
      }
    );
    running = true;
    return true;
  } catch (e) {
    console.warn('[Scanner] ZXing init failed', e);
    return false;
  }
}

/**
 * Initialize a continuous ISBN scanner from the given video element.
 * Uses BarcodeDetector when available, ZXing fallback otherwise.
 */
export async function initBarcodeScanner(videoEl) {
  console.log('[Scanner] Initializing barcode scanner with video element:', videoEl);
  await stopBarcodeScanner();
  pauseUntil = 0;
  // Prefer native
  console.log('[Scanner] Trying BarcodeDetector...');
  const okNative = await tryBarcodeDetector(videoEl);
  if (okNative) {
    console.log('[Scanner] BarcodeDetector initialized successfully');
    return;
  }
  // Fallback ZXing
  console.log('[Scanner] BarcodeDetector not available, trying ZXing...');
  const okZXing = await tryZXing(videoEl);
  if (okZXing) {
    console.log('[Scanner] ZXing initialized successfully');
    return;
  }
  console.warn('[Scanner] No supported real-time barcode method available. Consider OCR.');
}

export async function stopBarcodeScanner() {
  running = false;
  if (rafId) cancelAnimationFrame(rafId);
  rafId = null;
  // Stop ZXing if active
  try {
    if (zxingControls && typeof zxingControls.stop === 'function') zxingControls.stop();
  } catch (_) {}
  try {
    if (zxingReader && typeof zxingReader.reset === 'function') zxingReader.reset();
  } catch (_) {}
  zxingControls = null;
  zxingReader = null;
}

// OCR fallback (helper)
let tesseractLoaded = false;
function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.crossOrigin = 'anonymous';
    s.onload = () => resolve();
    s.onerror = (e) => reject(e);
    document.head.appendChild(s);
  });
}

export async function ocrFromFrame(imageData) {
  if (!tesseractLoaded) {
    await loadScript('https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js');
    tesseractLoaded = true;
  }
  // eslint-disable-next-line no-undef
  const { Tesseract } = window;
  const worker = await Tesseract.createWorker('eng');
  const { data } = await worker.recognize(imageData);
  await worker.terminate();
  const text = data?.text || '';
  return heuristicsFromText(text);
}

function heuristicsFromText(text) {
  const lines = text.split(/\n+/).map((s) => s.trim()).filter(Boolean);
  let title = lines[0] || '';
  let author = '';
  for (const l of lines.slice(1)) {
    if (/by\s+/i.test(l) || /[A-Z][a-z]+\s+[A-Z][a-z]+/.test(l)) {
      author = l.replace(/^by\s+/i, '').trim();
      break;
    }
  }
  return { title, author };
}
