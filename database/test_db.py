"""
test_db.py
Automated Testing & Verification Suite for Multi-Store Inventory System

Simulates real-world high-throughput computer vision image detection scenarios:
1. Bulk return event with mixed items (verified vs low-confidence conflict) for Store 1.
2. Offline queue fallback and recovery sync batch for Store 3.
3. Inventory discrepancy and audit log checks.
"""

import unittest
import os
import sqlite3
from init_db import init_database, get_db_connection, DB_PATH
from inventory_manager import (
    process_detection_batch,
    process_sync_queue,
    set_store_sync_status,
    audit_inventory_discrepancies
)

TEST_DB_PATH = os.path.join(os.path.dirname(__file__), "test_inventory_system.db")


class TestMultiStoreInventorySystem(unittest.TestCase):

    def setUp(self):
        """Initializes a clean test database before each test run."""
        init_database(db_path=TEST_DB_PATH, force_reset=True)

    def tearDown(self):
        """Cleans up test database file after tests complete."""
        if os.path.exists(TEST_DB_PATH):
            os.remove(TEST_DB_PATH)

    def test_store1_bulk_return_event(self):
        """
        Test Scenario 1: Bulk return event with mixed items for Store 1 (Online).
        Tests high-confidence verification vs low-confidence conflict handling.
        """
        print("\n--- Running Test Scenario 1: Store 1 Bulk Return Event ---")
        store_id = 1

        # Check initial baseline stock for Arduino Uno (ELE-ARD-001) -> baseline is 50
        conn = get_db_connection(TEST_DB_PATH)
        cursor = conn.cursor()
        cursor.execute(
            """SELECT quantity FROM store_inventory 
               WHERE store_id = ? AND product_id = (SELECT product_id FROM products WHERE sku = 'ELE-ARD-001');""",
            (store_id,)
        )
        initial_arduino_qty = cursor.fetchone()["quantity"]
        self.assertEqual(initial_arduino_qty, 50)
        conn.close()

        # Simulated computer vision detection output from bulk return camera feed
        detections = [
            # High confidence return (5x Arduino Uno) -> Should verify & add 5 to stock (50 -> 55)
            {"sku": "ELE-ARD-001", "detected_quantity": 5, "confidence_score": 0.96, "image_path": "cam1_return_001.jpg"},
            # High confidence return (10x Glue Sticks) -> Should verify
            {"sku": "CRF-GLU-012", "detected_quantity": 10, "confidence_score": 0.88, "image_path": "cam1_return_002.jpg"},
            # Low confidence detection (Blurry image of Solar Panel) -> Should fail threshold & conflict
            {"sku": "ELE-SOL-005", "detected_quantity": 2, "confidence_score": 0.45, "image_path": "cam1_return_003.jpg"},
            # Unknown SKU (Unrecognized product label) -> Should log as conflict
            {"sku": "UNKNOWN-SKU-999", "detected_quantity": 1, "confidence_score": 0.99, "image_path": "cam1_return_004.jpg"}
        ]

        # Process detection batch
        result = process_detection_batch(store_id, detections, min_confidence=0.75, db_path=TEST_DB_PATH)

        self.assertEqual(result["status"], "processed_online")
        self.assertEqual(result["verified_items"], 2)
        self.assertEqual(result["conflict_items"], 2)

        # Verify database inventory stock after process
        conn = get_db_connection(TEST_DB_PATH)
        cursor = conn.cursor()
        
        # Check Arduino Uno updated quantity (50 + 5 = 55)
        cursor.execute(
            """SELECT quantity FROM store_inventory 
               WHERE store_id = ? AND product_id = (SELECT product_id FROM products WHERE sku = 'ELE-ARD-001');""",
            (store_id,)
        )
        updated_arduino_qty = cursor.fetchone()["quantity"]
        self.assertEqual(updated_arduino_qty, 55)

        # Check Solar Panel quantity (Should remain unchanged at baseline 30 because detection was conflict)
        cursor.execute(
            """SELECT quantity FROM store_inventory 
               WHERE store_id = ? AND product_id = (SELECT product_id FROM products WHERE sku = 'ELE-SOL-005');""",
            (store_id,)
        )
        solar_qty = cursor.fetchone()["quantity"]
        self.assertEqual(solar_qty, 30)

        # Verify image detections log entries count
        cursor.execute("SELECT COUNT(*) FROM image_detections_log WHERE store_id = ?;", (store_id,))
        log_count = cursor.fetchone()[0]
        self.assertEqual(log_count, 3) # 3 valid SKUs logged in image_detections_log
        conn.close()

        print("[OK] Test Scenario 1 passed! Store 1 stock correctly updated for verified items only.")

    def test_store3_offline_sync_recovery(self):
        """
        Test Scenario 2: Offline sync recovery batch for Store 3 (Offline-capable).
        Tests offline buffer fallback in sync_queue and post-reconnection batch replay.
        """
        print("\n--- Running Test Scenario 2: Store 3 Offline Sync Recovery ---")
        store_id = 3

        # Store 3 baseline Glass Test Tubes (LAB-TUB-100) -> baseline is 200
        conn = get_db_connection(TEST_DB_PATH)
        cursor = conn.cursor()
        cursor.execute(
            """SELECT quantity FROM store_inventory 
               WHERE store_id = ? AND product_id = (SELECT product_id FROM products WHERE sku = 'LAB-TUB-100');""",
            (store_id,)
        )
        initial_tubes_qty = cursor.fetchone()["quantity"]
        self.assertEqual(initial_tubes_qty, 200)
        conn.close()

        # Step 1: Simulate network outage at Store 3 (force_offline=True)
        offline_detections = [
            {"sku": "LAB-TUB-100", "detected_quantity": 25, "confidence_score": 0.94, "image_path": "store3_offline_01.jpg"},
            {"sku": "LAB-BEA-500", "detected_quantity": 10, "confidence_score": 0.91, "image_path": "store3_offline_02.jpg"}
        ]

        offline_result = process_detection_batch(
            store_id=store_id,
            detections=offline_detections,
            force_offline=True,
            db_path=TEST_DB_PATH
        )

        self.assertEqual(offline_result["status"], "queued_offline")
        self.assertEqual(offline_result["queued_items"], 2)

        # Assert items are buffered in sync_queue and stock levels REMAIN unchanged while offline
        conn = get_db_connection(TEST_DB_PATH)
        cursor = conn.cursor()

        cursor.execute("SELECT COUNT(*) FROM sync_queue WHERE store_id = ? AND status = 'pending';", (store_id,))
        pending_queue_count = cursor.fetchone()[0]
        self.assertEqual(pending_queue_count, 1)

        cursor.execute(
            """SELECT quantity FROM store_inventory 
               WHERE store_id = ? AND product_id = (SELECT product_id FROM products WHERE sku = 'LAB-TUB-100');""",
            (store_id,)
        )
        offline_tubes_qty = cursor.fetchone()["quantity"]
        self.assertEqual(offline_tubes_qty, 200) # Unchanged while offline
        conn.close()

        # Step 2: Simulate network connectivity recovery and process offline queue
        print("Re-establishing network connectivity for Store 3...")
        sync_result = process_sync_queue(store_id=store_id, db_path=TEST_DB_PATH)

        self.assertEqual(sync_result["synced_payloads"], 1)
        self.assertEqual(sync_result["processed_detections"], 2)

        # Step 3: Assert database inventory stock updated after sync recovery (200 + 25 = 225)
        conn = get_db_connection(TEST_DB_PATH)
        cursor = conn.cursor()

        cursor.execute(
            """SELECT quantity FROM store_inventory 
               WHERE store_id = ? AND product_id = (SELECT product_id FROM products WHERE sku = 'LAB-TUB-100');""",
            (store_id,)
        )
        synced_tubes_qty = cursor.fetchone()["quantity"]
        self.assertEqual(synced_tubes_qty, 225)

        cursor.execute("SELECT status FROM sync_queue WHERE store_id = ?;", (store_id,))
        queue_status = cursor.fetchone()["status"]
        self.assertEqual(queue_status, "synced")

        cursor.execute("SELECT sync_status FROM stores WHERE store_id = ?;", (store_id,))
        store_status = cursor.fetchone()["sync_status"]
        self.assertEqual(store_status, "online")

        conn.close()

        print("[OK] Test Scenario 2 passed! Store 3 offline queue fallback & recovery sync verified.")

    def test_discrepancy_and_audit_checks(self):
        """
        Test Scenario 3: Inventory discrepancy checks comparing recorded stock against detection logs.
        """
        print("\n--- Running Test Scenario 3: Inventory Audit & Discrepancy Checks ---")
        store_id = 1

        # Run a detection batch with verified and conflict items
        detections = [
            {"sku": "ELE-ARD-001", "detected_quantity": 10, "confidence_score": 0.95, "image_path": "audit_test_1.jpg"},
            {"sku": "ELE-ARD-001", "detected_quantity": 5, "confidence_score": 0.30, "image_path": "audit_test_2.jpg"}
        ]
        process_detection_batch(store_id, detections, min_confidence=0.75, db_path=TEST_DB_PATH)

        # Run audit discrepancy check
        audit_report = audit_inventory_discrepancies(store_id, db_path=TEST_DB_PATH)
        self.assertTrue(len(audit_report) > 0)

        arduino_audit = next(item for item in audit_report if item["sku"] == "ELE-ARD-001")
        self.assertEqual(arduino_audit["total_verified_detected"], 10)
        self.assertEqual(arduino_audit["total_conflict_detected"], 5)
        self.assertEqual(arduino_audit["current_stock"], 60) # Initial 50 + 10 verified = 60

        print("[OK] Test Scenario 3 passed! Discrepancy audit report accurately calculated.")


if __name__ == "__main__":
    unittest.main()
