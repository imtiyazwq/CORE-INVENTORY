"""
inventory_manager.py
Inventory Transaction Handler & Offline Sync Queue Recovery
for CORE-INVENTORY System.

Functions:
  record_transaction()    – atomically update store_inventory and log to inventory_logs
  process_sync_queue()    – replay pending offline mutations from sync_queue
  set_store_sync_status() – utility to flip a store's sync_status

YOLO / computer-vision helpers have been removed.
"""

import json
import sqlite3
from typing import Any, Dict, Optional

from init_db import get_db_connection, DB_PATH


# ---------------------------------------------------------------------------
# record_transaction
# ---------------------------------------------------------------------------

def record_transaction(
    sku: str,
    store_name: str,
    user_id: str,
    action: str,
    qty_changed: int,
    db_path: str = DB_PATH,
) -> Dict[str, Any]:
    """
    Atomically update store_inventory and write an inventory_logs entry.

    Parameters
    ----------
    sku         : Product SKU (must exist in products table)
    store_name  : Storage location name (must exist in stores table)
    user_id     : Authenticated user performing the transaction
    action      : 'IN' | 'OUT' | 'ADJUSTMENT'
    qty_changed : Positive integer (treated as delta; OUT uses qty_changed to reduce)

    Returns
    -------
    Dict with updated qty / avail_qty values.

    Raises
    ------
    ValueError  : If SKU or store not found, or stock would go negative on OUT.
    """
    if action not in ("IN", "OUT", "ADJUSTMENT"):
        raise ValueError(f"Invalid action '{action}'. Must be IN, OUT, or ADJUSTMENT.")

    conn   = get_db_connection(db_path)
    cursor = conn.cursor()

    try:
        # Validate product exists
        cursor.execute("SELECT sku FROM products WHERE sku = ?;", (sku,))
        if not cursor.fetchone():
            raise ValueError(f"SKU '{sku}' not found in products table.")

        # Validate store exists
        cursor.execute("SELECT store_id FROM stores WHERE store_name = ?;", (store_name,))
        if not cursor.fetchone():
            raise ValueError(f"Store '{store_name}' not found in stores table.")

        # Fetch current stock (row must exist; we do NOT auto-create rows here)
        cursor.execute(
            "SELECT qty, avail_qty FROM store_inventory WHERE sku = ? AND store_name = ?;",
            (sku, store_name),
        )
        inv_row = cursor.fetchone()
        if not inv_row:
            raise ValueError(
                f"No inventory row found for SKU='{sku}' / store='{store_name}'. "
                "Seed the store_inventory table first."
            )

        current_qty       = inv_row["qty"]
        current_avail_qty = inv_row["avail_qty"]

        # Calculate deltas
        if action == "IN":
            new_qty       = current_qty + qty_changed
            new_avail_qty = current_avail_qty + qty_changed
            signed_delta  = qty_changed
        elif action == "OUT":
            if qty_changed > current_avail_qty:
                raise ValueError(
                    f"Insufficient available stock for OUT: "
                    f"requested {qty_changed}, available {current_avail_qty}."
                )
            new_qty       = current_qty           # total physical qty unchanged on check-out
            new_avail_qty = current_avail_qty - qty_changed
            signed_delta  = -qty_changed
        else:  # ADJUSTMENT
            # qty_changed can be positive (add) or negative (reduce)
            new_qty       = max(0, current_qty + qty_changed)
            new_avail_qty = max(0, current_avail_qty + qty_changed)
            signed_delta  = qty_changed

        # Derive a human-readable status
        new_status = "Available" if new_avail_qty > 0 else "Out of Stock"

        cursor.execute("BEGIN;")

        # Update store_inventory
        cursor.execute(
            """
            UPDATE store_inventory
               SET qty       = ?,
                   avail_qty = ?,
                   status    = ?
             WHERE sku = ? AND store_name = ?;
            """,
            (new_qty, new_avail_qty, new_status, sku, store_name),
        )

        # Log the transaction
        cursor.execute(
            """
            INSERT INTO inventory_logs (sku, store_name, user_id, action, qty_changed)
            VALUES (?, ?, ?, ?, ?);
            """,
            (sku, store_name, user_id, action, signed_delta),
        )

        conn.commit()

        print(
            f"[Inventory] {action} | SKU={sku} | store={store_name} | "
            f"delta={signed_delta:+d} | new_qty={new_qty} avail={new_avail_qty}"
        )

        return {
            "sku":        sku,
            "store_name": store_name,
            "action":     action,
            "qty_changed": signed_delta,
            "new_qty":    new_qty,
            "new_avail_qty": new_avail_qty,
            "status":     new_status,
        }

    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# process_sync_queue
