"""
init_db.py
Database Initialization & Seeding Script for Multi-Store Inventory System

Creates the SQLite database 'inventory_system.db' with complete schema,
foreign key enforcement, performance indexes, master product catalog,
store records, and baseline store inventory data.
"""

import sqlite3
import os
from typing import Optional

DB_PATH = os.path.join(os.path.dirname(__file__), "inventory_system.db")

SCHEMA_SQL = """
PRAGMA foreign_keys = ON;

-- 0. USERS TABLE (Staff & Operator Authentication & Accountability)
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL UNIQUE,       -- e.g. "aminah01"
    password_hash TEXT NOT NULL,       -- Stored via secure hash
    full_name TEXT NOT NULL,           -- e.g. "Aminah binti Rosli"
    team TEXT NOT NULL,                -- e.g. "Marketing" or "Warehouse Team A"
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_users_user_id ON users(user_id);

-- 1. STORES TABLE
CREATE TABLE IF NOT EXISTS stores (
    store_id INTEGER PRIMARY KEY AUTOINCREMENT,
    store_name TEXT NOT NULL UNIQUE,
    location_type TEXT NOT NULL CHECK (location_type IN ('online', 'offline_capable')),
    sync_status TEXT NOT NULL DEFAULT 'online' CHECK (sync_status IN ('online', 'offline', 'syncing'))
);

-- 2. CATEGORIES TABLE
CREATE TABLE IF NOT EXISTS categories (
    category_id INTEGER PRIMARY KEY AUTOINCREMENT,
    category_name TEXT NOT NULL UNIQUE
);

-- 3. PRODUCTS TABLE
CREATE TABLE IF NOT EXISTS products (
    product_id INTEGER PRIMARY KEY AUTOINCREMENT,
    sku TEXT NOT NULL UNIQUE,
    product_name TEXT NOT NULL,
    category_id INTEGER NOT NULL,
    unit_price REAL NOT NULL DEFAULT 0.0 CHECK (unit_price >= 0.0),
    FOREIGN KEY (category_id) REFERENCES categories (category_id) ON DELETE RESTRICT ON UPDATE CASCADE
);

-- 4. STORE INVENTORY TABLE (Composite PK: store_id, product_id)
CREATE TABLE IF NOT EXISTS store_inventory (
    store_id INTEGER NOT NULL,
    product_id INTEGER NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0),
    last_synced_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (store_id, product_id),
    FOREIGN KEY (store_id) REFERENCES stores (store_id) ON DELETE CASCADE ON UPDATE CASCADE,
    FOREIGN KEY (product_id) REFERENCES products (product_id) ON DELETE RESTRICT ON UPDATE CASCADE
);

-- 5. IMAGE DETECTIONS LOG TABLE (Immutable Audit Log with User/Team Accountability)
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

-- 6. SYNC QUEUE TABLE (For Offline Stores 3 & 4)
CREATE TABLE IF NOT EXISTS sync_queue (
    queue_id INTEGER PRIMARY KEY AUTOINCREMENT,
    store_id INTEGER NOT NULL,
    payload_json TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'synced', 'failed')),
    FOREIGN KEY (store_id) REFERENCES stores (store_id) ON DELETE CASCADE ON UPDATE CASCADE
);

-- PERFORMANCE INDEXES
CREATE INDEX IF NOT EXISTS idx_products_sku ON products(sku);
CREATE INDEX IF NOT EXISTS idx_store_inventory_product ON store_inventory(product_id);
CREATE INDEX IF NOT EXISTS idx_detections_store_status ON image_detections_log(store_id, processed_status);
CREATE INDEX IF NOT EXISTS idx_detections_timestamp ON image_detections_log(timestamp);
CREATE INDEX IF NOT EXISTS idx_sync_queue_store_status ON sync_queue(store_id, status);
"""

# Master Catalog Seed Data
def _hash_default_password(password: str) -> str:
    try:
        from werkzeug.security import generate_password_hash
        return generate_password_hash(password)
    except Exception:
        import hashlib
        return "sha256$" + hashlib.sha256(password.encode()).hexdigest()

USERS_SEED: list = []

CATEGORIES_SEED = [
    ("Electronics & Robotics",),
    ("Laboratory & Science Supplies",),
    ("Craft Materials & STEM Kits",),
]

