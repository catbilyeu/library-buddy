# Home Library Catalog

A hands-free(ish) webcam-driven catalog for your home library. Scan books to add them to your shelves, pan with your hand as a cursor, and pinch to select.

## Quick Start

- Serve locally (any static server works). For Python:
  
  ```bash
  cd /Users/cat/Documents/ai/library-buddy
  python3 -m http.server 8088
  ```

- Open http://localhost:8088/public/
- Grant camera permissions when prompted.

## Features
- Scan ISBN barcodes via webcam (QuaggaJS) to fetch metadata and cover from Open Library
- OCR fallback (Tesseract.js) to parse title/author
- Hand tracking (MediaPipe Hands) to move a magical cursor and pinch-to-grab
- Offline-ready app shell with IndexedDB persistence and service worker caching

## Notes
- Heavy libraries are lazy-loaded on demand.
- If your device lacks a rear camera, the app will still use the available camera.
- The OCR worker may require network access to download language data.

## Design Direction
- Dark green walls, dark wood shelves, brass/gold accents.
- Plants and witchy-inspired accents on the shelves.

## Development
- Linting: ESLint + Prettier configs included.
- Structure:
  - public/index.html
  - src/styles/*.css
  - src/js/*.js (modules)
  - src/js/worker/ocrWorker.js
  - sw.js


## Design

Palette
- Dark greens: #0f201a, #153328, #1c4535
- Woods: #2a1b12, #3a2519, #4b3021
- Brass: #c8a452
- Accent: #8bd8bd

Type
- System UI sans-serif stack (see base.css)

Assets
- assets/textures/wood.svg (tileable wood)
- assets/decor/moon.svg, star.svg, candle.svg, crystal.svg, herb.svg
