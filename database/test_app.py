"""Pytest suite for the CORE INVENTORY Flask backend (database/app.py).

Runs entirely against a throwaway SQLite file per test (no PostgreSQL, no
network calls) so it's fast and safe to run anywhere, including CI. Each test
reloads the app module with DATABASE_URL/INVENTORY_API_KEY/DEEPSEEK_API_KEY
pinned to empty strings (so a developer's real .env can't leak into a test
run) and pointed at a fresh temp database file, giving full isolation between
tests.

Run with:
    pip install -r requirements-dev.txt
    pytest database/test_app.py -v
"""
from __future__ import annotations

import importlib
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(__file__))


@pytest.fixture
def app_module(tmp_path, monkeypatch):
    # Empty (not deleted) so python-dotenv's default no-override behaviour
    # can't repopulate these from a real .env file during the reload below.
    monkeypatch.setenv('DATABASE_URL', '')
    monkeypatch.setenv('INVENTORY_API_KEY', '')
    monkeypatch.setenv('DEEPSEEK_API_KEY', '')

    import app as module
    importlib.reload(module)

    module.LOCAL_DATABASE = str(tmp_path / 'test.db')
    module._db_initialized = False
    module.app.config.update(TESTING=True)
    return module


@pytest.fixture
def client(app_module):
    return app_module.app.test_client()


def register(client, user_id='staff1', password='TestPass123', team='QA Team'):
    return client.post('/api/register', json={'userId': user_id, 'password': password, 'team': team})


def add_item(client, **overrides):
    item = {
        'id': 'ITEM-TEST-001',
        'itemCode': 'T-001',
        'name': 'Test Widget',
        'category': 'Electronics & Robotics',
        'assetType': 'Consumable',
        'quantity': 10,
        'availableQuantity': 10,
        'location': 'CHILLAX',
        'rackShelf': 'TEST SHELF',
        'status': 'Available',
        'lastSeen': '2026-01-01',
    }
    item.update(overrides)
    response = client.post('/api/inventory/item', json={'item': item})
    assert response.status_code == 200, response.get_data(as_text=True)
    return item


# --- Health & auth -----------------------------------------------------

def test_health_reports_sqlite(client):
    response = client.get('/api/health')
    assert response.status_code == 200
    assert response.get_json() == {'status': 'ok', 'database': 'sqlite'}


def test_register_then_login_round_trip(client, app_module):
    response = register(client)
    assert response.status_code == 201
    assert response.get_json()['user']['userId'] == 'staff1'

    logout = client.post('/api/logout')
    assert logout.status_code == 200

    login = client.post('/api/login', json={'userId': 'staff1', 'password': 'TestPass123'})
    assert login.status_code == 200
    assert login.get_json()['user']['team'] == 'QA Team'


def test_register_duplicate_user_id_conflicts(client):
    assert register(client).status_code == 201
    duplicate = register(client)
    assert duplicate.status_code == 409


def test_login_with_wrong_password_is_rejected(client):
    register(client)
    client.post('/api/logout')
    response = client.post('/api/login', json={'userId': 'staff1', 'password': 'wrong-password'})
    assert response.status_code == 401


def test_protected_route_requires_a_session(client):
    response = client.post('/api/inventory/checkout', json={'itemId': 'ITEM-TEST-001', 'qty': 1})
    assert response.status_code == 401


# --- Checkout / checkin / receive --------------------------------------

def test_partial_checkout_keeps_item_available(client):
    register(client)
    add_item(client, quantity=10, availableQuantity=10)

    response = client.post('/api/inventory/checkout', json={
        'itemId': 'ITEM-TEST-001', 'qty': 3, 'user': 'Sarah Jenkins', 'team': 'Engineering',
    })
    assert response.status_code == 200
    item = response.get_json()['item']
    assert item['availableQuantity'] == 7
    assert item['status'] == 'Available'
    assert item['user'] == 'Sarah Jenkins'


def test_full_checkout_marks_item_checked_out(client):
    register(client)
    add_item(client, quantity=5, availableQuantity=5)

    response = client.post('/api/inventory/checkout', json={
        'itemId': 'ITEM-TEST-001', 'qty': 5, 'user': 'Sarah Jenkins', 'team': 'Engineering',
    })
    item = response.get_json()['item']
    assert item['availableQuantity'] == 0
    assert item['status'] == 'Checked Out'