PRODUCTS_SEED = [
    # (sku, product_name, category_id, unit_price)
    ("ELE-ARD-001", "Arduino Uno Rev3", 1, 24.50),
    ("ELE-RES-10K", "10k Ohm Resistor Pack (100pk)", 1, 4.99),
    ("ELE-SOL-005", "5V Solar Panel Kit", 1, 12.80),
    ("LAB-TUB-100", "Glass Test Tubes (Pack of 50)", 2, 18.75),
    ("LAB-BEA-500", "500ml Borosilicate Glass Beaker", 2, 9.50),
    ("LAB-PIP-010", "10ml Graduated Pipette", 2, 6.25),
    ("CRF-GLU-012", "Heavy Duty Glue Sticks (Pack of 12)", 3, 7.99),
    ("CRF-SCI-001", "Precision Craft Scissors", 3, 5.50),
    ("CRF-POP-100", "Colored Wooden Popsicle Sticks (100 pk)", 3, 3.50),
]

STORES_SEED = [
    # (store_name, location_type, sync_status)
    ("Store 1 (Main Retail Hub)", "online", "online"),
    ("Store 2 (Suburban Outlet)", "online", "online"),
    ("Store 3 (Remote Warehouse Alpha)", "offline_capable", "online"),
    ("Store 4 (Field Operations Unit)", "offline_capable", "online"),
]

# Baseline stock per store: (store_id, product_id, initial_quantity)
INITIAL_INVENTORY_SEED = []


def get_db_connection(db_path: str = DB_PATH) -> sqlite3.Connection:
    """Returns a SQLite connection with foreign key constraints enabled."""
    conn = sqlite3.connect(db_path)
    conn.execute("PRAGMA foreign_keys = ON;")
    conn.row_factory = sqlite3.Row
    return conn


def init_database(db_path: str = DB_PATH, force_reset: bool = False) -> None:
    """
    Initializes database tables, indexes, and seeds baseline data.
    If force_reset is True, removes existing database file first.
    """
    if force_reset and os.path.exists(db_path):
        os.remove(db_path)
        print(f"[Init] Existing database removed: {db_path}")

    conn = get_db_connection(db_path)
    cursor = conn.cursor()

    print("[Init] Executing DDL Schema creation...")
    cursor.executescript(SCHEMA_SQL)
    conn.commit()

    # Seed Users if table is empty
    cursor.execute("SELECT COUNT(*) FROM users;")
    if cursor.fetchone()[0] == 0:
        print("[Init] Seeding Baseline User Accounts...")
        cursor.executemany(
            """INSERT INTO users (user_id, password_hash, full_name, team)
               VALUES (?, ?, ?, ?);""",
            USERS_SEED
        )

    # Seed Categories if table is empty
    cursor.execute("SELECT COUNT(*) FROM categories;")
    if cursor.fetchone()[0] == 0:
        print("[Init] Seeding Product Categories...")
        cursor.executemany(
            "INSERT INTO categories (category_name) VALUES (?);",
            CATEGORIES_SEED
        )

    # Seed Products if table is empty
    cursor.execute("SELECT COUNT(*) FROM products;")
    if cursor.fetchone()[0] == 0:
        print("[Init] Seeding Master Product Catalog...")
        cursor.executemany(
            """INSERT INTO products (sku, product_name, category_id, unit_price)
               VALUES (?, ?, ?, ?);""",
            PRODUCTS_SEED
        )

    # Seed Stores if table is empty
    cursor.execute("SELECT COUNT(*) FROM stores;")
    if cursor.fetchone()[0] == 0:
        print("[Init] Seeding Store Directory...")
        cursor.executemany(
            """INSERT INTO stores (store_name, location_type, sync_status)
               VALUES (?, ?, ?);""",
            STORES_SEED
        )

    # Seed Store Inventory if table is empty
    cursor.execute("SELECT COUNT(*) FROM store_inventory;")
    if cursor.fetchone()[0] == 0:
        print("[Init] Seeding Initial Store Inventory Levels...")
        cursor.executemany(
            """INSERT INTO store_inventory (store_id, product_id, quantity)
               VALUES (?, ?, ?);""",
            INITIAL_INVENTORY_SEED
        )

    conn.commit()
    conn.close()
    print("[Init] Database initialization and baseline seeding complete successfully!")


if __name__ == "__main__":
    init_database(force_reset=True)
