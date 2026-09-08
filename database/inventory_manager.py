"""
inventory_manager.py
Detection Ingestion & Stock Adjustment Handler for Multi-Store System

Handles computer vision image detection payloads, transaction-safe stock updates,
offline fallback queuing for Stores 3 & 4, sync queue recovery, and inventory audit discrepancy checks.
"""

import sqlite3
import json
import os
from typing import List, Dict, Any, Optional, Tuple
from init_db import get_db_connection, DB_PATH


def process_detection_batch(
    store_id: int,
    detections: List[Dict[str, Any]],
    min_confidence: float = 0.75,
    force_offline: bool = False,
    db_path: str = DB_PATH,
    user_id: Optional[str] = None,
    team: Optional[str] = None
) -> Dict[str, Any]:
    """
    Transaction-safe processor for computer vision detection output batches.

    Parameters:
    - store_id: Target store identifier (1..4)
    - detections: List of detection dicts containing:
        {'sku': str, 'detected_quantity': int, 'confidence_score': float, 'image_path': str}
    - min_confidence: Threshold float (e.g. 0.75) for auto-verifying detections.
    - force_offline: Flag to simulate/trigger offline queuing for Store 3 or Store 4.
    - db_path: Path to SQLite database.

    Returns:
    - Summary dictionary with counts of verified, conflict, queued items, and overall status.
    """
    conn = get_db_connection(db_path)
    cursor = conn.cursor()

    try:
        # Check store existence and sync status
        cursor.execute("SELECT location_type, sync_status FROM stores WHERE store_id = ?;", (store_id,))
        store_row = cursor.fetchone()
        if not store_row:
            raise ValueError(f"Store ID {store_id} does not exist in database.")

        location_type, sync_status = store_row["location_type"], store_row["sync_status"]

        # Determine if batch should be queued offline
        is_offline_event = force_offline or (sync_status == "offline")

        if is_offline_event:
            if location_type != "offline_capable":
                raise PermissionError(f"Store ID {store_id} ({location_type}) does not support offline queuing.")

            # Queue payload in sync_queue
            payload_json = json.dumps({
                "store_id": store_id,
                "min_confidence": min_confidence,
                "detections": detections
            })

            cursor.execute(
                """INSERT INTO sync_queue (store_id, payload_json, status)
                   VALUES (?, ?, 'pending');""",
                (store_id, payload_json)
            )

            # Update store status to offline
            cursor.execute("UPDATE stores SET sync_status = 'offline' WHERE store_id = ?;", (store_id,))

            # Pre-log pending detection records into image_detections_log for audit trail
            pending_count = 0
            for det in detections:
                sku = det.get("sku")
                cursor.execute("SELECT product_id FROM products WHERE sku = ?;", (sku,))
                prod = cursor.fetchone()
                if prod:
                    cursor.execute(
                        """INSERT INTO image_detections_log 
                           (store_id, product_id, detected_quantity, confidence_score, image_path, created_by_user_id, team, processed_status)
                           VALUES (?, ?, ?, ?, ?, ?, ?, 'pending');""",
                        (store_id, prod["product_id"], det["detected_quantity"], det["confidence_score"], det.get("image_path", ""), user_id, team)
                    )
                    pending_count += 1

            conn.commit()
            print(f"[Store {store_id}] Offline event buffered into sync_queue ({pending_count} pending detections recorded).")
            return {
                "status": "queued_offline",
                "store_id": store_id,
                "total_items": len(detections),
                "queued_items": pending_count,
                "verified_items": 0,
                "conflict_items": 0
            }

        # ONLINE TRANSACTION PROCESSING
        cursor.execute("BEGIN TRANSACTION;")

        verified_count = 0
        conflict_count = 0

        for det in detections:
            sku = det.get("sku")
            qty = det.get("detected_quantity", 0)
            conf = det.get("confidence_score", 0.0)
            img_path = det.get("image_path", "unknown.jpg")

            # Validate SKU
            cursor.execute("SELECT product_id FROM products WHERE sku = ?;", (sku,))
            prod = cursor.fetchone()
            if not prod:
                print(f"[Warning] Unknown SKU '{sku}' detected in Store {store_id}. Flagging as conflict.")
                conflict_count += 1
                continue

            product_id = prod["product_id"]

            # Evaluate confidence threshold
            if conf >= min_confidence:
                status = "verified"
                verified_count += 1

                # Update store inventory atomically (Upsert pattern)
                cursor.execute(
                    """INSERT INTO store_inventory (store_id, product_id, quantity, last_synced_at)
                       VALUES (?, ?, ?, CURRENT_TIMESTAMP)
                       ON CONFLICT(store_id, product_id) DO UPDATE SET
                           quantity = quantity + excluded.quantity,
                           last_synced_at = CURRENT_TIMESTAMP;""",
                    (store_id, product_id, qty)
                )
            else:
                status = "conflict"
                conflict_count += 1

            # Log detection event into audit table with user & team accountability
            cursor.execute(
                """INSERT INTO image_detections_log
                   (store_id, product_id, detected_quantity, confidence_score, image_path, created_by_user_id, team, processed_status)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?);""",
                (store_id, product_id, qty, conf, img_path, user_id, team, status)
            )

        conn.commit()
        print(f"[Store {store_id}] Processed batch online: {verified_count} verified, {conflict_count} conflicts.")
        return {
            "status": "processed_online",
            "store_id": store_id,
            "total_items": len(detections),
            "verified_items": verified_count,
            "conflict_items": conflict_count,
            "queued_items": 0
        }

    except Exception as e:
        conn.rollback()
        print(f"[Error] Transaction failed for Store {store_id}: {e}")
        raise e
    finally:
        conn.close()


