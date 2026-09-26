# CORE INVENTORY + AI Programme Consultant

CORE INVENTORY is a React/TypeScript + Flask inventory application with YOLO/TFLite scanning, Stock Check approval, shared server-side inventory, authentication, offline mutation support, and an integrated Petrosains **AI Programme Consultant**.

The new Programme Consultant interprets stakeholder requests, recommends only verified catalogue offerings, builds a programme storyline and participant journey, clearly separates AI-created enhancements, applies catalogue constraints, and uses the live inventory as read-only supporting context.

See [`AI-PROGRAMME-CONSULTANT.md`](AI-PROGRAMME-CONSULTANT.md) for the AI architecture and setup.

## Local setup

### 1. Install frontend dependencies

```bash
npm install
```

### 2. Install backend dependencies

```bash
python -m pip install -r database/requirements.txt
```

### 3. Start Flask

```bash
python database/app.py
```

### 4. Start Vite in another terminal

```bash
npm run dev
```

Vite forwards `/api` to `http://127.0.0.1:5000` during development.

**No Gemini/OpenAI API key is required for the Programme Consultant.** It uses a local catalogue-guided recommendation engine in the Flask backend.

## Running tests

Backend (Flask API - `pytest` against a throwaway SQLite file, no network calls):

```bash
python -m pip install -r database/requirements-dev.txt
pytest database/test_app.py -v
```

Frontend (pure business logic - filtering/sorting, YOLO-to-inventory mapping):

```bash
npm run test
```

## Production / Render

`render.yaml` builds the Vite frontend and runs the Flask app with Gunicorn. No external AI API environment variable is required.

## Existing inventory behaviour preserved

A YOLO scan only changes inventory through one of two explicit actions the operator picks on the Scan page: "Send to Stock Check" (saved as a proposal; quantities change only after Stock Check reconciliation) or "Add to Inventory" (adds the detected count straight onto existing stock at that location, for restocking). The AI Programme Consultant has no inventory mutation endpoint.
