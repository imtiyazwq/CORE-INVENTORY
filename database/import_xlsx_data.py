"""
import_xlsx_data.py
XLSX Data Importer for CORE-INVENTORY System.

Parses '[DATASET_FOR_AI_INNOVATOR] Inventory_Data_with_Photos.xlsx'
(sheet: Inventory_Master) and seeds:
  1. Default admin user (adam / password123 / System Admin / IT / Admin)
  2. Unique Storage Locations → stores table
  3. Items → products table (sku, name, category, asset_type)
  4. Per-row stock → store_inventory table (qty, avail_qty, status, last_stocktake)

Prerequisites:
    pip install pandas openpyxl

Usage:
    python import_xlsx_data.py
    python import_xlsx_data.py --reset    # reinitialise DB first, then import
"""

import os
import sys
import sqlite3
import pandas as pd
from werkzeug.security import generate_password_hash

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
BASE_DIR   = os.path.dirname(__file__)
DB_PATH    = os.path.join(BASE_DIR, "inventory_system.db")
XLSX_PATH  = os.path.join(BASE_DIR, "[DATASET_FOR_AI_INNOVATOR] Inventory_Data_with_Photos.xlsx")
SHEET_NAME = "Inventory_Master"

# ---------------------------------------------------------------------------
# Default Admin Seed
# ---------------------------------------------------------------------------
DEFAULT_ADMIN = {
    "user_id":       "adam",
    "password":      "password123",
    "full_name":     "System Admin",
    "team":          "IT",
    "role":          "Admin",
}

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def get_db_connection() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.execute("PRAGMA foreign_keys = ON;")
    conn.row_factory = sqlite3.Row
    return conn


def safe_str(val) -> str:
    """Convert a pandas value to a clean string; return '' for NaN / None."""
    if val is None or (isinstance(val, float) and pd.isna(val)):
        return ""
    return str(val).strip()


def safe_date(val) -> str | None:
    """Convert a date/string value to ISO date string or None."""
    if val is None or (isinstance(val, float) and pd.isna(val)):
        return None
    try:
        return pd.Timestamp(val).strftime("%Y-%m-%d")
    except Exception:
        return safe_str(val) or None


def normalise_asset_type(raw: str) -> str:
    """Map XLSX asset type strings to schema CHECK constraint values."""
    mapping = {
        "consumable":          "Consumable",
        "controllable asset":  "Controllable Asset",
        "non-consumable":      "Non-Consumable",
    }
    return mapping.get(raw.lower().strip(), "Consumable")


# ---------------------------------------------------------------------------
# Import Logic
# ---------------------------------------------------------------------------

def seed_admin(cursor: sqlite3.Cursor) -> None:
    cursor.execute("SELECT COUNT(*) FROM users WHERE user_id = ?;", (DEFAULT_ADMIN["user_id"],))
    if cursor.fetchone()[0] > 0:
        print(f"[Import] Admin user '{DEFAULT_ADMIN['user_id']}' already exists — skipping.")
        return

    pw_hash = generate_password_hash(DEFAULT_ADMIN["password"])
    cursor.execute(
        """INSERT INTO users (user_id, password_hash, full_name, team, role)
           VALUES (?, ?, ?, ?, ?);""",
        (
            DEFAULT_ADMIN["user_id"],
            pw_hash,
            DEFAULT_ADMIN["full_name"],
            DEFAULT_ADMIN["team"],
            DEFAULT_ADMIN["role"],
        ),
    )
    print(f"[Import] Seeded admin user: {DEFAULT_ADMIN['user_id']} (password: {DEFAULT_ADMIN['password']})")


def seed_stores(cursor: sqlite3.Cursor, locations: list[str]) -> None:
    for loc in locations:
        cursor.execute("SELECT store_id FROM stores WHERE store_name = ?;", (loc,))
        if cursor.fetchone():
            print(f"[Import] Store '{loc}' already exists — skipping.")
            continue
        cursor.execute(
            """INSERT INTO stores (store_name, location_type, sync_status)
               VALUES (?, 'offline_capable', 'online');""",
            (loc,),
        )
    print(f"[Import] Seeded {len(locations)} stores: {locations}")