def test_checkout_cannot_go_below_zero_available(client):
    register(client)
    add_item(client, quantity=5, availableQuantity=2)

    response = client.post('/api/inventory/checkout', json={
        'itemId': 'ITEM-TEST-001', 'qty': 999, 'user': 'Sarah Jenkins', 'team': 'Engineering',
    })
    item = response.get_json()['item']
    assert item['availableQuantity'] == 0
    assert item['status'] == 'Checked Out'


def test_checkin_restores_availability_and_clears_custodian(client):
    register(client)
    add_item(client, quantity=5, availableQuantity=5)
    client.post('/api/inventory/checkout', json={
        'itemId': 'ITEM-TEST-001', 'qty': 5, 'user': 'Sarah Jenkins', 'team': 'Engineering',
    })

    response = client.post('/api/inventory/checkin', json={
        'itemId': 'ITEM-TEST-001', 'qty': 5, 'returnLocation': 'STORE 1',
    })
    item = response.get_json()['item']
    assert item['availableQuantity'] == 5
    assert item['status'] == 'Available'
    assert item['location'] == 'STORE 1'
    assert 'user' not in item
    assert 'checkedOutAt' not in item


def test_receive_stock_adds_instead_of_overwriting(client):
    register(client)
    add_item(client, quantity=3, availableQuantity=3)

    response = client.post('/api/inventory/receive', json={'itemId': 'ITEM-TEST-001', 'qty': 2})
    assert response.status_code == 200
    item = response.get_json()['item']
    assert item['quantity'] == 5
    assert item['availableQuantity'] == 5
    assert item['status'] == 'Available'


def test_stock_check_sets_available_quantity_instead_of_adding(client):
    """Contrast with receive: a Stock Check reconciles to the observed count,
    it does not add to whatever was already there."""
    register(client)
    add_item(client, quantity=10, availableQuantity=3, location='CHILLAX')

    response = client.post('/api/stock-check', json={
        'stockCheck': {
            'id': 'SC-TEST-1',
            'location': 'CHILLAX',
            'operator': 'Auditor',
            'confirmedAt': '2026-01-02T00:00:00Z',
            'matchedCount': 1,
            'discrepancyCount': 0,
            'items': [{'name': 'Test Widget', 'detected': 8}],
        },
        'applyToInventory': True,
    })
    assert response.status_code == 201

    state = client.get('/api/state').get_json()
    item = next(i for i in state['items'] if i['id'] == 'ITEM-TEST-001')
    assert item['availableQuantity'] == 8  # set to the detected count, not 3 + 8
    assert item['quantity'] == 10


# --- Automation-friendly checkout ---------------------------------------

def test_simple_checkout_rejects_without_session_or_api_key(client):
    response = client.post('/api/checkout', json={
        'itemCode': 'T-001', 'qty': 1, 'user': 'Sarah', 'team': 'Eng',
    })
    assert response.status_code == 401


def test_simple_checkout_with_api_key_by_item_code(client, app_module):
    register(client)
    add_item(client, quantity=4, availableQuantity=4)
    client.post('/api/logout')
    app_module.INVENTORY_API_KEY = 'test-shared-secret'

    response = client.post(
        '/api/checkout',
        json={'itemCode': 'T-001', 'qty': 1, 'user': 'Kiosk', 'team': 'Automation'},
        headers={'X-API-Key': 'test-shared-secret'},
    )
    assert response.status_code == 200
    assert response.get_json()['item']['availableQuantity'] == 3


def test_simple_checkout_with_wrong_api_key_rejected(client, app_module):
    app_module.INVENTORY_API_KEY = 'test-shared-secret'
    response = client.post(
        '/api/checkout',
        json={'itemCode': 'T-001', 'qty': 1, 'user': 'Kiosk', 'team': 'Automation'},
        headers={'X-API-Key': 'not-the-right-key'},
    )
    assert response.status_code == 401


# --- Offline mesh relay ---------------------------------------------------

def test_mutations_relay_applies_checkout(client):
    register(client)
    add_item(client, quantity=6, availableQuantity=6)

    response = client.post('/api/mutations/relay', json={
        'action': 'CHECKOUT',
        'payload': {'itemId': 'ITEM-TEST-001', 'qty': 2, 'user': 'Relayed User', 'team': 'Field Team'},
    })
    assert response.status_code == 200

    state = client.get('/api/state').get_json()
    item = next(i for i in state['items'] if i['id'] == 'ITEM-TEST-001')
    assert item['availableQuantity'] == 4
    assert item['user'] == 'Relayed User'


