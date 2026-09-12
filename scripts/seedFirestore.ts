/// <reference types="vite/client" />
// scripts/seedFirestore.js
import { initializeApp } from 'firebase/app';
import { getFirestore, doc, setDoc } from 'firebase/firestore';

const firebaseConfig = {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
    storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: import.meta.env.VITE_FIREBASE_APP_ID, // <-- Comma separates this key from any future keys (e.g., measurementId)
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// Sample item mapping matching your schema
async function seedCatalog() {
    const sampleProduct = {
        sku: "L020",
        name: "Acetone",
        category: "Chemicals",
        asset_type: "Consumable"
    };

    const sampleInventory = {
        sku: "L020",
        store_name: "CHEMICAL ROOM",
        qty: 10,
        avail_qty: 10,
        last_stocktake: new Date().toISOString()
    };

    // Seed Product
    await setDoc(doc(db, "products", sampleProduct.sku), sampleProduct);

    // Seed Store Inventory (Composite ID)
    await setDoc(doc(db, "store_inventory", `${sampleInventory.sku}_${sampleInventory.store_name}`), sampleInventory);

    console.log("Database seeded successfully!");
}

seedCatalog();