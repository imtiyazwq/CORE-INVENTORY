"""
database/app.py
Flask Application — CORE-INVENTORY System

Endpoints:
  POST /api/register                – self-service registration (open, no admin gate — see PROJECT_STATUS.md)
  POST /api/login                   – authenticate, log LOGIN, return user info
  POST /api/logout                  – log LOGOUT, clear session
  GET  /api/me                      – return current session user
  GET  /api/inventory               – list all inventory (join products + store_inventory)
  POST /api/inventory/transaction   – record IN / OUT / ADJUSTMENT, update stock
  POST /api/sync-queue/process      – trigger offline sync queue recovery (admin only)
"""

import os
import sys
import json
import sqlite3
from flask import Flask, request, jsonify, session
from flask_cors import CORS
from werkzeug.security import generate_password_hash, check_password_hash
from dotenv import load_dotenv

# Ensure the database package directory is in sys.path
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
if BASE_DIR not in sys.path:
    sys.path.insert(0, BASE_DIR)

# Explicit .env loading — must run before importing inventory_manager, since
# its USE_FIREBASE flag is read from os.environ at module-import time. Locally
# this is a no-op unless database/.env exists (see .env.example); on Render,
# real values come from the dashboard's environment variables regardless, but
# loading a .env here too means the same mechanism works in both places
# instead of "silently defaults, hope the platform sets it."
load_dotenv(os.path.join(BASE_DIR, ".env"))

from inventory_manager import (
    process_sync_queue,
    record_transaction,
    record_transaction_firestore,
    USE_FIREBASE,
)

app = Flask(__name__)
app.secret_key = os.environ.get("FLASK_SECRET_KEY", "core-inventory-secret-key-2026")

# Enable CORS with credentials for Vite and local dev servers
CORS(
    app,
    supports_credentials=True,
    origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        # PLACEHOLDER — once the frontend is deployed on Vercel, replace this
        # line with the real URL, e.g. "https://core-inventory.vercel.app"
        # (no trailing slash). See PROJECT_STATUS.md's deployment section.
        "https://REPLACE-WITH-VERCEL-URL.vercel.app",
    ],
)
DB_PATH = os.path.join(BASE_DIR, "inventory_system.db")


# ---------------------------------------------------------------------------
# DB Helper
# ---------------------------------------------------------------------------

def get_db() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.execute("PRAGMA foreign_keys = ON;")
    conn.row_factory = sqlite3.Row
    return conn


def _log_user_action(user_id: str, action: str) -> None:
    """Insert a LOGIN or LOGOUT record into user_logs."""
    try:
        conn = get_db()
        conn.execute(
            "INSERT INTO user_logs (user_id, action) VALUES (?, ?);",
            (user_id, action),
        )
        conn.commit()
        conn.close()
    except Exception as exc:
        print(f"[App] Warning: could not write user_log for {user_id}/{action}: {exc}")


# ---------------------------------------------------------------------------
# Auth — /api/register  /api/login  /api/logout  /api/me
# ---------------------------------------------------------------------------

@app.route("/api/register", methods=["POST"])
def register():
    """
    Self-service registration. Intentionally open — no admin approval or
    invite gate (explicit product decision, see PROJECT_STATUS.md for the
    security tradeoff this carries). New accounts always default to role
    'Staff' — never 'Admin', regardless of anything the client sends; the
    request body's role (if any) is never even read here.
    """
    data      = request.get_json(silent=True) or {}
    user_id   = (data.get("userId") or "").strip().lower()
    password  = data.get("password") or ""
    full_name = (data.get("fullName") or "").strip()
    team      = (data.get("team") or "").strip()

    if not all([user_id, password, full_name, team]):
        return jsonify({"error": "userId, password, fullName, and team are all required."}), 400

    if len(password) < 6:
        return jsonify({"error": "Password must be at least 6 characters long."}), 400

    conn   = get_db()
    cursor = conn.cursor()

    cursor.execute("SELECT 1 FROM users WHERE user_id = ?;", (user_id,))
    if cursor.fetchone():
        conn.close()
        return jsonify({"error": "This User ID is already taken. Please choose another."}), 409

    # Same hashing method as the seeded admin account (import_xlsx_data.py's
    # seed_admin()) — generate_password_hash() with no method override, so
    # both use werkzeug's current default.
    pw_hash = generate_password_hash(password)

    try:
        cursor.execute(
            """INSERT INTO users (user_id, password_hash, full_name, team, role)
               VALUES (?, ?, ?, ?, 'Staff');""",
            (user_id, pw_hash, full_name, team),
        )
        conn.commit()
    except sqlite3.IntegrityError:
        # Backstop against a race with the SELECT check above — the UNIQUE
        # constraint on users.user_id is the real guarantee against a silent
        # overwrite, not the pre-check.
        return jsonify({"error": "This User ID is already taken. Please choose another."}), 409
    finally:
        conn.close()

    return jsonify({
        "message": "Registration successful.",
        "user": {
            "userId":   user_id,
            "fullName": full_name,
            "team":     team,
            "role":     "Staff",
        },
    }), 201


