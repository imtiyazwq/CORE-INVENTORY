// src/services/firebase.ts
import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore"; // Import Firestore, NOT analytics[cite: 1]
import { getAuth, signInAnonymously } from "firebase/auth";

const firebaseConfig = {
    apiKey: "AIzaSyCrWLmBLhNCk-J0wqkZAreMvNuweL_pmIQ",
    authDomain: "petrosainsteamb.firebaseapp.com",
    projectId: "petrosainsteamb",
    storageBucket: "petrosainsteamb.firebasestorage.app",
    messagingSenderId: "598838859366",
    appId: "1:598838859366:web:e33223e95e502b403f7fa7",
};

const app = initializeApp(firebaseConfig);

// Initialize and export Firestore database instance
export const db = getFirestore(app);

export const auth = getAuth(app);

// Firestore rules require request.auth != null on reads. This anonymous sign-in
// is NOT tied to the app's Flask login — it only blocks direct, unauthenticated
// scraping of the Firestore REST/SDK endpoint by anyone without the app loaded.
// Writes are blocked for all clients regardless (see firestore.rules); only the
// Flask backend's Admin SDK can write.
export const authReady: Promise<void> = signInAnonymously(auth)
  .then(() => undefined)
  .catch((err) => {
    console.error('[Firebase] Anonymous sign-in failed:', err);
  });