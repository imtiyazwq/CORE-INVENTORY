// src/services/firebase.ts
import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore"; // Import Firestore, NOT analytics[cite: 1]

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