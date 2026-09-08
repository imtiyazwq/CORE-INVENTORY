# Multi-Store Inventory Management Database

This directory contains the complete relational SQLite database schema, seeding scripts, transaction-safe detection ingestion manager, offline queue sync recovery handlers, and automated test suite for the Multi-Store Inventory System.

## Architecture Overview

- **Database Engine**: SQLite 3 with Foreign Key constraints (`PRAGMA foreign_keys = ON;`)
- **Tables**:
  1. `stores`: Store profiles with online/offline capability flags (`Store 1` to `Store 4`).
  2. `categories`: High-level inventory categories.
  3. `products`: Master product catalog with SKU, name, unit price, and category.
  4. `store_inventory`: Composite primary key `(store_id, product_id)` tracking real-time stock levels.
  5. `image_detections_log`: Immutable audit log of YOLO computer vision detections.
  6. `sync_queue`: Offline-first queue buffering detection payloads during network outages for Stores 3 & 4.

## File Manifest

| File | Description |
|------|-------------|
| `schema.sql` | Complete DDL schema definition with performance indexes |
| `init_db.py` | Database initialization and 109-item baseline seeding script |
| `inventory_manager.py` | Transaction-safe detection ingestion, offline buffering, sync recovery, and discrepancy auditing |
| `test_db.py` | Automated test suite verifying bulk return, offline queue replay, and audit checks |

## Running Database Scripts

To initialize the database:
```bash
python init_db.py
```

To run the automated test suite:
```bash
python test_db.py
```