@app.route("/api/login", methods=["POST"])
def login():
    data     = request.get_json(silent=True) or {}
    user_id  = (data.get("userId") or "").strip().lower()
    password = data.get("password") or ""

    if not user_id or not password:
        return jsonify({"error": "userId and password are required."}), 400

    conn   = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM users WHERE user_id = ?;", (user_id,))
    user = cursor.fetchone()
    conn.close()

    if not user or not check_password_hash(user["password_hash"], password):
        return jsonify({"error": "Invalid user ID or password."}), 401

    # Persist server-side session
    session["user_id"]   = user["user_id"]
    session["full_name"] = user["full_name"]
    session["team"]      = user["team"]
    session["role"]      = user["role"]

    _log_user_action(user["user_id"], "LOGIN")

    return jsonify({
        "message": "Login successful.",
        "user": {
            "userId":   user["user_id"],
            "fullName": user["full_name"],
            "team":     user["team"],
            "role":     user["role"],
        },
    }), 200


@app.route("/api/logout", methods=["POST"])
def logout():
    user_id = session.get("user_id")
    if user_id:
        _log_user_action(user_id, "LOGOUT")
    session.clear()
    return jsonify({"message": "Logged out successfully."}), 200


@app.route("/api/me", methods=["GET"])
def get_current_user():
    if "user_id" not in session:
        return jsonify({"authenticated": False}), 401
    return jsonify({
        "authenticated": True,
        "userId":   session["user_id"],
        "fullName": session["full_name"],
        "team":     session["team"],
        "role":     session.get("role", "Staff"),
    }), 200


# ---------------------------------------------------------------------------
# Inventory — GET /api/inventory
# ---------------------------------------------------------------------------

@app.route("/api/inventory", methods=["GET"])
def get_inventory():
    store_name_filter = request.args.get("store_name")

    conn   = get_db()
    cursor = conn.cursor()

    if store_name_filter:
        cursor.execute(
            """
            SELECT
                p.sku,
                p.name,
                p.category,
                p.asset_type,
                si.store_name,
                si.qty,
                si.avail_qty,
                si.status,
                si.last_stocktake
            FROM products p
            JOIN store_inventory si ON p.sku = si.sku
            WHERE si.store_name = ?
            ORDER BY si.store_name, p.category, p.name;
            """,
            (store_name_filter,),
        )
    else:
        cursor.execute(
            """
            SELECT
                p.sku,
                p.name,
                p.category,
                p.asset_type,
                si.store_name,
                si.qty,
                si.avail_qty,
                si.status,
                si.last_stocktake
            FROM products p
            JOIN store_inventory si ON p.sku = si.sku
            ORDER BY si.store_name, p.category, p.name;
            """
        )

    rows = cursor.fetchall()
    conn.close()

    items = [dict(row) for row in rows]
    return jsonify({"items": items, "count": len(items)}), 200


# ---------------------------------------------------------------------------
# Inventory Transaction — POST /api/inventory/transaction
# ---------------------------------------------------------------------------

@app.route("/api/inventory/transaction", methods=["POST"])
def inventory_transaction():
    if "user_id" not in session:
        return jsonify({"error": "Unauthorized. Please log in."}), 401

    data       = request.get_json(silent=True) or {}
    sku        = (data.get("sku") or "").strip()
    store_name = (data.get("store_name") or "").strip()
    action     = (data.get("action") or "").strip().upper()
    qty_delta  = data.get("qty_changed")

    if not all([sku, store_name, action]):
        return jsonify({"error": "sku, store_name, and action are required."}), 400

    if action not in ("IN", "OUT", "ADJUSTMENT"):
        return jsonify({"error": "action must be IN, OUT, or ADJUSTMENT."}), 400

    if qty_delta is None:
        return jsonify({"error": "qty_changed is required."}), 400

    try:
        qty_delta = int(qty_delta)
    except (TypeError, ValueError):
        return jsonify({"error": "qty_changed must be an integer."}), 400

    user_id = session["user_id"]

    try:
        transact = record_transaction_firestore if USE_FIREBASE else record_transaction
        result = transact(
            sku=sku,
            store_name=store_name,
            user_id=user_id,
            action=action,
            qty_changed=qty_delta,
        )
        return jsonify({"status": "ok", **result}), 200
    except ValueError as ve:
        return jsonify({"error": str(ve)}), 422
    except Exception as exc:
        print(f"[App] Transaction error: {exc}")
        return jsonify({"error": "Internal server error during transaction."}), 500


# ---------------------------------------------------------------------------
# Sync Queue — POST /api/sync-queue/process  (admin only)
# ---------------------------------------------------------------------------

@app.route("/api/sync-queue/process", methods=["POST"])
def trigger_sync_queue():
    if "user_id" not in session:
        return jsonify({"error": "Unauthorized."}), 401
    if session.get("role") != "Admin":
        return jsonify({"error": "Admin role required."}), 403

    data     = request.get_json(silent=True) or {}
    store_id = data.get("store_id")  # Optional — None means all pending queues

    try:
        result = process_sync_queue(store_id=store_id)
        return jsonify({"status": "ok", **result}), 200
    except Exception as exc:
        print(f"[App] Sync queue error: {exc}")
        return jsonify({"error": "Sync queue processing failed."}), 500


# ---------------------------------------------------------------------------
# Entry Point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=True)