# ---------------------------------------------------------------------------

def process_sync_queue(
    store_id: Optional[int] = None,
    db_path:  str = DB_PATH,
) -> Dict[str, Any]:
    """
    Replay pending offline inventory transaction payloads from sync_queue.

    Each payload_json in sync_queue must have the shape:
        {
            "sku":        "<sku>",
            "store_name": "<store_name>",
            "user_id":    "<user_id>",
            "action":     "IN" | "OUT" | "ADJUSTMENT",
            "qty_changed": <int>
        }

    Returns a summary dict: { synced_payloads, processed_transactions, failed_payloads }
    """
    conn   = get_db_connection(db_path)
    cursor = conn.cursor()

    try:
        if store_id is not None:
            cursor.execute(
                """SELECT queue_id, store_id, payload_json
                     FROM sync_queue
                    WHERE store_id = ? AND status = 'pending'
                    ORDER BY created_at ASC;""",
                (store_id,),
            )
        else:
            cursor.execute(
                """SELECT queue_id, store_id, payload_json
                     FROM sync_queue
                    WHERE status = 'pending'
                    ORDER BY created_at ASC;"""
            )

        pending = cursor.fetchall()
        conn.close()  # release for per-transaction calls below

        if not pending:
            print("[Sync] No pending offline sync payloads found.")
            return {"synced_payloads": 0, "processed_transactions": 0, "failed_payloads": 0}

        synced_payloads        = 0
        processed_transactions = 0
        failed_payloads        = 0

        for item in pending:
            qid  = item["queue_id"]
            sid  = item["store_id"]

            try:
                payload = json.loads(item["payload_json"])

                record_transaction(
                    sku        = payload["sku"],
                    store_name = payload["store_name"],
                    user_id    = payload.get("user_id", "system"),
                    action     = payload["action"],
                    qty_changed= int(payload["qty_changed"]),
                    db_path    = db_path,
                )
                processed_transactions += 1

                # Mark queue item as synced
                _update_queue_status(qid, "synced", sid, db_path)
                synced_payloads += 1

            except Exception as exc:
                print(f"[Sync] Failed to replay queue_id={qid}: {exc}")
                _update_queue_status(qid, "failed", sid, db_path)
                failed_payloads += 1

        print(
            f"[Sync] Recovery complete: {synced_payloads} synced, "
            f"{processed_transactions} transactions applied, "
            f"{failed_payloads} failed."
        )
        return {
            "synced_payloads":        synced_payloads,
            "processed_transactions": processed_transactions,
            "failed_payloads":        failed_payloads,
        }

    except Exception as exc:
        print(f"[Sync] Critical error during sync queue recovery: {exc}")
        raise


def _update_queue_status(queue_id: int, status: str, store_id: int, db_path: str) -> None:
    """Helper: update a sync_queue row status and restore store sync_status on success."""
    conn = get_db_connection(db_path)
    try:
        conn.execute(
            "UPDATE sync_queue SET status = ? WHERE queue_id = ?;",
            (status, queue_id),
        )
        if status == "synced":
            conn.execute(
                "UPDATE stores SET sync_status = 'online' WHERE store_id = ?;",
                (store_id,),
            )
        conn.commit()
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# set_store_sync_status  (utility)
# ---------------------------------------------------------------------------

def set_store_sync_status(store_id: int, status: str, db_path: str = DB_PATH) -> None:
    """
    Update a store's sync_status to 'online', 'offline', or 'syncing'.
    """
    if status not in ("online", "offline", "syncing"):
        raise ValueError(f"Invalid status '{status}'. Must be 'online', 'offline', or 'syncing'.")

    conn = get_db_connection(db_path)
    try:
        conn.execute(
            "UPDATE stores SET sync_status = ? WHERE store_id = ?;",
            (status, store_id),
        )
        conn.commit()
    finally:
        conn.close()
