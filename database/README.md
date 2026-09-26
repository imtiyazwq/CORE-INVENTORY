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
`system_state`, `programme_catalogue`. `app.py`'s `db()`/`CursorAdapter` translate the small
subset of Postgres syntax used here (`%s` placeholders, `FOR UPDATE`, `NOW()`, `::jsonb`) to
SQLite automatically, so the same code path runs against either backend.

## Key endpoints

| Route | Auth | Purpose |
|---|---|---|
| `POST /api/register`, `/api/login`, `/api/logout`, `GET /api/me` | session | Account/session management |
| `GET /api/state` | session | Full inventory/scan/stock-check/model snapshot |
| `POST /api/inventory/checkout`, `/api/inventory/checkin` | session | Used by the web app's Checkout modal |
| `POST /api/checkout` | session **or** `X-API-Key` header | Simple, script/hardware-friendly checkout by `itemId` or `itemCode` - see below |
| `POST /api/inventory/receive` | session | Adds freshly-scanned/received stock straight to inventory (increments `quantity` + `availableQuantity`), used by the Scan page's "Add to Inventory" action |
| `POST /api/scans`, `/api/stock-check` | session | YOLO scan intake and Stock Check reconciliation |
| `POST /api/mutations/relay` | session | Replays one queued `{action, payload}` mutation - used by the offline ESP-NOW mesh relay and by the frontend's own pending-mutation flush |
| `GET /api/programme-catalogue` | **public** | Verified Petrosains programme offerings - see below |
| `POST /api/programme-catalogue/seed` | session | Staff-only reseed/update hook for future catalogue maintenance |

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

### Programme Catalogue (`GET /api/programme-catalogue`)

Verified Petrosains programme offerings (from `DATASET_PROGRAMME CATALOGUE.pdf`), seeded from
`database/data/programme_catalogue.json` into the `programme_catalogue` table on first startup.
This is the source of truth the guest "Plan a Programme" flow (`src/pages/ProgrammeConsultantPage.tsx`)
reads from; the bundled `public/data-programme-catalogue.json` is kept only as an offline fallback
if the API is unreachable. The route is intentionally **not** behind `@login_required` since guests
have no session. `POST /api/programme-catalogue/seed` (staff session required) lets you push
updated offerings without a frontend rebuild - pass `{"offerings": [...], "force": true}` to
replace the table wholesale, or omit `force` to upsert individual offerings by `offeringId`.

This table is the groundwork for future programme-booking work (persistent bookings, live
inventory reservation at confirmation time, Activity History entries) - none of that exists yet;
today the table is read-only reference data.

## Running locally

```bash
pip install -r requirements.txt
python app.py
```

This starts the API on `http://127.0.0.1:5000` against the local SQLite file, creating it (and its
tables) on first request.
