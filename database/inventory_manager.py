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
import os
import sqlite3
from typing import Any, Dict, Optional

import firebase_admin
from firebase_admin import credentials, firestore

from init_db import get_db_connection, DB_PATH

# Single source of truth for whether inventory writes target Firestore (via the
# Admin SDK) or the local SQLite store_inventory table. Mirrors the frontend's
# VITE_USE_FIREBASE flag — keep both in sync manually, they're separate runtimes.
USE_FIREBASE = os.environ.get("USE_FIREBASE", "true").strip().lower() == "true"

_FIRESTORE_SERVICE_ACCOUNT = os.path.join(
    os.path.dirname(os.path.abspath(__file__)),
    "petrosainsteamb-firebase-adminsdk-fbsvc-e4494b1913.json",
)
_firestore_client = None


def _get_firestore_client():
    """Lazily initialize the Firebase Admin SDK and return a Firestore client."""
    global _firestore_client
    if _firestore_client is None:
        if not firebase_admin._apps:
            cred = credentials.Certificate(_FIRESTORE_SERVICE_ACCOUNT)
            firebase_admin.initialize_app(cred)
        _firestore_client = firestore.client()
    return _firestore_client


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
# record_transaction_firestore
# ---------------------------------------------------------------------------

def record_transaction_firestore(
    sku: str,
    store_name: str,
    user_id: str,
    action: str,
    qty_changed: int,
    db_path: str = DB_PATH,
) -> Dict[str, Any]:
    """
    Same contract as record_transaction(), but the store_inventory document of
    record lives in Firestore (updated via the Admin SDK, inside a Firestore
    transaction for atomicity) instead of the local SQLite store_inventory table.

    The inventory_logs audit trail entry is still written to SQLite — the
    frontend never reads that table directly, so keeping it local is low-risk
    and preserves operator accountability without migrating that table too.
    """
    if action not in ("IN", "OUT", "ADJUSTMENT"):
        raise ValueError(f"Invalid action '{action}'. Must be IN, OUT, or ADJUSTMENT.")

    db = _get_firestore_client()
    doc_id = f"{sku}_{store_name}".replace(" ", "_")
    doc_ref = db.collection("store_inventory").document(doc_id)

    @firestore.transactional
    def _apply(transaction) -> Dict[str, Any]:
        snapshot = doc_ref.get(transaction=transaction)
        if not snapshot.exists:
            raise ValueError(
                f"No Firestore inventory document found for SKU='{sku}' / store='{store_name}' "
                f"(doc_id='{doc_id}')."
            )

        data = snapshot.to_dict()
        current_qty = data.get("qty", 0)
        current_avail_qty = data.get("avail_qty", 0)

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
            new_qty       = current_qty
            new_avail_qty = current_avail_qty - qty_changed
            signed_delta  = -qty_changed
        else:  # ADJUSTMENT
            new_qty       = max(0, current_qty + qty_changed)
            new_avail_qty = max(0, current_avail_qty + qty_changed)
            signed_delta  = qty_changed

        new_status = "Available" if new_avail_qty > 0 else "Out of Stock"

        transaction.update(doc_ref, {
            "qty": new_qty,
            "avail_qty": new_avail_qty,
            "status": new_status,
        })

        return {
            "new_qty": new_qty,
            "new_avail_qty": new_avail_qty,
            "status": new_status,
            "signed_delta": signed_delta,
        }

    result = _apply(db.transaction())

    # Audit trail — still local SQLite, same table Flask always logged to.
    # Firestore is already the committed source of truth at this point, so a
    # logging failure here must not surface as a transaction failure to the
    # caller (that would misreport a change that did happen as having failed).
    try:
        conn = get_db_connection(db_path)
        try:
            conn.execute(
                """
                INSERT INTO inventory_logs (sku, store_name, user_id, action, qty_changed)
                VALUES (?, ?, ?, ?, ?);
                """,
                (sku, store_name, user_id, action, result["signed_delta"]),
            )
            conn.commit()
        finally:
            conn.close()
    except Exception as exc:
        print(f"[Inventory/Firestore] Warning: failed to write audit log for {doc_id}: {exc}")

    print(
        f"[Inventory/Firestore] {action} | SKU={sku} | store={store_name} | "
        f"delta={result['signed_delta']:+d} | new_qty={result['new_qty']} avail={result['new_avail_qty']}"
    )

    return {
        "sku":           sku,
        "store_name":    store_name,
        "action":        action,
        "qty_changed":   result["signed_delta"],
        "new_qty":       result["new_qty"],
        "new_avail_qty": result["new_avail_qty"],
        "status":        result["status"],
    }


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
                transact = record_transaction_firestore if USE_FIREBASE else record_transaction

                transact(
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
