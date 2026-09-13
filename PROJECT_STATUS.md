# CORE-INVENTORY — Project Status & Handoff

*Last updated: 2026-09-12, following a debugging + Firebase migration session.*

This file exists so a new Claude Code session (or any future contributor) can pick up
exactly where things left off without re-explaining context. Read this fully before
making changes.

---

## 1. What This Project Is

Enterprise inventory management system (Petronas AI Innovator project). Full
architecture is documented in `GEMINI.md` at the project root — read that first for
schema, API reference, and directory structure. This file only covers what has
changed or been decided **since** that doc was written.

---

## 2. Key Architectural Decisions

**Decision (earlier session): Migrate inventory DATA to Firebase Firestore. Keep
AUTHENTICATION on Flask/SQLite.**

Rationale: SQLite doesn't survive most free/cheap hosting platforms (filesystem
resets on redeploy). Firestore was already partially wired in (read path existed,
see below), so finishing that migration was less work than solving SQLite
persistence for hosting. Auth was deliberately left on Flask since it was already
tested and working, and splitting auth out reduces migration scope/risk.

**Decision (2026-09-12, revised): Reads go direct frontend → Firestore. Writes
go frontend → Flask → Firestore (Admin SDK), NOT frontend → Firestore directly.**

An earlier pass this session had the frontend write to Firestore directly via the
client SDK (mirroring the read path). That was reverted in favor of routing all
writes through Flask, because it lets Firestore Security Rules **block 100% of
client-side writes** (`allow write: if false`) while Flask's Admin SDK — which
always bypasses security rules — remains the only writer. This keeps a single,
already-tested auth boundary (the Flask session cookie) as the sole gate on
mutations, instead of standing up a second identity system (Firebase Auth) just
to let rules distinguish legitimate writers from anyone with the public API key.
See Section 4 for what this looks like concretely, and Section 6 for the read-side
security rule that pairs with it.

**This means going forward:**
- `GET /api/inventory` (Flask/SQLite) is legacy — the frontend reads inventory
  directly from Firestore when `VITE_USE_FIREBASE=true`.
- `POST /api/inventory/transaction` (Flask) is **not** legacy — it is the
  permanent, sole write path for inventory data. It now writes to Firestore (via
  the Admin SDK) instead of SQLite when the backend's `USE_FIREBASE` flag is on
  (see Section 4). The frontend always calls this endpoint for writes, regardless
  of `VITE_USE_FIREBASE`.
- `POST /api/login`, `POST /api/logout`, `GET /api/me` (Flask/SQLite `users` table)
  remain the source of truth for auth. Do not migrate these to Firebase Auth
  unless a future decision explicitly changes this.

---

## 3. Bugs Found & Fixed This Session

1. **`app.py` path resolution** — Added `BASE_DIR` to `sys.path` so the app resolves
   its own module and DB path regardless of the working directory it's launched from.
2. **`app.py` CORS** — Added `CORS(app, supports_credentials=True, origins=[...])`
   for the Vite dev origins. Confirmed working via manual header inspection.
3. **`app.py` duplicate `app.run()`** — A premature call was cutting off route
   registration. Fixed by moving the single `app.run()` to the bottom of the file.
4. **`storageService.ts` payload shape handling** — `/api/inventory` returns
   `{ "items": [...] }` (confirmed via manual testing, NOT a bare array). The
   frontend fetch logic now handles this shape defensively.

### Bug investigated and found to be a **non-issue** (false alarm from bad test data):
- Initially looked like `OUT` transactions were increasing `avail_qty` instead of
  decreasing it. Root cause was a **testing mistake**, not a code bug: the manual
  test sent `qty_changed: -2` for an `OUT` action, but `inventory_manager.py`'s OUT
  logic expects an **unsigned/positive** `qty_changed` (it applies the negative sign
  internally). Confirmed correct behavior once tested with `qty_changed: 2`. **No
  code change was needed here** — just documenting so this isn't "re-discovered"
  and "re-fixed" incorrectly later.

---

## 4. Firestore Migration — Current State

### Done:
- Firestore **Native mode** database created for project `petrosainsteamb`
  (region: check Firebase console — was not recorded here, verify before assuming).
  Currently in **test mode** rules (open access) — see Section 6, this is NOT
  production-safe yet.
