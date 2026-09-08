"""
database/app.py
Flask Application for Multi-Store Inventory System with User & Team Accountability
"""

import os
import sqlite3
from werkzeug.security import generate_password_hash, check_password_hash
from flask import Flask, request, jsonify, session

app = Flask(__name__)
app.secret_key = os.environ.get("FLASK_SECRET_KEY", "your-secure-secret-key-inventory")

DB_PATH = os.path.join(os.path.dirname(__file__), "inventory_system.db")

def get_db_connection():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

# 1. USER REGISTRATION
@app.route('/api/register', methods=['POST'])
def register():
    data = request.get_json() or {}
    user_id = data.get('userId')
    password = data.get('password')
    full_name = data.get('fullName')
    team = data.get('team')

    if not all([user_id, password, full_name, team]):
        return jsonify({"error": "All fields are required"}), 400

    hashed_password = generate_password_hash(password)

    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute(
            """INSERT INTO users (user_id, password_hash, full_name, team)
               VALUES (?, ?, ?, ?)""",
            (user_id, hashed_password, full_name, team)
        )
        conn.commit()
        return jsonify({"message": "User registered successfully"}), 201
    except sqlite3.IntegrityError:
        return jsonify({"error": "User ID already exists"}), 409
    finally:
        conn.close()

# 2. USER LOGIN
@app.route('/api/login', methods=['POST'])
def login():
    data = request.get_json() or {}
    user_id = data.get('userId')
    password = data.get('password')

    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM users WHERE user_id = ?", (user_id,))
    user = cursor.fetchone()
    conn.close()

    if user and check_password_hash(user['password_hash'], password):
        # Store in session token/cookie
        session['user_id'] = user['user_id']
        session['full_name'] = user['full_name']
        session['team'] = user['team']
        return jsonify({
            "message": "Login successful",
            "user": {
                "userId": user['user_id'],
                "fullName": user['full_name'],
                "team": user['team']
            }
        }), 200

    return jsonify({"error": "Invalid User ID or password"}), 401

# 3. LOGOUT & CURRENT USER
@app.route('/api/logout', methods=['POST'])
def logout():
    session.clear()
    return jsonify({"message": "Logged out successfully"}), 200

@app.route('/api/me', methods=['GET'])
def get_current_user():
    if 'user_id' not in session:
        return jsonify({"authenticated": False}), 401
    return jsonify({
        "authenticated": True,
        "userId": session['user_id'],
        "fullName": session['full_name'],
        "team": session['team']
    }), 200

# 4. COMPUTER VISION DETECTION INGESTION WITH USER/TEAM ACCOUNTABILITY
@app.route('/api/process-detections', methods=['POST'])
def handle_detection_batch():
    # Enforce server-side authentication check
    if 'user_id' not in session:
        return jsonify({"error": "Unauthorized. Please log in."}), 401

    data = request.get_json() or {}
    store_id = data.get('store_id')
    detections = data.get('detections', [])
    
    # Extract identity safely from verified server session
    user_id = session['user_id']
    team = session['team']

    # Process batch and store accountability fields in database
    conn = get_db_connection()
    cursor = conn.cursor()
    
    for det in detections:
        sku = det.get('sku')
        qty = det.get('detected_quantity', 0)
        conf = det.get('confidence_score', 0.0)
        img_path = det.get('image_path', '')

        cursor.execute("SELECT product_id FROM products WHERE sku = ?", (sku,))
        prod = cursor.fetchone()
        if prod:
            cursor.execute(
                """INSERT INTO image_detections_log 
                   (store_id, product_id, detected_quantity, confidence_score, image_path, created_by_user_id, team, processed_status)
                   VALUES (?, ?, ?, ?, ?, ?, ?, 'verified')""",
                (store_id, prod['product_id'], qty, conf, img_path, user_id, team)
            )
            
            # Update inventory table preserving existing User/Team accountability fields
            cursor.execute(
                """INSERT INTO store_inventory (store_id, product_id, quantity, last_synced_at)
                   VALUES (?, ?, ?, CURRENT_TIMESTAMP)
                   ON CONFLICT(store_id, product_id) DO UPDATE SET
                       quantity = quantity + excluded.quantity,
                       last_synced_at = CURRENT_TIMESTAMP""",
                (store_id, prod['product_id'], qty)
            )

    conn.commit()
    conn.close()
    return jsonify({"status": "success", "user": session['full_name'], "team": team}), 200

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True)
