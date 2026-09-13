"""
test_db.py
Automated Test Suite for CORE-INVENTORY's SQLite Transaction Pipeline

Tests inventory_manager.py's record_transaction() — the sku/store_name
composite-key schema's IN/OUT/ADJUSTMENT path (the SQLite counterpart to
record_transaction_firestore(), used when USE_FIREBASE is false) — against
the CURRENT schema.sql. Replaces a prior version of this file that tested a
pre-refactor schema (numeric product_id/store_id, image_detections_log,
process_detection_batch()) none of which exists anymore.
"""

import os
import sqlite3
import unittest

from init_db import init_database, get_db_connection
from inventory_manager import record_transaction

TEST_DB_PATH = os.path.join(os.path.dirname(__file__), "test_inventory_system.db")

TEST_USER = "test_operator"
TEST_STORE = "TEST STORE"
TEST_SKU = "TEST-SKU-001"
INITIAL_QTY = 50


class TestRecordTransaction(unittest.TestCase):

    def setUp(self):
        """Fresh schema, then seed exactly what record_transaction()'s own
        validation requires: a user (inventory_logs.user_id FK), a store
        (stores.store_name FK), a product (products.sku FK), and one
        store_inventory row to transact against."""
        init_database(db_path=TEST_DB_PATH, force_reset=True)

        conn = get_db_connection(TEST_DB_PATH)
        conn.execute(
            "INSERT INTO users (user_id, password_hash, full_name, team, role) "
            "VALUES (?, 'test-hash', 'Test Operator', 'IT', 'Staff');",
            (TEST_USER,),
        )
        conn.execute(
            "INSERT INTO stores (store_name, location_type, sync_status) VALUES (?, 'online', 'online');",
            (TEST_STORE,),
        )
        conn.execute(
            "INSERT INTO products (sku, name, category, asset_type) VALUES (?, 'Test Widget', 'Office Supplies', 'Consumable');",
            (TEST_SKU,),
        )
        conn.execute(
            "INSERT INTO store_inventory (sku, store_name, qty, avail_qty, status) VALUES (?, ?, ?, ?, 'Available');",
            (TEST_SKU, TEST_STORE, INITIAL_QTY, INITIAL_QTY),
        )
        conn.commit()
        conn.close()

    def tearDown(self):
        if os.path.exists(TEST_DB_PATH):
            os.remove(TEST_DB_PATH)

    # -- helpers ------------------------------------------------------------

    def _get_inventory_row(self):
        conn = get_db_connection(TEST_DB_PATH)
        cursor = conn.cursor()
        cursor.execute(
            "SELECT qty, avail_qty, status FROM store_inventory WHERE sku = ? AND store_name = ?;",
            (TEST_SKU, TEST_STORE),
        )
        row = cursor.fetchone()
        conn.close()
        return row

    def _get_logs(self):
        conn = get_db_connection(TEST_DB_PATH)
        cursor = conn.cursor()
        cursor.execute(
            "SELECT sku, store_name, user_id, action, qty_changed FROM inventory_logs "
            "WHERE sku = ? AND store_name = ? ORDER BY log_id ASC;",
            (TEST_SKU, TEST_STORE),
        )
        rows = cursor.fetchall()
        conn.close()
        return rows

    # -- IN -------------------------------------------------------------

    def test_in_increases_qty_and_avail(self):
        result = record_transaction(
            sku=TEST_SKU, store_name=TEST_STORE, user_id=TEST_USER,
            action="IN", qty_changed=10, db_path=TEST_DB_PATH,
        )
        self.assertEqual(result["new_qty"], 60)
        self.assertEqual(result["new_avail_qty"], 60)
        self.assertEqual(result["status"], "Available")

        row = self._get_inventory_row()
        self.assertEqual(row["qty"], 60)
        self.assertEqual(row["avail_qty"], 60)

    # -- OUT ------------------------------------------------------------

    def test_out_decreases_avail_but_not_qty(self):
        result = record_transaction(
            sku=TEST_SKU, store_name=TEST_STORE, user_id=TEST_USER,
            action="OUT", qty_changed=15, db_path=TEST_DB_PATH,
        )
        self.assertEqual(result["new_qty"], INITIAL_QTY)       # physical qty unchanged on OUT
        self.assertEqual(result["new_avail_qty"], INITIAL_QTY - 15)
        self.assertEqual(result["status"], "Available")

        row = self._get_inventory_row()
        self.assertEqual(row["qty"], INITIAL_QTY)
        self.assertEqual(row["avail_qty"], INITIAL_QTY - 15)

    def test_out_insufficient_stock_is_rejected(self):
        with self.assertRaises(ValueError) as ctx:
            record_transaction(
                sku=TEST_SKU, store_name=TEST_STORE, user_id=TEST_USER,
                action="OUT", qty_changed=INITIAL_QTY + 1, db_path=TEST_DB_PATH,
            )
        self.assertIn("Insufficient available stock", str(ctx.exception))

        # Rejected transaction must leave stock untouched and write no log.
        row = self._get_inventory_row()
        self.assertEqual(row["qty"], INITIAL_QTY)
        self.assertEqual(row["avail_qty"], INITIAL_QTY)
        self.assertEqual(len(self._get_logs()), 0)

    def test_out_exactly_at_available_boundary_succeeds(self):
        # qty_changed == avail_qty is allowed (only strictly greater is rejected).
        result = record_transaction(
            sku=TEST_SKU, store_name=TEST_STORE, user_id=TEST_USER,
            action="OUT", qty_changed=INITIAL_QTY, db_path=TEST_DB_PATH,
        )
        self.assertEqual(result["new_avail_qty"], 0)
        self.assertEqual(result["status"], "Out of Stock")

    # -- ADJUSTMENT -------------------------------------------------------

    def test_adjustment_increase_moves_both_qty_and_avail(self):
        result = record_transaction(
            sku=TEST_SKU, store_name=TEST_STORE, user_id=TEST_USER,
            action="ADJUSTMENT", qty_changed=7, db_path=TEST_DB_PATH,
        )
        self.assertEqual(result["new_qty"], INITIAL_QTY + 7)
        self.assertEqual(result["new_avail_qty"], INITIAL_QTY + 7)

    def test_adjustment_decrease_moves_both_qty_and_avail(self):
        result = record_transaction(
            sku=TEST_SKU, store_name=TEST_STORE, user_id=TEST_USER,
            action="ADJUSTMENT", qty_changed=-20, db_path=TEST_DB_PATH,
        )
        self.assertEqual(result["new_qty"], INITIAL_QTY - 20)
        self.assertEqual(result["new_avail_qty"], INITIAL_QTY - 20)

    def test_adjustment_cannot_go_negative(self):
        # ADJUSTMENT clamps at 0 rather than going negative (max(0, qty+delta)).
        result = record_transaction(
            sku=TEST_SKU, store_name=TEST_STORE, user_id=TEST_USER,
            action="ADJUSTMENT", qty_changed=-(INITIAL_QTY + 100), db_path=TEST_DB_PATH,
        )
        self.assertEqual(result["new_qty"], 0)
        self.assertEqual(result["new_avail_qty"], 0)
        self.assertEqual(result["status"], "Out of Stock")

    # -- inventory_logs audit trail ---------------------------------------

    def test_inventory_logs_records_correct_fields_per_transaction(self):
        record_transaction(sku=TEST_SKU, store_name=TEST_STORE, user_id=TEST_USER,
                            action="IN", qty_changed=10, db_path=TEST_DB_PATH)
        record_transaction(sku=TEST_SKU, store_name=TEST_STORE, user_id=TEST_USER,
                            action="OUT", qty_changed=4, db_path=TEST_DB_PATH)
        record_transaction(sku=TEST_SKU, store_name=TEST_STORE, user_id=TEST_USER,
                            action="ADJUSTMENT", qty_changed=-3, db_path=TEST_DB_PATH)

        logs = self._get_logs()
        self.assertEqual(len(logs), 3)

        self.assertEqual(logs[0]["action"], "IN")
        self.assertEqual(logs[0]["qty_changed"], 10)      # IN: positive magnitude as-is

        self.assertEqual(logs[1]["action"], "OUT")
        self.assertEqual(logs[1]["qty_changed"], -4)      # OUT: server negates internally

        self.assertEqual(logs[2]["action"], "ADJUSTMENT")
        self.assertEqual(logs[2]["qty_changed"], -3)      # ADJUSTMENT: signed delta as given

        for log in logs:
            self.assertEqual(log["sku"], TEST_SKU)
            self.assertEqual(log["store_name"], TEST_STORE)
            self.assertEqual(log["user_id"], TEST_USER)

    def test_rejected_out_writes_no_log_but_prior_successful_ones_remain(self):
        record_transaction(sku=TEST_SKU, store_name=TEST_STORE, user_id=TEST_USER,
                            action="IN", qty_changed=5, db_path=TEST_DB_PATH)
        with self.assertRaises(ValueError):
            record_transaction(sku=TEST_SKU, store_name=TEST_STORE, user_id=TEST_USER,
                                action="OUT", qty_changed=9999, db_path=TEST_DB_PATH)

        logs = self._get_logs()
        self.assertEqual(len(logs), 1)
        self.assertEqual(logs[0]["action"], "IN")

    # -- validation guards on the function itself --------------------------

    def test_invalid_action_raises(self):
        with self.assertRaises(ValueError):
            record_transaction(sku=TEST_SKU, store_name=TEST_STORE, user_id=TEST_USER,
                                action="DELETE", qty_changed=1, db_path=TEST_DB_PATH)

    def test_unknown_sku_raises(self):
        with self.assertRaises(ValueError) as ctx:
            record_transaction(sku="NOT-A-REAL-SKU", store_name=TEST_STORE, user_id=TEST_USER,
                                action="IN", qty_changed=1, db_path=TEST_DB_PATH)
        self.assertIn("not found in products", str(ctx.exception))

    def test_unknown_store_raises(self):
        with self.assertRaises(ValueError) as ctx:
            record_transaction(sku=TEST_SKU, store_name="NOT A REAL STORE", user_id=TEST_USER,
                                action="IN", qty_changed=1, db_path=TEST_DB_PATH)
        self.assertIn("not found in stores", str(ctx.exception))

    def test_missing_store_inventory_row_raises(self):
        # A product/store pair that both exist individually, but with no
        # store_inventory row seeded for that specific combination.
        conn = get_db_connection(TEST_DB_PATH)
        conn.execute(
            "INSERT INTO stores (store_name, location_type, sync_status) VALUES ('OTHER STORE', 'online', 'online');"
        )
        conn.commit()
        conn.close()

        with self.assertRaises(ValueError) as ctx:
            record_transaction(sku=TEST_SKU, store_name="OTHER STORE", user_id=TEST_USER,
                                action="IN", qty_changed=1, db_path=TEST_DB_PATH)
        self.assertIn("No inventory row found", str(ctx.exception))


if __name__ == "__main__":
    unittest.main()
