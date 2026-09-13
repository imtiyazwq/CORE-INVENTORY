// src/services/apiConfig.ts
//
// Base URL for the Flask API. Empty string locally — Vite's dev server
// proxies /api/* to Flask (see vite.config.ts), so a bare relative path
// works. In production (Vercel) there's no such proxy, so VITE_API_URL must
// be set to the deployed Flask backend's origin (e.g.
// "https://core-inventory-api.onrender.com", no trailing slash).
export const API_BASE_URL = (import.meta.env.VITE_API_URL || '').replace(/\/+$/, '');
