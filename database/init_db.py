"""
init_db.py
Database Initialization Script for CORE-INVENTORY System.

Creates an empty 'inventory_system.db' by executing schema.sql.
Run this first, then run import_xlsx_data.py to populate data.

Usage:
    python init_db.py              # initialize (no-op if DB already exists)
    python init_db.py --reset      # drop and recreate from scratch
"""

import sqlite3
import os
import sys

DB_PATH = os.path.join(os.path.dirname(__file__), "inventory_system.db")
SCHEMA_PATH = os.path.join(os.path.dirname(__file__), "schema.sql")


def get_db_connection(db_path: str = DB_PATH) -> sqlite3.Connection:
    """Returns a SQLite connection with foreign key constraints enabled."""
    conn = sqlite3.connect(db_path)
    conn.execute("PRAGMA foreign_keys = ON;")
    conn.row_factory = sqlite3.Row
    return conn


def init_database(db_path: str = DB_PATH, force_reset: bool = False) -> None:
    """
    Executes schema.sql to create all tables and indexes.

    Args:
        db_path: Path to the SQLite database file.
        force_reset: If True, deletes the existing database file first.
    """
    if force_reset and os.path.exists(db_path):
        os.remove(db_path)
        print(f"[Init] Removed existing database: {db_path}")

    if not os.path.exists(SCHEMA_PATH):
        print(f"[Init] ERROR: schema.sql not found at {SCHEMA_PATH}")
        sys.exit(1)

    with open(SCHEMA_PATH, "r", encoding="utf-8") as f:
        schema_sql = f.read()

    conn = get_db_connection(db_path)
    try:
        print("[Init] Executing schema.sql DDL...")
        conn.executescript(schema_sql)
        conn.commit()
        print("[Init] Schema created successfully.")
        print(f"[Init] Database ready at: {db_path}")
        print("[Init] Run 'python import_xlsx_data.py' to populate with XLSX data.")
    finally:
        conn.close()


if __name__ == "__main__":
    force = "--reset" in sys.argv
    init_database(force_reset=force)
