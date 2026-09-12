# VisionStock local development (Windows / VS Code)

The project now uses **SQLite automatically when `DATABASE_URL` is not set**.
You do not need to install PostgreSQL on your Windows computer just to test
login/signup.

## 1. Install backend packages

From the project root in PowerShell:

```powershell
python -m pip install -r database/requirements.txt
```

On Windows this installs Flask and Werkzeug. PostgreSQL/gunicorn packages are
skipped because they are only needed on Render/Linux.

## 2. Start the backend

Open terminal 1:

```powershell
python database/app.py
```

You should see a message saying that VisionStock is using SQLite and Flask is
running on `http://127.0.0.1:5000`.

Test it by opening:

`http://127.0.0.1:5000/api/health`

Expected response:

```json
{"database":"sqlite","status":"ok"}
```

## 3. Start the frontend

Open terminal 2:

```powershell
npm install
npm run dev
```

Open the Vite address (normally `http://localhost:3000`).

`vite.config.ts` now proxies `/api/*` to the Flask server on port 5000, so no
`VITE_API_BASE_URL` is required for normal local development.

## 4. Local database file

Local users, passwords, inventory, scans and stock checks are stored in:

`database/visionstock_local.db`

Delete that file only if you intentionally want to reset the local database.

## Render

Render still uses PostgreSQL automatically because Render supplies
`DATABASE_URL`. The same frontend API paths work in production because Flask
serves the built frontend and API from the same service.
