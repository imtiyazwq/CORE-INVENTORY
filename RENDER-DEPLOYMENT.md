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

Render's **Blueprint** flow (`New +` → `Blueprint`, using `render.yaml`) requires a payment card on
file just to use it, regardless of what services the blueprint declares - even a single free web
service with no database attached. If none of your cards are accepted there, skip Blueprint
entirely and create the service by hand instead; the plain `New +` → `Web Service` flow does not
have that requirement.

### Web Service (manual dashboard setup)

1. Render dashboard → `New +` → `Web Service` → connect the `CORE-INVENTORY` repo, branch `main`.
2. **Language/Runtime:** select `Python 3` (Render otherwise auto-detects Node from `package.json`
   and defaults to `bun install` / `yarn start`, which fails - this repo is a Python/Flask backend
   that happens to also build a Vite frontend as part of its build step).
3. **Build Command:**

   ```text
   npm install && npm run build && pip install -r database/requirements.txt
   ```

4. **Start Command:**

   ```text
   gunicorn database.app:app --bind 0.0.0.0:$PORT
   ```

5. **Instance type:** Free.
6. Add the environment variables listed below in the service's `Environment` tab, then create the
   service.

The Flask server serves the Vite `dist` directory and the `/api/*` routes from the same origin.

(`render.yaml` is still in the repo as a reference for these exact settings, and works if you ever
want to use Blueprint with a card on file - the steps above are the card-free equivalent.)

### PostgreSQL (hosted outside Render)

Render's own managed Postgres has the same card-on-file requirement as Blueprint. `DATABASE_URL` is
just a plain environment variable the app reads (see `database/app.py`), so it can point at Postgres
hosted anywhere - it doesn't have to be a Render product. Both of these are genuinely free with no
card required at signup:

- **[Neon](https://neon.tech)** - create a project, copy the connection string it gives you (starts
  with `postgresql://`).
- **[Supabase](https://supabase.com)** - create a project, then copy the connection string from
  Project Settings → Database → Connection string (use the "URI" / pooler form).

Either way, in the Render dashboard set:

```text
DATABASE_URL=<the connection string from Neon/Supabase>
```

Verified working end-to-end against a real Neon database (schema creation, register/login,
checkout, and the Programme Catalogue seed all confirmed) - including the `channel_binding=require`
parameter Neon adds to its connection strings, which needs a reasonably current `psycopg2`
(already pinned via `psycopg2-binary>=2.9.10` in `database/requirements.txt`).

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
