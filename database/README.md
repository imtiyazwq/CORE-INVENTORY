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
| `POST /api/programme-catalogue/book` | **public** | Checks out a booked programme's required equipment from live inventory - see below |
| `GET /api/consultant/status`, `POST /api/consultant/recommend` | **public** | DeepSeek-backed "why this fits" narratives for the guest planner - see below |

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

This table is also the groundwork for future programme-booking work (a persistent booking record,
Activity History entries) - that part still doesn't exist. Live inventory reservation at
confirmation time, however, is implemented (see below).

### Booking equipment reservation (`POST /api/programme-catalogue/book`)

Called by the guest planner's confirmation step. Body: `{"offeringIds": [...], "bookingReference":
"...", "contactName": "...", "organisation": "..."}`. For each `offeringId`, every item name in
that offering's `requiredItems` (see `database/data/programme_catalogue.json`) is checked out at a
fixed quantity of 1 via the same `_apply_checkout` logic `/api/inventory/checkout` uses, attributed
to `contactName` under a `Programme Booking - <organisation>` team. Response lists a per-item
`status`: `checked_out`, `out_of_stock`, `not_found` (no inventory row with that name), or
`unknown_offering` (an `offeringId` not in the catalogue). Public and deliberately narrow: it can
only move the fixed, catalogue-defined quantity for a real verified offering, never an arbitrary
amount of anything. No booking record is persisted - only the resulting inventory checkouts are.

### AI Programme narratives (`GET /api/consultant/status`, `POST /api/consultant/recommend`)

DeepSeek (OpenAI-compatible API) writes a short, grounded explanation of why an already-ranked
programme option fits a guest's stated requirements. The deterministic catalogue matching in
`ProgrammeConsultantPage.tsx` still does all of the actual offering selection/scoring - DeepSeek
never picks offerings and is instructed to use only the titles/fit-reasons/warnings it's given, and
the backend drops any narrative keyed to an option id it wasn't given. This keeps the catalogue's
anti-hallucination guarantee even with a real LLM in the loop.

Requires `DEEPSEEK_API_KEY` (and optionally `DEEPSEEK_MODEL`, default `deepseek-chat`;
`DEEPSEEK_BASE_URL`, default `https://api.deepseek.com`) as environment variables, or in a `.env`
file at the project root for local development (auto-loaded via `python-dotenv` if installed).
`GET /api/consultant/status` reports `{"ready": bool, "provider": "deepseek", "model": ...}` so the
frontend knows whether to expect narratives. If DeepSeek isn't configured or the call fails for any
reason, `/api/consultant/recommend` returns 503 and the frontend silently keeps its existing
deterministic fit-reasons list - the guest planner works identically either way.

## Running locally

```bash
pip install -r requirements.txt
python app.py
```

This starts the API on `http://127.0.0.1:5000` against the local SQLite file, creating it (and its
tables) on first request.