def process_sync_queue(store_id: Optional[int] = None, db_path: str = DB_PATH) -> Dict[str, Any]:
    """
    Processes pending offline sync payloads in sync_queue.
    Replays queued image detections into inventory and updates detection log status.
    """
    conn = get_db_connection(db_path)
    cursor = conn.cursor()

    try:
        if store_id:
            cursor.execute(
                "SELECT queue_id, store_id, payload_json FROM sync_queue WHERE store_id = ? AND status = 'pending' ORDER BY created_at ASC;",
                (store_id,)
            )
        else:
            cursor.execute(
                "SELECT queue_id, store_id, payload_json FROM sync_queue WHERE status = 'pending' ORDER BY created_at ASC;"
            )

        queued_items = cursor.fetchall()
        if not queued_items:
            print("[Sync] No pending offline sync payloads found.")
            return {"synced_payloads": 0, "processed_detections": 0}

        total_synced_payloads = 0
        total_synced_detections = 0

        cursor.execute("BEGIN TRANSACTION;")

        for item in queued_items:
            qid = item["queue_id"]
            sid = item["store_id"]
            payload = json.loads(item["payload_json"])
            detections = payload.get("detections", [])
            min_confidence = payload.get("min_confidence", 0.75)

            for det in detections:
                sku = det.get("sku")
                qty = det.get("detected_quantity", 0)
                conf = det.get("confidence_score", 0.0)

                cursor.execute("SELECT product_id FROM products WHERE sku = ?;", (sku,))
                prod = cursor.fetchone()
                if not prod:
                    continue
                product_id = prod["product_id"]

                status = "verified" if conf >= min_confidence else "conflict"

                # Update pending log status or insert log entry
                cursor.execute(
                    """UPDATE image_detections_log
                       SET processed_status = ?
                       WHERE store_id = ? AND product_id = ? AND processed_status = 'pending';""",
                    (status, sid, product_id)
                )

                # Update stock level for verified offline detections
                if status == "verified":
                    cursor.execute(
                        """INSERT INTO store_inventory (store_id, product_id, quantity, last_synced_at)
                           VALUES (?, ?, ?, CURRENT_TIMESTAMP)
                           ON CONFLICT(store_id, product_id) DO UPDATE SET
                               quantity = quantity + excluded.quantity,
                               last_synced_at = CURRENT_TIMESTAMP;""",
                        (sid, product_id, qty)
                    )
                    total_synced_detections += 1

            # Mark queue item as synced
            cursor.execute("UPDATE sync_queue SET status = 'synced' WHERE queue_id = ?;", (qid,))
            # Restore store sync status to online
            cursor.execute("UPDATE stores SET sync_status = 'online' WHERE store_id = ?;", (sid,))
            total_synced_payloads += 1

        conn.commit()
        print(f"[Sync Recovery] Successfully synced {total_synced_payloads} payloads ({total_synced_detections} verified item detections).")
        return {
            "synced_payloads": total_synced_payloads,
            "processed_detections": total_synced_detections
        }

    except Exception as e:
        conn.rollback()
        print(f"[Sync Error] Offline sync recovery failed: {e}")
        raise e
    finally:
        conn.close()


def set_store_sync_status(store_id: int, status: str, db_path: str = DB_PATH) -> None:
    """Updates store sync status ('online', 'offline', 'syncing')."""
    if status not in ("online", "offline", "syncing"):
        raise ValueError(f"Invalid status '{status}'. Must be online, offline, or syncing.")
    conn = get_db_connection(db_path)
    conn.execute("UPDATE stores SET sync_status = ? WHERE store_id = ?;", (status, store_id))
    conn.commit()
    conn.close()


def audit_inventory_discrepancies(store_id: int, db_path: str = DB_PATH) -> List[Dict[str, Any]]:
    """
    Compares current recorded inventory stock against verified detection logs for audit checks.
    """
    conn = get_db_connection(db_path)
    cursor = conn.cursor()

    query = """
    SELECT 
        p.product_id,
        p.sku,
        p.product_name,
        COALESCE(si.quantity, 0) AS current_stock,
        COALESCE(SUM(CASE WHEN idl.processed_status = 'verified' THEN idl.detected_quantity ELSE 0 END), 0) AS total_verified_detected,
        COALESCE(SUM(CASE WHEN idl.processed_status = 'conflict' THEN idl.detected_quantity ELSE 0 END), 0) AS total_conflict_detected,
        COALESCE(SUM(CASE WHEN idl.processed_status = 'pending' THEN idl.detected_quantity ELSE 0 END), 0) AS total_pending_detected
    FROM products p
    LEFT JOIN store_inventory si ON p.product_id = si.product_id AND si.store_id = ?
    LEFT JOIN image_detections_log idl ON p.product_id = idl.product_id AND idl.store_id = ?
    GROUP BY p.product_id, p.sku, p.product_name;
    """

    cursor.execute(query, (store_id, store_id))
    rows = cursor.fetchall()
    conn.close()

    audit_results = []
    for r in rows:
        audit_results.append({
            "product_id": r["product_id"],
            "sku": r["sku"],
            "product_name": r["product_name"],
            "current_stock": r["current_stock"],
            "total_verified_detected": r["total_verified_detected"],
            "total_conflict_detected": r["total_conflict_detected"],
            "total_pending_detected": r["total_pending_detected"]
        })

    return audit_results