def seed_products_and_inventory(cursor: sqlite3.Cursor, df: pd.DataFrame) -> None:
    inserted_products   = 0
    skipped_products    = 0
    inserted_inventory  = 0
    skipped_inventory   = 0

    for _, row in df.iterrows():
        sku        = safe_str(row.get("Item Code"))
        name       = safe_str(row.get("Item Name"))
        category   = safe_str(row.get("Category"))
        raw_type   = safe_str(row.get("Asset Type"))
        asset_type = normalise_asset_type(raw_type) if raw_type else "Consumable"
        store_name = safe_str(row.get("Storage Location"))
        qty_raw        = row.get("Total Quantity")
        avail_qty_raw  = row.get("Available Quantity")
        last_stocktake = safe_date(row.get("Last Stocktake Date"))

        qty       = int(qty_raw)       if pd.notna(qty_raw)       else 0
        avail_qty = int(avail_qty_raw) if pd.notna(avail_qty_raw) else 0

        # --- products ---
        cursor.execute("SELECT sku FROM products WHERE sku = ?;", (sku,))
        if cursor.fetchone():
            skipped_products += 1
        else:
            cursor.execute(
                """INSERT INTO products (sku, name, category, asset_type)
                   VALUES (?, ?, ?, ?);""",
                (sku, name, category, asset_type),
            )
            inserted_products += 1

        # --- store_inventory ---
        if store_name:
            cursor.execute(
                "SELECT sku FROM store_inventory WHERE sku = ? AND store_name = ?;",
                (sku, store_name),
            )
            if cursor.fetchone():
                skipped_inventory += 1
            else:
                cursor.execute(
                    """INSERT INTO store_inventory (sku, store_name, qty, avail_qty, status, last_stocktake)
                       VALUES (?, ?, ?, ?, 'Available', ?);""",
                    (sku, store_name, qty, avail_qty, last_stocktake),
                )
                inserted_inventory += 1

    print(f"[Import] Products  — inserted: {inserted_products}, skipped (dup): {skipped_products}")
    print(f"[Import] Inventory — inserted: {inserted_inventory}, skipped (dup): {skipped_inventory}")


def run_import() -> None:
    # ------------------------------------------------------------------ sanity checks
    if not os.path.exists(DB_PATH):
        print(f"[Import] ERROR: Database not found at '{DB_PATH}'.")
        print("[Import] Run 'python init_db.py' first to create the schema.")
        sys.exit(1)

    if not os.path.exists(XLSX_PATH):
        print(f"[Import] ERROR: XLSX file not found at '{XLSX_PATH}'.")
        sys.exit(1)

    # ------------------------------------------------------------------ read XLSX
    print(f"[Import] Reading '{SHEET_NAME}' from XLSX…")
    df = pd.read_excel(XLSX_PATH, sheet_name=SHEET_NAME)
    print(f"[Import] Total rows before filtering: {len(df)}")

    # Drop rows where 'Item Code' is NaN (per spec)
    df = df.dropna(subset=["Item Code"]).copy()
    print(f"[Import] Rows after dropping NaN 'Item Code': {len(df)}")

    # Unique storage locations from the data
    unique_locations = sorted(df["Storage Location"].dropna().unique().tolist())
    print(f"[Import] Unique storage locations: {unique_locations}")

    # ------------------------------------------------------------------ seed DB
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        seed_admin(cursor)
        seed_stores(cursor, unique_locations)
        seed_products_and_inventory(cursor, df)
        conn.commit()
        print("\n[Import] OK All data imported successfully.")
    except Exception as exc:
        conn.rollback()
        print(f"[Import] ERROR during import: {exc}")
        raise
    finally:
        conn.close()


if __name__ == "__main__":
    if "--reset" in sys.argv:
        # Re-initialise DB from schema then import
        from init_db import init_database
        init_database(force_reset=True)

    run_import()
