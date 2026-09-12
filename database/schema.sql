-- Database Schema (`inventory_system.db`)
-- CORE-INVENTORY System — Refactored (no YOLO/CV)
-- Aligned with [DATASET_FOR_AI_INNOVATOR] Inventory_Data_with_Photos.xlsx

PRAGMA foreign_keys = ON;

-- ==========================================
-- 0. USERS TABLE
-- Operator & Staff Accounts for Auth & Accountability
-- ==========================================
CREATE TABLE IF NOT EXISTS users (
    id              INTEGER  PRIMARY KEY AUTOINCREMENT,
    user_id         TEXT     NOT NULL UNIQUE,        -- e.g. "adam"
    password_hash   TEXT     NOT NULL,               -- werkzeug pbkdf2_sha256
    full_name       TEXT     NOT NULL,               -- e.g. "Adam Ibrahim"
    team            TEXT     NOT NULL DEFAULT '',    -- e.g. "IT"
    role            TEXT     NOT NULL DEFAULT 'Staff' CHECK (role IN ('Admin', 'Staff')),
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Fast lookup during authentication
CREATE INDEX IF NOT EXISTS idx_users_user_id ON users(user_id);

-- ==========================================
-- 1. USER LOGS TABLE
-- Immutable audit trail of LOGIN / LOGOUT events
-- ==========================================
CREATE TABLE IF NOT EXISTS user_logs (
    log_id      INTEGER   PRIMARY KEY AUTOINCREMENT,
    user_id     TEXT      NOT NULL,
    action      TEXT      NOT NULL CHECK (action IN ('LOGIN', 'LOGOUT')),
    timestamp   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users (user_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_user_logs_user_id ON user_logs(user_id);

-- ==========================================
-- 2. STORES TABLE
-- Physical / virtual storage locations (sourced from XLSX "Storage Location")
-- ==========================================
CREATE TABLE IF NOT EXISTS stores (
    store_id        INTEGER  PRIMARY KEY AUTOINCREMENT,
    store_name      TEXT     NOT NULL UNIQUE,         -- e.g. "CHEMICAL ROOM"
    location_type   TEXT     NOT NULL DEFAULT 'offline_capable'
                             CHECK (location_type IN ('online', 'offline_capable')),
    sync_status     TEXT     NOT NULL DEFAULT 'online'
                             CHECK (sync_status IN ('online', 'offline', 'syncing'))
);

-- ==========================================
-- 3. PRODUCTS TABLE
-- Master product catalog — sku is the natural primary key from XLSX "Item Code"
-- NOTE: unit_price DROPPED (not in XLSX dataset)
-- ==========================================
CREATE TABLE IF NOT EXISTS products (
    sku         TEXT    PRIMARY KEY,                  -- e.g. "L020"
    name        TEXT    NOT NULL,                     -- "Item Name"
    category    TEXT    NOT NULL DEFAULT '',          -- e.g. "Laboratory & Science Supplies"
    asset_type  TEXT    NOT NULL DEFAULT 'Consumable'
                        CHECK (asset_type IN ('Consumable', 'Controllable Asset', 'Non-Consumable'))
);

CREATE INDEX IF NOT EXISTS idx_products_sku ON products(sku);

-- ==========================================
-- 4. STORE INVENTORY TABLE
-- Per-store stock levels. Composite PK (sku, store_name).
-- NOTE: owner DROPPED — use user_id in inventory_logs for accountability
-- ==========================================
CREATE TABLE IF NOT EXISTS store_inventory (
    sku             TEXT    NOT NULL,
    store_name      TEXT    NOT NULL,
    qty             INTEGER NOT NULL DEFAULT 0 CHECK (qty >= 0),
    avail_qty       INTEGER NOT NULL DEFAULT 0 CHECK (avail_qty >= 0),
    status          TEXT    NOT NULL DEFAULT 'Available',
    last_stocktake  TEXT,                             -- "Last Stocktake Date" from XLSX (stored as ISO text)
    PRIMARY KEY (sku, store_name),
    FOREIGN KEY (sku)        REFERENCES products (sku)       ON DELETE CASCADE  ON UPDATE CASCADE,
    FOREIGN KEY (store_name) REFERENCES stores (store_name)  ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_store_inventory_store  ON store_inventory(store_name);
CREATE INDEX IF NOT EXISTS idx_store_inventory_sku    ON store_inventory(sku);

-- ==========================================
-- 5. INVENTORY LOGS TABLE
-- Transaction audit trail — IN / OUT / ADJUSTMENT operations
-- ==========================================
CREATE TABLE IF NOT EXISTS inventory_logs (
    log_id          INTEGER   PRIMARY KEY AUTOINCREMENT,
    sku             TEXT      NOT NULL,
    store_name      TEXT      NOT NULL,
    user_id         TEXT      NOT NULL,
    action          TEXT      NOT NULL CHECK (action IN ('IN', 'OUT', 'ADJUSTMENT')),
    qty_changed     INTEGER   NOT NULL,               -- positive = IN, negative = OUT
    timestamp       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (sku)        REFERENCES products (sku)       ON DELETE RESTRICT,
    FOREIGN KEY (store_name) REFERENCES stores (store_name)  ON DELETE RESTRICT,
    FOREIGN KEY (user_id)    REFERENCES users (user_id)      ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_inventory_logs_sku        ON inventory_logs(sku);
CREATE INDEX IF NOT EXISTS idx_inventory_logs_store      ON inventory_logs(store_name);
CREATE INDEX IF NOT EXISTS idx_inventory_logs_user       ON inventory_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_inventory_logs_timestamp  ON inventory_logs(timestamp);

-- ==========================================
-- 6. SYNC QUEUE TABLE
-- Offline mutation buffer for stores operating without connectivity
-- ==========================================
CREATE TABLE IF NOT EXISTS sync_queue (
    queue_id        INTEGER   PRIMARY KEY AUTOINCREMENT,
    store_id        INTEGER   NOT NULL,
    payload_json    TEXT      NOT NULL,               -- serialised transaction payload
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    status          TEXT      NOT NULL DEFAULT 'pending'
                              CHECK (status IN ('pending', 'synced', 'failed')),
    FOREIGN KEY (store_id) REFERENCES stores (store_id) ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_sync_queue_store_status ON sync_queue(store_id, status);