def test_mutations_relay_rejects_unsupported_action(client):
    register(client)
    response = client.post('/api/mutations/relay', json={'action': 'NOT_A_REAL_ACTION', 'payload': {}})
    assert response.status_code == 400


# --- Programme catalogue --------------------------------------------------

def test_programme_catalogue_is_public_and_seeded(client):
    """No login at all - the guest planner has no session."""
    response = client.get('/api/programme-catalogue')
    assert response.status_code == 200
    payload = response.get_json()
    assert len(payload['offerings']) == 21
    microbit = next(o for o in payload['offerings'] if o['offeringId'] == 'ACT-002')
    assert microbit['requiredItems'] == ['Micro:bit']


def test_programme_catalogue_book_checks_out_required_items(client):
    register(client)
    add_item(client, id='ITEM-MICROBIT', itemCode='E015', name='Micro:bit',
             quantity=5, availableQuantity=5, location='CHILLAX')
    client.post('/api/logout')

    # Booking is public - a guest browser has no session.
    response = client.post('/api/programme-catalogue/book', json={
        'offeringIds': ['ACT-002'],
        'bookingReference': 'REF-TEST-1',
        'contactName': 'Jane Guest',
        'organisation': 'Test School',
    })
    assert response.status_code == 200
    payload = response.get_json()
    assert payload['allSucceeded'] is True
    assert payload['results'] == [{
        'offeringId': 'ACT-002',
        'itemName': 'Micro:bit',
        'status': 'checked_out',
        'itemId': 'ITEM-MICROBIT',
        'remainingAvailable': 4,
    }]


def test_programme_catalogue_book_reports_out_of_stock(client):
    register(client)
    add_item(client, id='ITEM-MICROBIT', itemCode='E015', name='Micro:bit',
             quantity=5, availableQuantity=0, location='CHILLAX')
    client.post('/api/logout')

    response = client.post('/api/programme-catalogue/book', json={
        'offeringIds': ['ACT-002'], 'bookingReference': 'REF-TEST-2', 'contactName': 'Jane Guest',
    })
    result = response.get_json()['results'][0]
    assert result['status'] == 'out_of_stock'


def test_programme_catalogue_book_reports_unknown_offering(client):
    response = client.post('/api/programme-catalogue/book', json={
        'offeringIds': ['ACT-999'], 'bookingReference': 'REF-TEST-3', 'contactName': 'Jane Guest',
    })
    result = response.get_json()['results'][0]
    assert result['status'] == 'unknown_offering'


def test_programme_catalogue_book_requires_offering_ids_and_reference(client):
    missing_offerings = client.post('/api/programme-catalogue/book', json={'bookingReference': 'REF-4'})
    assert missing_offerings.status_code == 400

    missing_reference = client.post('/api/programme-catalogue/book', json={'offeringIds': ['ACT-002']})
    assert missing_reference.status_code == 400


# --- DeepSeek consultant (network calls mocked out) -----------------------

def test_consultant_status_not_ready_without_api_key(client):
    response = client.get('/api/consultant/status')
    assert response.status_code == 200
    assert response.get_json() == {'ready': False, 'provider': 'deepseek', 'model': None}


def test_consultant_recommend_returns_503_without_api_key(client):
    response = client.post('/api/consultant/recommend', json={
        'request': {}, 'options': [{'id': 'option-1', 'title': 'X'}],
    })
    assert response.status_code == 503


def test_consultant_recommend_grounds_and_drops_unknown_option_ids(client, app_module, monkeypatch):
    app_module.DEEPSEEK_API_KEY = 'fake-key-for-test'
    monkeypatch.setattr(
        app_module,
        '_call_deepseek_chat',
        lambda messages, **kwargs: '{"narratives": {"option-1": "Great fit!", "option-not-offered": "Hallucinated"}}',
    )

    response = client.post('/api/consultant/recommend', json={
        'request': {'theme': 'STEM'},
        'options': [{'id': 'option-1', 'title': 'Balanced Journey', 'offeringTitles': ['Micro:bit'], 'fitReasons': [], 'warnings': []}],
    })
    assert response.status_code == 200
    narratives = response.get_json()['narratives']
    assert narratives == {'option-1': 'Great fit!'}
    assert 'option-not-offered' not in narratives