- One-time migration script (`database/migrate_to_firestore.py`) written and run
  successfully. All **109 rows** from SQLite (`products` JOIN `store_inventory`)
  were copied into Firestore's `store_inventory` collection.
  - Document ID scheme: `{sku}_{store_name}` (spaces replaced with underscores).
  - Fields written: `sku`, `name`, `category`, `asset_type`, `store_name`, `qty`,
    `avail_qty`, `status`, `last_stocktake` — matching SQLite's native naming
    (the frontend read mapping accepts both camelCase and snake_case, see below).
- `src/services/storageService.ts` `fetchInventory()` **already had** a working
  Firestore read branch (gated by `USE_FIREBASE` constant, line ~16, reading
  `import.meta.env.VITE_USE_FIREBASE`). This was pre-existing code, not written
  this session. Confirmed working against the freshly migrated data (pending final
  visual confirmation in the running app — see "Immediate Next Steps").
- **`.env.local` finding (2026-09-12):** There is **no plain `.env` file** in the
  project at all (the claim above that it existed with `VITE_USE_FIREBASE=true`
  does not reflect what's on disk). A `.env.local` file exists and was found set
  to `VITE_USE_FIREBASE=false` — since Vite loads `.env.local` with higher
  precedence than `.env`, the app had actually been running against Flask/SQLite
  reads this whole time, not Firestore, contrary to what this doc previously said.
  Flagged to the user; **on their instruction, `.env.local` was changed to
  `VITE_USE_FIREBASE=true`** so the Firestore write path (below) could be tested.

### Done (this session, 2026-09-12) — superseded/final version:

An initial pass added a direct frontend→Firestore write path
(`applyFirestoreTransaction()` in `storageService.ts`). **This was reverted** in
favor of routing writes through Flask (see Section 2's revised decision). What's
actually in place now:

- **Frontend (`src/services/storageService.ts`)**: `postTransaction()` and the
  offline `syncQueue()` replay logic both **always** POST to
  `/api/inventory/transaction`, regardless of `USE_FIREBASE` — unchanged from the
  original pre-session behavior. No Firestore write code remains on the frontend.
- **Frontend (`src/services/firebase.ts`)**: now also exports `auth` (Firebase
  Auth instance) and `authReady` — a promise that resolves once an **anonymous**
  Firebase Auth session is established. `fetchInventory()` awaits `authReady`
  before reading from Firestore, because the security rules (Section 6) require
  `request.auth != null` to read. This anonymous session is **not** tied to the
  Flask login in any way — see Section 6 for what it does and doesn't protect
  against.
- **Backend (`database/inventory_manager.py`)**: new `record_transaction_firestore()`
  function, same signature/contract as the existing `record_transaction()`
  (SQLite version). Uses the Firebase Admin SDK (`firebase_admin`, already a
  dependency — `migrate_to_firestore.py` uses it too) with a Firestore
  **transaction** (`@firestore.transactional`) for atomicity, reading and
  updating the `{sku}_{store_name}` document in `store_inventory`:
  ```
  IN:         new_qty = qty + delta;         new_avail = avail_qty + delta
  OUT:        new_qty = qty (unchanged);     new_avail = avail_qty - delta
              (delta here is the positive qty_changed sent by the client;
              raises ValueError if delta > current avail_qty, same as SQLite version)
  ADJUSTMENT: new_qty = max(0, qty + delta); new_avail = max(0, avail_qty + delta)
  ```
  The `inventory_logs` audit-trail row is still written to local SQLite after the
  Firestore transaction commits (the frontend never reads that table directly, so
  keeping it local is low-risk and preserves operator accountability without
  migrating that table too). **Important**: this audit-log write is wrapped in its
  own try/except that only warns on failure — it must never raise after the
  Firestore write has already committed, since Firestore is now the actual source
  of truth. (This exact bug was hit and fixed during testing — see below.)
- **Backend (`database/inventory_manager.py`)**: new module-level `USE_FIREBASE`
  flag — `os.environ.get("USE_FIREBASE", "true").strip().lower() == "true"`.
  Defaults to `True`. This is a **separate** flag from the frontend's
  `VITE_USE_FIREBASE` (different runtime, no shared config) — keep both in sync
  manually. `process_sync_queue()` (the admin-triggered SQLite `sync_queue`
  replay endpoint) also now branches on this flag.
- **Backend (`database/app.py`)**: `POST /api/inventory/transaction` now calls
  `record_transaction_firestore()` instead of `record_transaction()` when
  `USE_FIREBASE` is true. Auth check (`session["user_id"]` required → 401) and
  all error handling (422 on `ValueError`, 500 otherwise) is unchanged.

**Bug found and fixed during testing:** the first implementation ran the
Firestore transaction, then unconditionally tried to `INSERT` the SQLite audit
log row, and let any exception there propagate — which would report a
transaction as **failed** to the caller even though Firestore had already been
updated. Reproduced this for real: a test run with a non-existent `user_id` hit
a foreign-key error on the `inventory_logs` insert, and Firestore's `C001` doc
was left at incorrect values (a stray `+3` that never got corrected) while Flask
would have returned an error. Fixed by catching and only warning on audit-log
failures.

- **Testing performed:**
  - `npx tsc --noEmit` (frontend) — no new type errors (3 pre-existing, unrelated
    errors in `AuthPage.tsx` / `StockCheckPage.tsx` remain, not touched here).
  - `python -c "import app"` — Flask app imports cleanly with the new Firestore
    branch; confirmed `USE_FIREBASE` reads as `True` by default.
  - Called `record_transaction_firestore()` directly for IN/OUT/ADJUSTMENT against
    the **live Firestore database** (`C001_MAKER_STUDIO`) — all three produced
    correct `qty`/`avail_qty`/`status`, including the ADJUSTMENT clamp-to-0 case.
    Restored original values after.
  - Full **HTTP round-trip** against a real running Flask server: logged in via
    `POST /api/login` (curl, real session cookie), then `POST
    /api/inventory/transaction` with `IN qty_changed=5` — confirmed the change
    independently by reading the Firestore document afterward (12 → 17), then
    restored it to 12. Also confirmed the unauthenticated case still returns 401
    and an over-large `OUT` still returns 422 with the same message as before,
    without touching Firestore.
  - **Not yet tested:** full browser UI click-through (login → scan → confirm
    transaction → see it reflected). No browser automation tool (Playwright/
    chromium-cli) is installed in this environment. Recommend a manual pass:
    run `npm run dev` + `python database/app.py`, log in as `adam`/`password123`,
    perform a transaction, and confirm the change in the Firebase console.

---

## 5. Deployment — Not Started

Nothing has been deployed yet. The app currently only runs locally
(`localhost:5173` frontend via `npm run dev`, `localhost:5000` backend via
`python app.py`). Planned path (not yet executed):

1. Finish the Firestore write-path fix above FIRST.
2. Deploy Flask (now just handling auth) to Render or similar — needs a public
   URL. No persistent disk needed anymore for inventory data, since that's moving
   to Firestore. Session/user table (SQLite `users`) still needs *some* persistence
   plan on whatever host is chosen — verify this before assuming Render's free tier
   is sufficient long-term for even that.
3. Deploy frontend (React/Vite) to Vercel or Netlify.
4. Update `app.py` CORS `origins` list to include the new deployed frontend URL
   (currently only allows localhost origins).
5. Update any hardcoded `/api/...` relative fetch paths in `authService.ts` to use
   an absolute URL via an env variable, since Vite's local dev proxy won't exist in
   production.

---

## 6. Security Notes — Must Address Before Going Public

### Firestore Security Rules — decided, written, NOT yet published (blocked)

- **The Flask/Firebase auth mismatch**: Firestore Security Rules only ever see
  `request.auth`, which comes from Firebase Auth — they have zero visibility into
  the Flask session cookie. So a rule like `allow write: if request.auth != null`
  can't distinguish "someone logged into the app" from "anyone with the public
  Firebase config who calls the client SDK themselves." Three options were
  presented (custom-token exchange tying Firebase Auth to the Flask login;
  routing writes through Flask via the Admin SDK; anonymous-auth as a cheap
  scraping deterrent) — **the user picked a hybrid**:
  - **Writes**: `allow write: if false` — always, for every client. All writes go
    through Flask's Admin SDK (Section 2/4), which bypasses rules entirely, so
    this is a real, unconditional block on client-side writes.
  - **Reads**: `allow read: if request.auth != null`, paired with a silent
    `signInAnonymously()` call on app load (`src/services/firebase.ts`). This is
    **not** real access control tied to the Flask login — anyone with the public
    Firebase config (already exposed in the JS bundle) could call
    `signInAnonymously()` themselves from devtools and read everything. It only
    stops direct, no-SDK scraping of the Firestore REST endpoint by someone who
    never loads the app.
- Rules file written: `firestore.rules` (project root). Matches the above; also
  default-denies every other collection.
- **BLOCKED on a manual step**: tested `signInAnonymously()` against the live
  project and got `auth/configuration-not-found` — **Firebase Authentication has
  never been initialized for this project**, not just "Anonymous provider
  disabled." Required before publishing `firestore.rules`:
  1. Firebase Console → `petrosainsteamb` → Build → Authentication → Get started.
  2. Sign-in method → enable **Anonymous**.
  3. Only then publish `firestore.rules` (Firestore Database → Rules tab → paste
     → Publish; no `firebase-tools` CLI is installed locally, so console paste is
     the path of least resistance, though the CLI works too if installed).
  **Publish rules only after step 2** — publishing them first would break every
  read (`request.auth` can never be non-null until Anonymous is enabled and the
  frontend's sign-in succeeds).
- Until this is published, **Firestore is still in open test-mode rules** —
  anyone with the project's client config can currently read or write
  `store_inventory` directly. Do not treat this as fixed until `firestore.rules`
  is actually live in the console.

### Other items

- A Firebase Admin service account JSON
  (`database/petrosainsteamb-firebase-adminsdk-fbsvc-e4494b1913.json`) was
  generated for the migration script and is now also used at runtime by
  `record_transaction_firestore()`. **Confirmed added to `.gitignore`** — verify
  this is still true before every commit, since this file grants full admin
  access and must never reach a public repo. It will also need to reach the
  Flask deployment target (Render) as a secret file, not a committed one — see
  Section 5.
- The Firebase **client** API key (`VITE_FIREBASE_API_KEY=...` in `.env.local`)
  is safe to expose in a frontend bundle by design — it is not a secret — but
  Firestore security rules are what actually protect the data, not this key.
  Don't confuse the two.

---

## 7. Immediate Next Steps (in order)

1. ~~Confirm the running app displays all 109 migrated items~~ — reads path was
   already confirmed working pre-existing code (Section 4).
2. ~~Implement the Firestore write path~~ — **done** 2026-09-12, via Flask +
   Admin SDK, not a direct frontend write (Section 2/4).
3. **[BLOCKED ON USER] Enable Firebase Authentication + Anonymous provider** in
   the Firebase Console (Section 6) — required before the read-side security
   rule can work at all.
4. Publish `firestore.rules` (Section 6) — only after step 3.
5. **Manually re-test the full loop in a real browser**: login (Flask) → view
   inventory (Firestore) → perform a transaction via the UI → confirm the change
   appears both in the UI and in the Firebase console under `store_inventory`.
   The write logic itself was verified this session via direct calls and a real
   HTTP round-trip through Flask, but the UI click-path (scan/confirm modal →
   `postTransaction()` call) was not — no browser automation tool was available
   in this environment.
6. Proceed to deployment (Section 5) — Flask to Render, frontend to Vercel, CORS
   origins update, `authService.ts` relative→absolute URL fix.

---

## 8. Known Gaps / Things to Verify, Not Yet Confirmed

- Exact Firestore region chosen during setup — not recorded, check console.
- Whether `authService.ts` needs any changes at all for deployment (likely just the
  relative-path-to-absolute-URL fix mentioned in Section 5, but not yet reviewed
  in full).
- Long-term plan for `sync_queue` table in SQLite (used for admin-triggered replay
  of offline mutations server-side, per `GEMINI.md` Section 5) — this may become
  redundant once the frontend's own `pendingMutations` queue talks to Firestore
  directly, but this hasn't been explicitly decided.
- **No `requirements.txt` exists in `database/`.** Flask deployment to Render
  (Section 5) will need one — must include at minimum `flask`, `flask-cors`,
  `firebase-admin` (newly load-bearing as of this session — `record_transaction_firestore()`
  depends on it, not just the one-time migration script anymore).
- **`USE_FIREBASE` in Flask has no `.env` loading mechanism** — it's a plain
  `os.environ.get(...)`, since `python-dotenv` isn't installed and wasn't added
  (kept dependency footprint minimal). Locally it silently defaults to `"true"`.
  On Render, it'll need to be set explicitly as a dashboard environment variable
  when deployment happens (Section 5) — otherwise it'll still default to `true`,
  which happens to be correct, but that should be an explicit choice, not luck.
