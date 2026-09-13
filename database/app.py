"""CORE INVENTORY backend.

Production (Render): uses PostgreSQL when DATABASE_URL is present.
Local development: automatically falls back to SQLite, so Windows users do not
need to install PostgreSQL just to run login/signup in VS Code.
"""
from __future__ import annotations

import json
import os
import re
import sqlite3
from functools import wraps
from typing import Any

from flask import Flask, jsonify, request, session, send_from_directory
from werkzeug.security import check_password_hash, generate_password_hash

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
DIST = os.path.join(ROOT, 'dist')
SCHEMA = os.path.join(os.path.dirname(__file__), 'schema.sql')
LOCAL_DATABASE = os.path.join(os.path.dirname(__file__), 'visionstock_local.db')
DATABASE_URL = os.environ.get('DATABASE_URL', '').strip()
USE_POSTGRES = bool(DATABASE_URL)

# psycopg2 is only required on Render/production. Local Windows development
# uses Python's built-in sqlite3 module and therefore does not need pg_config.
psycopg2 = None
psycopg2_extras = None
if USE_POSTGRES:
    try:
        import psycopg2 as _psycopg2
        import psycopg2.extras as _psycopg2_extras

        psycopg2 = _psycopg2
        psycopg2_extras = _psycopg2_extras
    except ImportError as exc:  # pragma: no cover - production configuration issue
        raise RuntimeError(
            'DATABASE_URL is configured, but psycopg2 is not installed. '
            'Install database/requirements.txt on the server.'
        ) from exc

app = Flask(__name__, static_folder=DIST, static_url_path='')
app.secret_key = os.environ.get('FLASK_SECRET_KEY', 'visionstock-local-dev-secret')
app.config.update(
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE=os.environ.get('SESSION_COOKIE_SAMESITE', 'Lax'),
    SESSION_COOKIE_SECURE=os.environ.get('SESSION_COOKIE_SECURE', 'false').lower() == 'true',
    PERMANENT_SESSION_LIFETIME=60 * 60 * 24 * 7,
)

JSON_COLUMNS = {'item', 'record', 'config_value', 'state_value'}
_db_initialized = False


