# Library Buddy 📚✨

A magical hands-free library catalog with Firebase authentication, webcam scanning, and hand gesture controls. Track your personal book collection with multi-user support.

## 🚀 Quick Start

### Prerequisites
- Node.js installed
- Firebase project set up (see setup below)

### Installation & Running

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Visit http://localhost:3000
```

### Firebase Setup

1. Create a Firebase project at [console.firebase.google.com](https://console.firebase.google.com)
2. Enable **Google Authentication** in Authentication → Sign-in methods
3. Create **Firestore Database** in production mode
4. Add the security rules from `firestore.rules` to Firestore → Rules
5. Your Firebase config is already in `src/js/firebase.js`

## ✨ Features

### Authentication & Storage
- 🔐 **Google Sign-In** - Secure authentication
- 👥 **Multi-User Support** - Each user has their own private library
- ☁️ **Cloud Storage** - Books stored in Firebase Firestore
- 🔒 **Data Privacy** - Security rules ensure users only access their own data

### Book Management
- 📸 **Barcode Scanning** - Use webcam to scan ISBN barcodes (BarcodeDetector API + ZXing fallback)
- 🔤 **OCR Support** - Tesseract.js for title/author detection
- 🏷️ **Organization** - Sort by series, author, genre, or color
- 📖 **Library Cards** - Track who borrowed your books and when
- ✏️ **Edit Series** - Manually edit series name and book number for any book
- 🔄 **Re-enrich Metadata** - Search Google Books to update author, cover, and series info
- 🎨 **Multiple Themes** - Witchy, Colorful, Minimal, or Bookshelf

### Hands-Free Mode
- ✋ **Hand Tracking** - MediaPipe Hands for cursor control
- 🖐️ **Gesture Controls** - Pinch/grab to select, wave to navigate
- 🎤 **Voice Commands** - Voice-controlled book borrowing
- 🎯 **Motion Cursor** - Magical floating cursor with animations

### Technical Features
- ⚡ **Vite** - Fast development with hot module replacement
- 📱 **PWA Ready** - Service worker for offline support
- 🎨 **Responsive** - Works on all screen sizes
- ♿ **Accessible** - ARIA labels and keyboard navigation

## 📁 Project Structure

```
library-buddy/
├── index.html              # Main entry point
├── vite.config.js         # Vite configuration
├── firestore.rules        # Firebase security rules
├── package.json           # Dependencies and scripts
├── public/                # Static assets
│   └── manifest.webmanifest
├── src/
│   ├── js/
│   │   ├── app.js        # Main application logic
│   │   ├── firebase.js   # Firebase config & auth
│   │   ├── storage.js    # Firestore data layer
│   │   ├── hand.js       # Hand tracking
│   │   ├── camera.js     # Webcam handling
│   │   ├── scanner.js    # Barcode/OCR scanning
│   │   ├── api.js        # Book API integration
│   │   └── ui.js         # UI rendering
│   └── styles/
│       ├── variables.css # Design tokens
│       ├── base.css      # Base styles
│       ├── theme.css     # Theme variations
│       └── components.css # Component styles
└── sw.js                  # Service worker
```

## 🎨 Design

### Color Palette
- **Dark Greens**: `#0f201a`, `#153328`, `#1c4535`
- **Wood Tones**: `#2a1b12`, `#3a2519`, `#4b3021`
- **Gold/Brass**: `#c8a452`
- **Accent**: `#8bd8bd` (magical teal)

### Typography
- System UI sans-serif stack for optimal performance

### Themes
- **Witchy** (default): Dark shelves with golden accents
- **Colorful**: Vibrant book spines
- **Minimal**: Clean and simple
- **Bookshelf**: Realistic wood shelves

## 🛠️ Development

### Scripts

```bash
npm run dev      # Start Vite dev server
npm run build    # Build for production
npm run preview  # Preview production build
npm run lint     # Run ESLint
```

### Adding Books

1. **Scan ISBN**: Click menu → Scan Books → Point camera at barcode
2. **Manual Entry**: Click menu → Enter ISBN manually
3. **Import**: Export/Import library as JSON

### Editing Book Metadata

1. **Edit Series**: Click any book → "✏️ Edit Series" → Update series name and book number
2. **Re-enrich Metadata**: Click any book → "🔄 Re-enrich Metadata" → Choose correct match from Google Books
   - Updates author, cover image, and series information automatically
   - Helpful for fixing incorrect metadata or adding missing series info

### Voice Commands (in Hands-Free Mode)

- "Borrow [book title]" - Open library card for a book
- "Stop scanner" - Close the scanner

## 📦 Dependencies

### Core
- `firebase` - Authentication and Firestore
- `vite` - Build tool and dev server

### Lazy-Loaded (CDN)
- MediaPipe Hands - Hand tracking
- Tesseract.js - OCR
- ZXing - Barcode scanning fallback
- idb - IndexedDB wrapper (for caching)

## 🚀 Deployment

### Build for Production

```bash
npm run build
```

The `dist/` folder will contain your production build.

### Deploy to Firebase Hosting

```bash
npm install -g firebase-tools
firebase login
firebase init hosting
firebase deploy
```

## 📝 Notes

- Heavy libraries are lazy-loaded on demand for fast initial load
- Camera permission required for scanning and hand tracking
- Best experienced with a rear-facing camera for scanning
- Works offline once cached (PWA)

## 🎯 Future Ideas

- [ ] Add book recommendations
- [ ] Social features (share collections)
- [ ] Reading progress tracking
- [ ] Book notes and ratings
- [ ] Export to Goodreads

## 🤝 Contributing

This is a personal project, but feel free to fork and customize!

## 📄 License

MIT

---

**Made with ✨ magic and 📚 books**
