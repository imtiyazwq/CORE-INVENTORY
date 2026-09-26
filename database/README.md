# CORE INVENTORY backend

This is the Flask API the frontend actually talks to (`src/services/storageService.ts` calls
`/api/*`). It is deployed on Render as a single web service (see `../render.yaml` and
`../RENDER-DEPLOYMENT.md`).

## Storage

- **Production**: PostgreSQL, used automatically whenever `DATABASE_URL` is set (Render injects
  this from the attached Postgres instance). Tables and columns are defined in `schema.sql`.
- **Local development**: SQLite (`visionstock_local.db`, gitignored), used automatically when
  `DATABASE_URL` is not set, so Windows developers don't need PostgreSQL installed locally.

Every table besides `users` stores its payload as a JSON blob (`JSONB` on Postgres, `TEXT` on
SQLite) keyed by id - `inventory_items`, `scan_records`, `stock_checks`, `app_config`,
`system_state`. `app.py`'s `db()`/`CursorAdapter` translate the small subset of Postgres syntax
used here (`%s` placeholders, `FOR UPDATE`, `NOW()`, `::jsonb`) to SQLite automatically, so the
same code path runs against either backend.

## Key endpoints

| Route | Auth | Purpose |
|---|---|---|
| `POST /api/register`, `/api/login`, `/api/logout`, `GET /api/me` | session | Account/session management |
| `GET /api/state` | session | Full inventory/scan/stock-check/model snapshot |
| `POST /api/inventory/checkout`, `/api/inventory/checkin` | session | Used by the web app's Checkout modal |
| `POST /api/checkout` | session **or** `X-API-Key` header | Simple, script/hardware-friendly checkout by `itemId` or `itemCode` - see below |
| `POST /api/scans`, `/api/stock-check` | session | YOLO scan intake and Stock Check reconciliation |
| `POST /api/mutations/relay` | session | Replays one queued `{action, payload}` mutation - used by the offline ESP-NOW mesh relay and by the frontend's own pending-mutation flush |

### Automation-friendly checkout (`POST /api/checkout`)

Set an `INVENTORY_API_KEY` environment variable on the server, then call it with a header instead
of a browser session - useful for a barcode-scanner script, a kiosk, or the ESP32 relay:

```bash
curl -X POST https://<host>/api/checkout \
  -H "Content-Type: application/json" \
  -H "X-API-Key: <INVENTORY_API_KEY>" \
  -d '{"itemCode": "E001", "qty": 1, "user": "Sarah Jenkins", "team": "Engineering"}'
```

`itemId` also works in place of `itemCode` if you already have the internal id. If
`INVENTORY_API_KEY` is left unset, this route falls back to requiring a logged-in session, same as
every other endpoint.

## Running locally

```bash
pip install -r requirements.txt
python app.py
```

This starts the API on `http://127.0.0.1:5000` against the local SQLite file, creating it (and its
tables) on first request.
