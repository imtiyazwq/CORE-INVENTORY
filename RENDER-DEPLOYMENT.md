# VisionStock Render deployment

## What this version changes

- Login/register are backed by the server session instead of browser-only localStorage.
- Inventory, scans, and stock checks are stored in PostgreSQL (hosted wherever you point `DATABASE_URL` - see below).
- A YOLO scan is saved as `Pending Review`; it never changes inventory directly.
- Stock Check is the approval gate. Existing items are updated only after reconciliation. A detected item that is not yet in inventory can be created only when the scan is approved in Stock Check.
- The browser refreshes shared state every 2 seconds, so another user's approved changes appear automatically.
- The VisionStock interface is retained.
- CoreInventory's TFLite/WebAssembly YOLO pipeline is retained.
- Confidence Threshold is removed from Settings. The internal inference threshold remains fixed at 0.45.
- Stock Check remains in the sidebar and the desktop sidebar stays fixed while the main content scrolls.

## Render setup

Use the included `render.yaml`, or create a Render Web Service manually.

### Web Service

Build command:

```text
npm install && npm run build && pip install -r database/requirements.txt
```

Start command:

```text
gunicorn database.app:app --bind 0.0.0.0:$PORT
```

The Flask server serves the Vite `dist` directory and the `/api/*` routes from the same origin.

### PostgreSQL (hosted outside Render)

Render requires a payment card on file before it will provision its own Postgres database, even on
the free plan - a fraud-prevention gate, not a real charge, but a blocker if none of your cards are
accepted there. `render.yaml` sidesteps this entirely: it declares only the web service, and
`DATABASE_URL` is a plain manually-set environment variable, so you can point it at Postgres hosted
anywhere. Both of these are genuinely free with no card required at signup:

- **[Neon](https://neon.tech)** - create a project, copy the connection string it gives you (starts
  with `postgresql://`).
- **[Supabase](https://supabase.com)** - create a project, then copy the connection string from
  Project Settings → Database → Connection string (use the "URI" / pooler form).

Either way, in the Render dashboard set:

```text
DATABASE_URL=<the connection string from Neon/Supabase>
```

If you'd rather use Render's own managed Postgres and don't mind adding a card, you can instead add
a `databases:` block to `render.yaml` (see [Render's docs](https://render.com/docs/blueprint-spec#databases))
and reference it with `fromDatabase: { name: ..., property: connectionString }` in place of the
plain `DATABASE_URL` env var above.

Also set:

```text
FLASK_SECRET_KEY=<long-random-secret>
SESSION_COOKIE_SECURE=true
```

Optionally, to enable the automation-friendly `POST /api/checkout` endpoint (for a barcode-scanner
script, kiosk, or the ESP32 relay to call without a browser session), also set:

```text
INVENTORY_API_KEY=<another-long-random-secret>
```

See `database/README.md` for how to call it. Leaving this unset just means that one endpoint falls
back to requiring a logged-in session like the rest of the API.

Optionally, to enable DeepSeek-written "why this fits" narratives on the guest Programme
Consultant, also set:

```text
DEEPSEEK_API_KEY=<your DeepSeek API key>
DEEPSEEK_MODEL=deepseek-chat
```

`render.yaml` already declares `DEEPSEEK_API_KEY` as a value you set manually in the Render
dashboard (it can't be auto-generated like a secret). Leaving it unset just means the guest planner
keeps its existing deterministic fit-reasons list instead of an AI-written summary - see
`database/README.md`.

The backend creates its tables automatically on the first API request.

## First deployment

The first authenticated user causes the existing `src/data/realInventoryData.ts` dataset to be copied into PostgreSQL. Later users read the same cloud dataset.

Do not delete `DATABASE_URL` or the database if you want to preserve shared inventory.

## TFLite model

Put the genuine trained model at:

```text
public/models/inventory_yolo.tflite
```

The model must really be a valid TFLite model matching the expected YOLO input/output. Renaming another file to `.tflite` is not enough.

## If frontend and backend are deployed as separate Render services

Set the frontend environment variable:

```text
VITE_API_BASE_URL=https://YOUR-BACKEND.onrender.com
```

For the simplest deployment, use the included single Web Service so frontend and API share one origin and session cookies work without cross-origin configuration.
