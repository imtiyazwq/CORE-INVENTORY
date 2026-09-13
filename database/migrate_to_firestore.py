"""
One-time migration script: copies data from the local SQLite database
(inventory_system.db) into Firestore's `store_inventory` collection,
matching the field names storageService.ts already expects
(sku, name, category, asset_type, qty, avail_qty, store_name, status, last_stocktake).

USAGE:
  1. Place your Firebase service account JSON in the `database/` folder.
  2. Update SERVICE_ACCOUNT_PATH below to match its exact filename.
  3. Run:  python migrate_to_firestore.py
     (run this from inside the `database/` folder, or adjust DB_PATH below)
"""

import sqlite3
import firebase_admin
from firebase_admin import credentials, firestore

# --- CONFIG: update these two paths if needed ---
SERVICE_ACCOUNT_PATH = "petrosainsteamb-firebase-adminsdk-fbsvc-e4494b1913.json"
DB_PATH = "inventory_system.db"
# --------------------------------------------------

# 1. Connect to Firebase using the admin service account
cred = credentials.Certificate(SERVICE_ACCOUNT_PATH)
firebase_admin.initialize_app(cred)
db = firestore.client()

# 2. Connect to the local SQLite database
conn = sqlite3.connect(DB_PATH)
conn.row_factory = sqlite3.Row
cursor = conn.cursor()

# 3. Join products + store_inventory, same shape as /api/inventory returns
cursor.execute("""
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
""")

rows = cursor.fetchall()
print(f"Found {len(rows)} rows in SQLite to migrate.")

# 4. Write each row into Firestore as its own document
#    Document ID = "{sku}_{store_name}" to keep it unique and human-readable
batch = db.batch()
count = 0

for row in rows:
    doc_id = f"{row['sku']}_{row['store_name']}".replace(" ", "_")
    doc_ref = db.collection("store_inventory").document(doc_id)

    batch.set(doc_ref, {
        "sku": row["sku"],
        "name": row["name"],
        "category": row["category"],
        "asset_type": row["asset_type"],
        "store_name": row["store_name"],
        "qty": row["qty"],
        "avail_qty": row["avail_qty"],
        "status": row["status"],
        "last_stocktake": row["last_stocktake"],
    })

    count += 1

    # Firestore batches max out at 500 writes — commit and start a new batch if needed
    if count % 400 == 0:
        batch.commit()
        batch = db.batch()
        print(f"  ...committed {count} so far")

# Commit any remaining writes
batch.commit()

print(f"Done. Migrated {count} documents into Firestore's store_inventory collection.")

conn.close()
