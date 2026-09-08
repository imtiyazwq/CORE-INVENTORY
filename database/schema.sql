-- Database Schema Specification (`inventory_system.db`)
-- Multi-Store Inventory Image Detection & Stock Verification System

PRAGMA foreign_keys = ON;

-- ==========================================
-- 0. USERS TABLE
-- Operator & Staff Accounts for Authentication & Accountability
-- ==========================================
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL UNIQUE,       -- e.g. "aminah01"
    password_hash TEXT NOT NULL,       -- Stored via secure hashing (e.g. werkzeug / pbkdf2)
    full_name TEXT NOT NULL,           -- e.g. "Aminah binti Rosli"
    team TEXT NOT NULL,                -- e.g. "Marketing" or "Warehouse Team A"
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Index for rapid User ID lookups during authentication
CREATE INDEX IF NOT EXISTS idx_users_user_id ON users(user_id);

-- ==========================================
-- 1. STORES TABLE
-- ==========================================
CREATE TABLE IF NOT EXISTS stores (
    store_id INTEGER PRIMARY KEY AUTOINCREMENT,
    store_name TEXT NOT NULL UNIQUE,
    location_type TEXT NOT NULL CHECK (location_type IN ('online', 'offline_capable')),
    sync_status TEXT NOT NULL DEFAULT 'online' CHECK (sync_status IN ('online', 'offline', 'syncing'))
);

-- ==========================================
-- 2. CATEGORIES TABLE
-- ==========================================
CREATE TABLE IF NOT EXISTS categories (
    category_id INTEGER PRIMARY KEY AUTOINCREMENT,
    category_name TEXT NOT NULL UNIQUE
);

-- ==========================================
-- 3. PRODUCTS TABLE
-- ==========================================
CREATE TABLE IF NOT EXISTS products (
    product_id INTEGER PRIMARY KEY AUTOINCREMENT,
    sku TEXT NOT NULL UNIQUE,
    product_name TEXT NOT NULL,
    category_id INTEGER NOT NULL,
    unit_price REAL NOT NULL DEFAULT 0.0 CHECK (unit_price >= 0.0),
    FOREIGN KEY (category_id) REFERENCES categories (category_id) ON DELETE RESTRICT ON UPDATE CASCADE
);

-- ==========================================
-- 4. STORE INVENTORY TABLE
-- Composite Primary Key: (store_id, product_id)
-- ==========================================
CREATE TABLE IF NOT EXISTS store_inventory (
    store_id INTEGER NOT NULL,
    product_id INTEGER NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0),
    last_synced_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (store_id, product_id),
    FOREIGN KEY (store_id) REFERENCES stores (store_id) ON DELETE CASCADE ON UPDATE CASCADE,
    FOREIGN KEY (product_id) REFERENCES products (product_id) ON DELETE RESTRICT ON UPDATE CASCADE
);

-- ==========================================
-- 5. IMAGE DETECTIONS LOG TABLE
-- Immutable Audit Log of Computer Vision Model Outputs with User Accountability
-- ==========================================
CREATE TABLE IF NOT EXISTS image_detections_log (
    detection_id INTEGER PRIMARY KEY AUTOINCREMENT,
    store_id INTEGER NOT NULL,
    product_id INTEGER NOT NULL,
    detected_quantity INTEGER NOT NULL,
    confidence_score REAL NOT NULL CHECK (confidence_score BETWEEN 0.0 AND 1.0),
    image_path TEXT NOT NULL,
    created_by_user_id TEXT REFERENCES users(user_id),
    team TEXT,
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    processed_status TEXT NOT NULL DEFAULT 'pending' CHECK (processed_status IN ('pending', 'verified', 'conflict')),
    FOREIGN KEY (store_id) REFERENCES stores (store_id) ON DELETE RESTRICT ON UPDATE CASCADE,
    FOREIGN KEY (product_id) REFERENCES products (product_id) ON DELETE RESTRICT ON UPDATE CASCADE,
    FOREIGN KEY (created_by_user_id) REFERENCES users (user_id) ON DELETE SET NULL ON UPDATE CASCADE
);

-- ==========================================
-- 6. SYNC QUEUE TABLE
-- Offline Sync Queue for Store 3 and Store 4
-- ==========================================
CREATE TABLE IF NOT EXISTS sync_queue (
    queue_id INTEGER PRIMARY KEY AUTOINCREMENT,
    store_id INTEGER NOT NULL,
    payload_json TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'synced', 'failed')),
    FOREIGN KEY (store_id) REFERENCES stores (store_id) ON DELETE CASCADE ON UPDATE CASCADE
);

-- ==========================================
-- PERFORMANCE INDEXES
-- ==========================================
CREATE INDEX IF NOT EXISTS idx_products_sku ON products(sku);
CREATE INDEX IF NOT EXISTS idx_store_inventory_product ON store_inventory(product_id);
CREATE INDEX IF NOT EXISTS idx_detections_store_status ON image_detections_log(store_id, processed_status);
CREATE INDEX IF NOT EXISTS idx_detections_timestamp ON image_detections_log(timestamp);
CREATE INDEX IF NOT EXISTS idx_sync_queue_store_status ON sync_queue(store_id, status);