LOCAL_SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    user_id TEXT PRIMARY KEY,
    password_hash TEXT NOT NULL,
    full_name TEXT NOT NULL,
    team TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS inventory_items (
    id TEXT PRIMARY KEY,
    item TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS scan_records (
    id TEXT PRIMARY KEY,
    record TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS stock_checks (
    id TEXT PRIMARY KEY,
    record TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS app_config (
    config_key TEXT PRIMARY KEY,
    config_value TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS system_state (
    state_key TEXT PRIMARY KEY,
    state_value TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
"""


def _normalise_row(row: Any):
    if row is None:
        return None
    data = dict(row)
    for key in JSON_COLUMNS:
        value = data.get(key)
        if isinstance(value, str):
            try:
                data[key] = json.loads(value)
            except (json.JSONDecodeError, TypeError):
                pass
    return data


def _sqlite_sql(sql: str) -> str:
    """Translate the small PostgreSQL syntax subset used by this app to SQLite."""
    sql = sql.replace('%s', '?')
    sql = re.sub(r'\s+FOR\s+UPDATE\b', '', sql, flags=re.IGNORECASE)
    sql = re.sub(r'\bNOW\(\)', 'CURRENT_TIMESTAMP', sql, flags=re.IGNORECASE)
    sql = sql.replace("'false'::jsonb", "'false'")
    sql = sql.replace("'true'::jsonb", "'true'")
    return sql


class CursorAdapter:
    def __init__(self, cursor, is_postgres: bool):
        self._cursor = cursor
        self._is_postgres = is_postgres

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        try:
            self._cursor.close()
        except Exception:
            pass
        return False

    def execute(self, sql: str, params=None):
        if not self._is_postgres:
            sql = _sqlite_sql(sql)
        self._cursor.execute(sql, params or ())
        return self

    def fetchone(self):
        return _normalise_row(self._cursor.fetchone())

    def fetchall(self):
        return [_normalise_row(row) for row in self._cursor.fetchall()]


class ConnectionAdapter:
    def __init__(self, connection, is_postgres: bool):
        self._connection = connection
        self._is_postgres = is_postgres

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        if exc_type is not None:
            try:
                self._connection.rollback()
            except Exception:
                pass
        try:
            self._connection.close()
        except Exception:
            pass
        return False

    def cursor(self):
        return CursorAdapter(self._connection.cursor(), self._is_postgres)

    def commit(self):
        self._connection.commit()

    def rollback(self):
        self._connection.rollback()


def db() -> ConnectionAdapter:
    if USE_POSTGRES:
        connection = psycopg2.connect(
            DATABASE_URL,
            cursor_factory=psycopg2_extras.RealDictCursor,
        )
        return ConnectionAdapter(connection, True)

    connection = sqlite3.connect(LOCAL_DATABASE, timeout=30, check_same_thread=False)
    connection.row_factory = sqlite3.Row
    connection.execute('PRAGMA foreign_keys = ON')
    connection.execute('PRAGMA journal_mode = WAL')
    return ConnectionAdapter(connection, False)


def init_db():
    global _db_initialized
    if _db_initialized:
        return

    if USE_POSTGRES:
        with db() as conn:
            with conn.cursor() as cur:
                with open(SCHEMA, 'r', encoding='utf-8') as f:
                    cur.execute(f.read())
                cur.execute(
                    "INSERT INTO system_state (state_key, state_value) "
                    "VALUES ('initialized', 'false'::jsonb) ON CONFLICT DO NOTHING"
                )
            conn.commit()
    else:
        # Use sqlite3 directly here because executescript handles the local schema.
        connection = sqlite3.connect(LOCAL_DATABASE, timeout=30)
        try:
            connection.executescript(LOCAL_SCHEMA)
            connection.execute(
                "INSERT OR IGNORE INTO system_state (state_key, state_value) VALUES (?, ?)",
                ('initialized', json.dumps(False)),
            )
            connection.commit()
        finally:
            connection.close()

    _db_initialized = True


def is_unique_violation(exc: Exception) -> bool:
    if USE_POSTGRES:
        return bool(psycopg2 and isinstance(exc, psycopg2.errors.UniqueViolation))
    return isinstance(exc, sqlite3.IntegrityError) and 'unique' in str(exc).lower()


def login_required(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        if 'user_id' not in session:
            return jsonify({'error': 'Unauthorized. Please log in.'}), 401
        return fn(*args, **kwargs)

    return wrapper


def user_payload(user):
    return {
        'userId': user['user_id'],
        'fullName': user['full_name'],
        'team': user['team'],
    }


@app.before_request
def ensure_database():
    if request.path.startswith('/api/'):
        init_db()


@app.route('/api/health', methods=['GET'])
def health():
    try:
        init_db()
        return jsonify({
            'status': 'ok',
            'database': 'postgresql' if USE_POSTGRES else 'sqlite',
        }), 200
    except Exception as exc:
        return jsonify({'status': 'error', 'error': str(exc)}), 500


@app.route('/api/register', methods=['POST'])
def register():
    data = request.get_json(silent=True) or {}
    user_id = str(data.get('userId', '')).strip()
    password = data.get('password')
    full_name = str(data.get('fullName') or user_id).strip()
    team = str(data.get('team', '')).strip()

    if not user_id or not password or not team:
        return jsonify({'error': 'User ID, password and team are required.'}), 400
    if len(password) < 6:
        return jsonify({'error': 'Password must be at least 6 characters long.'}), 400

    try:
        with db() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    'INSERT INTO users (user_id, password_hash, full_name, team) '
                    'VALUES (%s, %s, %s, %s) RETURNING user_id, full_name, team',
                    (user_id, generate_password_hash(password), full_name, team),
                )
                user = cur.fetchone()
            conn.commit()
    except Exception as exc:
        if is_unique_violation(exc):
            return jsonify({'error': 'User ID already exists.'}), 409
        raise

    session.permanent = True
    session['user_id'] = user['user_id']
    return jsonify({'message': 'Registration successful', 'user': user_payload(user)}), 201


@app.route('/api/login', methods=['POST'])
def login():
    data = request.get_json(silent=True) or {}
    user_id = str(data.get('userId', '')).strip()
    password = data.get('password') or ''
    if not user_id or not password:
        return jsonify({'error': 'User ID and password are required.'}), 400

    with db() as conn:
        with conn.cursor() as cur:
            cur.execute(
                'SELECT user_id, password_hash, full_name, team '
                'FROM users WHERE LOWER(user_id) = LOWER(%s)',
                (user_id,),
            )
            user = cur.fetchone()

    if not user or not check_password_hash(user['password_hash'], password):
        return jsonify({'error': 'Invalid User ID or password.'}), 401

    session.permanent = True
    session['user_id'] = user['user_id']
    return jsonify({'message': 'Login successful', 'user': user_payload(user)}), 200


@app.route('/api/logout', methods=['POST'])
def logout():
    session.clear()
    return jsonify({'message': 'Logged out successfully'}), 200


@app.route('/api/me', methods=['GET'])
def me():
    if 'user_id' not in session:
        return jsonify({'authenticated': False}), 401
    with db() as conn:
        with conn.cursor() as cur:
            cur.execute(
                'SELECT user_id, full_name, team FROM users WHERE user_id = %s',
                (session['user_id'],),
            )
            user = cur.fetchone()
    if not user:
        session.clear()
        return jsonify({'authenticated': False}), 401
    return jsonify({'authenticated': True, **user_payload(user)}), 200


def read_state(cur):
    cur.execute('SELECT item FROM inventory_items ORDER BY id')
    items = [row['item'] for row in cur.fetchall()]
    cur.execute('SELECT record FROM scan_records ORDER BY created_at DESC')
    scans = [row['record'] for row in cur.fetchall()]
    cur.execute('SELECT record FROM stock_checks ORDER BY created_at DESC')
    checks = [row['record'] for row in cur.fetchall()]
    cur.execute("SELECT config_value FROM app_config WHERE config_key = 'model' LIMIT 1")
    config_row = cur.fetchone()
    cur.execute("SELECT state_value FROM system_state WHERE state_key = 'initialized' LIMIT 1")
    init_row = cur.fetchone()
    initialized = bool(init_row and init_row['state_value'] is True) if init_row else False
    cur.execute("SELECT state_value FROM system_state WHERE state_key = 'dataset_version' LIMIT 1")
    version_row = cur.fetchone()
    dataset_version = version_row['state_value'] if version_row else None
    return {
        'items': items,
        'scanHistory': scans,
        'stockChecks': checks,
        'modelConfig': config_row['config_value'] if config_row else None,
        'initialized': initialized,
        'datasetVersion': dataset_version,
    }


@app.route('/api/state', methods=['GET'])
@login_required
def state():
    with db() as conn:
        with conn.cursor() as cur:
            return jsonify(read_state(cur))


@app.route('/api/seed', methods=['POST'])
@login_required
def seed():
    data = request.get_json(silent=True) or {}
    items = data.get('items') or []
    force = bool(data.get('force'))
    dataset_version = str(data.get('datasetVersion') or '').strip()
    with db() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT state_value FROM system_state WHERE state_key = 'initialized'")
            row = cur.fetchone()
            already = bool(row and row['state_value'] is True)
            if already and not force:
                return jsonify({'message': 'Cloud inventory is already initialized.'}), 200
            if force:
                cur.execute('DELETE FROM inventory_items')
                cur.execute('DELETE FROM scan_records')
                cur.execute('DELETE FROM stock_checks')
            for item in items:
                cur.execute(
                    'INSERT INTO inventory_items (id, item) VALUES (%s, %s) '
                    'ON CONFLICT (id) DO UPDATE SET item = EXCLUDED.item, updated_at = NOW()',
                    (item['id'], json.dumps(item)),
                )
            cur.execute(
                "UPDATE system_state SET state_value = 'true'::jsonb, updated_at = NOW() "
                "WHERE state_key = 'initialized'"
            )
            if dataset_version:
                cur.execute(
                    'INSERT INTO system_state (state_key, state_value) VALUES (%s, %s) '
                    'ON CONFLICT (state_key) DO UPDATE SET state_value = EXCLUDED.state_value, updated_at = NOW()',
                    ('dataset_version', json.dumps(dataset_version)),
                )
        conn.commit()
    return jsonify({
        'message': 'Inventory initialized',
        'count': len(items),
        'datasetVersion': dataset_version or None,
    }), 200


@app.route('/api/inventory/item', methods=['POST', 'PUT'])
@login_required
def inventory_item():
    data = request.get_json(silent=True) or {}
    item = data.get('item')
    if not item or not item.get('id'):
        return jsonify({'error': 'A complete inventory item is required.'}), 400
    with db() as conn:
        with conn.cursor() as cur:
            cur.execute(
                'INSERT INTO inventory_items (id, item) VALUES (%s, %s) '
                'ON CONFLICT (id) DO UPDATE SET item = EXCLUDED.item, updated_at = NOW()',
                (item['id'], json.dumps(item)),
            )
            cur.execute(
                "UPDATE system_state SET state_value = 'true'::jsonb, updated_at = NOW() "
                "WHERE state_key = 'initialized'"
            )
        conn.commit()
    return jsonify({'item': item}), 200


@app.route('/api/inventory/checkout', methods=['POST'])
@login_required
def checkout():
    data = request.get_json(silent=True) or {}
    item_id, qty = data.get('itemId'), int(data.get('qty', 0))
    with db() as conn:
        with conn.cursor() as cur:
            cur.execute('SELECT item FROM inventory_items WHERE id = %s FOR UPDATE', (item_id,))
            row = cur.fetchone()
            if not row:
                return jsonify({'error': 'Inventory item not found.'}), 404
            item = row['item']
            now = __import__('datetime').datetime.utcnow().isoformat() + 'Z'
            requested_qty = max(0, qty)
            available = max(0, int(item.get('availableQuantity', 0)))
            deduction = min(available, requested_qty)
            item['availableQuantity'] = max(0, available - deduction)

            # Checkout is a movement state, not disposal. Keep the row Available
            # while some units remain and mark it Checked Out only when all currently
            # available units are out.
            item['status'] = 'Checked Out' if item['availableQuantity'] == 0 else 'Available'
            item['user'] = data.get('user')
            item['team'] = data.get('team')
            item['checkedOutAt'] = now
            item['lastSeen'] = now[:10]
            cur.execute(
                'UPDATE inventory_items SET item = %s, updated_at = NOW() WHERE id = %s',
                (json.dumps(item), item_id),
            )
        conn.commit()
    return jsonify({'item': item}), 200


@app.route('/api/inventory/checkin', methods=['POST'])
@login_required
def checkin():
    data = request.get_json(silent=True) or {}
    item_id, qty = data.get('itemId'), int(data.get('qty', 0))
    with db() as conn:
        with conn.cursor() as cur:
            cur.execute('SELECT item FROM inventory_items WHERE id = %s FOR UPDATE', (item_id,))
            row = cur.fetchone()
            if not row:
                return jsonify({'error': 'Inventory item not found.'}), 404
            item = row['item']
            now = __import__('datetime').datetime.utcnow().isoformat() + 'Z'
            item['location'] = data.get('returnLocation', item.get('location'))
            item['lastSeen'] = now[:10]
            requested_qty = max(0, qty)
            total_qty = max(0, int(item.get('quantity', 0)))
            available = max(0, int(item.get('availableQuantity', 0)))
            outstanding_qty = max(0, total_qty - available)
            returned_qty = min(outstanding_qty, requested_qty)
            item['availableQuantity'] = min(total_qty, available + returned_qty)

            if item['availableQuantity'] >= total_qty:
                item['status'] = 'Available'
                item.pop('user', None)
                item.pop('team', None)
                item.pop('checkedOutAt', None)
            else:
                item['status'] = 'Checked Out'
            cur.execute(
                'UPDATE inventory_items SET item = %s, updated_at = NOW() WHERE id = %s',
                (json.dumps(item), item_id),
            )
        conn.commit()
    return jsonify({'item': item}), 200


@app.route('/api/scans', methods=['POST'])
@login_required
def scans():
    data = request.get_json(silent=True) or {}
    record = data.get('scan')
    if not record or not record.get('id'):
        return jsonify({'error': 'Scan record is required.'}), 400
    record['status'] = 'Pending Review'
    with db() as conn:
        with conn.cursor() as cur:
            cur.execute(
                'INSERT INTO scan_records (id, record) VALUES (%s, %s) '
                'ON CONFLICT (id) DO UPDATE SET record = EXCLUDED.record',
                (record['id'], json.dumps(record)),
            )
        conn.commit()
    return jsonify({'scan': record}), 201


def _find_inventory_row_for_stock_check(cur, name: str, location: str):
    if USE_POSTGRES:
        cur.execute(
            "SELECT id, item FROM inventory_items "
            "WHERE LOWER(item->>'name') = LOWER(%s) AND item->>'location' = %s FOR UPDATE",
            (name, location),
        )
        return cur.fetchone()

    cur.execute('SELECT id, item FROM inventory_items')
    for row in cur.fetchall():
        item = row['item'] or {}
        if str(item.get('name', '')).lower() == str(name).lower() and item.get('location') == location:
            return row
    return None


def _find_latest_pending_scan(cur, location: str):
    if USE_POSTGRES:
        cur.execute(
            "SELECT id, record FROM scan_records "
            "WHERE record->>'location' = %s AND record->>'status' = 'Pending Review' "
            "ORDER BY created_at DESC LIMIT 1 FOR UPDATE",
            (location,),
        )
        return cur.fetchone()

    cur.execute('SELECT id, record FROM scan_records ORDER BY created_at DESC')
    for row in cur.fetchall():
        record = row['record'] or {}
        if record.get('location') == location and record.get('status') == 'Pending Review':
            return row
    return None


@app.route('/api/stock-check', methods=['POST'])
@login_required
def stock_check():
    data = request.get_json(silent=True) or {}
    record = data.get('stockCheck')
    apply_inventory = bool(data.get('applyToInventory', True))
    if not record or not record.get('id'):
        return jsonify({'error': 'Stock check record is required.'}), 400

    with db() as conn:
        with conn.cursor() as cur:
            if apply_inventory:
                for audit in record.get('items', []):
                    row = _find_inventory_row_for_stock_check(
                        cur,
                        audit['name'],
                        record['location'],
                    )
                    if not row:
                        # New classes are created by the approved frontend flow only;
                        # never auto-create an unknown item from a raw YOLO scan here.
                        continue
                    item = row['item']
                    # Stock Check verifies physical on-hand stock. Reconcile the
                    # available count, not the overall ledger total. If the audit
                    # finds more units than the current total, expand the total so
                    # availableQuantity never exceeds quantity.
                    detected_available = max(0, int(audit.get('detected', 0)))
                    item['availableQuantity'] = detected_available
                    if detected_available > int(item.get('quantity', 0)):
                        item['quantity'] = detected_available

                    item['lastSeen'] = record.get('confirmedAt', '')[:10]
                    if item['availableQuantity'] > 0:
                        item['status'] = 'Available'
                    elif item.get('assetType') == 'Consumable':
                        item['status'] = 'Disposed'
                    elif item.get('user') or item.get('checkedOutAt'):
                        item['status'] = 'Checked Out'
                    else:
                        item['status'] = 'Missing'
                    cur.execute(
                        'UPDATE inventory_items SET item = %s, updated_at = NOW() WHERE id = %s',
                        (json.dumps(item), row['id']),
                    )

            cur.execute(
                'INSERT INTO stock_checks (id, record) VALUES (%s, %s) '
                'ON CONFLICT (id) DO UPDATE SET record = EXCLUDED.record',
                (record['id'], json.dumps(record)),
            )

            pending = _find_latest_pending_scan(cur, record['location'])
            if pending:
                scan = pending['record']
                scan['status'] = 'Confirmed'
                cur.execute(
                    'UPDATE scan_records SET record = %s WHERE id = %s',
                    (json.dumps(scan), pending['id']),
                )
        conn.commit()
    return jsonify({'stockCheck': record}), 201


@app.route('/api/model-config', methods=['PUT'])
@login_required
def model_config():
    data = request.get_json(silent=True) or {}
    config = data.get('modelConfig') or {}
    with db() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO app_config (config_key, config_value) VALUES ('model', %s) "
                "ON CONFLICT (config_key) DO UPDATE SET "
                "config_value = EXCLUDED.config_value, updated_at = NOW()",
                (json.dumps(config),),
            )
        conn.commit()
    return jsonify({'modelConfig': config}), 200


@app.route('/api/state/import', methods=['POST'])
@login_required
def import_state():
    data = request.get_json(silent=True) or {}
    with db() as conn:
        with conn.cursor() as cur:
            cur.execute('DELETE FROM inventory_items')
            cur.execute('DELETE FROM scan_records')
            cur.execute('DELETE FROM stock_checks')
            for item in data.get('items', []):
                cur.execute(
                    'INSERT INTO inventory_items (id, item) VALUES (%s, %s)',
                    (item['id'], json.dumps(item)),
                )
            for scan in data.get('scanHistory', []):
                cur.execute(
                    'INSERT INTO scan_records (id, record) VALUES (%s, %s)',
                    (scan['id'], json.dumps(scan)),
                )
            for check in data.get('stockChecks', []):
                cur.execute(
                    'INSERT INTO stock_checks (id, record) VALUES (%s, %s)',
                    (check['id'], json.dumps(check)),
                )
            if data.get('modelConfig') is not None:
                cur.execute(
                    "INSERT INTO app_config (config_key, config_value) VALUES ('model', %s) "
                    "ON CONFLICT (config_key) DO UPDATE SET "
                    "config_value = EXCLUDED.config_value, updated_at = NOW()",
                    (json.dumps(data['modelConfig']),),
                )
            cur.execute(
                "UPDATE system_state SET state_value = 'true'::jsonb, updated_at = NOW() "
                "WHERE state_key = 'initialized'"
            )
        conn.commit()
    return jsonify({'message': 'State imported'}), 200


@app.route('/api/state/clear', methods=['POST'])
@login_required
def clear_state():
    with db() as conn:
        with conn.cursor() as cur:
            cur.execute('DELETE FROM inventory_items')
            cur.execute('DELETE FROM scan_records')
            cur.execute('DELETE FROM stock_checks')
            cur.execute(
                "UPDATE system_state SET state_value = 'true'::jsonb, updated_at = NOW() "
                "WHERE state_key = 'initialized'"
            )
        conn.commit()
    return jsonify({'message': 'Cloud state cleared'}), 200


@app.route('/', defaults={'path': ''})
@app.route('/<path:path>')
def frontend(path):
    if path.startswith('api/'):
        return jsonify({'error': 'API route not found'}), 404
    requested = os.path.join(DIST, path)
    if path and os.path.isfile(requested):
        return send_from_directory(DIST, path)
    index = os.path.join(DIST, 'index.html')
    if os.path.isfile(index):
        return send_from_directory(DIST, 'index.html')
    return jsonify({'error': 'Frontend build not found. Run npm run build first.'}), 404


if __name__ == '__main__':
    init_db()
    print(
        f"CORE INVENTORY backend using {'PostgreSQL' if USE_POSTGRES else 'SQLite'} "
        f"on http://127.0.0.1:{os.environ.get('PORT', '5000')}"
    )
    app.run(host='0.0.0.0', port=int(os.environ.get('PORT', '5000')), debug=False)
