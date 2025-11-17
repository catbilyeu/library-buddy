// Firebase configuration and initialization
import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, collection, doc, setDoc, getDoc, getDocs, deleteDoc, query, where } from 'firebase/firestore';

// Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyCPsNVgdk_z-OwODV6xi6XxOffgWR8JFbM",
  authDomain: "library-buddy-93011.firebaseapp.com",
  projectId: "library-buddy-93011",
  storageBucket: "library-buddy-93011.firebasestorage.app",
  messagingSenderId: "796605961404",
  appId: "1:796605961404:web:9e15ac9092ce91c6b0ecb9",
  measurementId: "G-D81T64H8DF"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const googleProvider = new GoogleAuthProvider();

// Authentication functions
export async function loginWithGoogle() {
  try {
    const result = await signInWithPopup(auth, googleProvider);
    console.log('[Firebase] User logged in:', result.user.email);
    return result.user;
  } catch (error) {
    console.error('[Firebase] Login error:', error);
    throw error;
  }
}

export async function logout() {
  try {
    await signOut(auth);
    console.log('[Firebase] User logged out');
  } catch (error) {
    console.error('[Firebase] Logout error:', error);
    throw error;
  }
}

export function onAuthChange(callback) {
  return onAuthStateChanged(auth, callback);
}

export function getCurrentUser() {
  return auth.currentUser;
}

// Firestore database functions
export async function addBook(userId, book) {
  try {
    const bookId = book.id || book.isbn;
    await setDoc(doc(db, 'users', userId, 'books', bookId), {
      ...book,
      updatedAt: new Date().toISOString()
    });
    console.log('[Firebase] Book added:', bookId);
  } catch (error) {
    console.error('[Firebase] Error adding book:', error);
    throw error;
  }
}

export async function getBooks(userId) {
  try {
    const booksRef = collection(db, 'users', userId, 'books');
    const snapshot = await getDocs(booksRef);
    const books = [];
    snapshot.forEach(doc => {
      books.push(doc.data());
    });
    console.log('[Firebase] Fetched', books.length, 'books');
    return books;
  } catch (error) {
    console.error('[Firebase] Error fetching books:', error);
    throw error;
  }
}

export async function removeBook(userId, bookId) {
  try {
    await deleteDoc(doc(db, 'users', userId, 'books', bookId));
    console.log('[Firebase] Book removed:', bookId);
  } catch (error) {
    console.error('[Firebase] Error removing book:', error);
    throw error;
  }
}

export async function getBook(userId, bookId) {
  try {
    const bookDoc = await getDoc(doc(db, 'users', userId, 'books', bookId));
    if (bookDoc.exists()) {
      return bookDoc.data();
    }
    return null;
  } catch (error) {
    console.error('[Firebase] Error fetching book:', error);
    throw error;
  }
}

export async function updateBook(userId, bookId, updates) {
  try {
    const bookRef = doc(db, 'users', userId, 'books', bookId);
    await setDoc(bookRef, {
      ...updates,
      updatedAt: new Date().toISOString()
    }, { merge: true });
    console.log('[Firebase] Book updated:', bookId);
  } catch (error) {
    console.error('[Firebase] Error updating book:', error);
    throw error;
  }
}

export { auth, db };
