# VisionStock Render deployment

## What this version changes

- Login/register are backed by the server session instead of browser-only localStorage.
- Inventory, scans, and stock checks are stored in Render PostgreSQL.
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

### PostgreSQL

Create a Render PostgreSQL database named `visionstock-db` and make its connection string available to the web service as:

```text
DATABASE_URL
```

Also set:

```text
FLASK_SECRET_KEY=<long-random-secret>
SESSION_COOKIE_SECURE=true
```

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
