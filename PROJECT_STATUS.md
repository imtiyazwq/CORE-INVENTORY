# CORE-INVENTORY — Project Status & Handoff

*Last updated: 2026-09-13 — Firestore write path, Security Rules, the
SKU-identity fix, Adjust Stock, Stock Check, and open self-registration are
all done and tested locally (Sections 9–16). Deployment prep for
Flask→Render + frontend→Vercel is done and tested on the code side
(Section 17) — `requirements.txt`, `.env` loading, CORS placeholder,
absolute API URLs, Firebase env-var wiring. **Not yet done: the actual
Render/Vercel account creation and dashboard setup** — those are steps only
the user can do; a full walkthrough was delivered in chat, and this doc
needs the real URLs filled in (CORS origin, `VITE_API_URL`) once they
exist. Explicit priority for this pass: working online over hardening or
scale — see Section 17's "still open" list for what that deliberately
leaves unresolved.*

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
  Was initially left in open test-mode rules; **proper rules are now published
  and verified live** — see Section 6.
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

### Firestore Security Rules — DONE, published and verified live (2026-09-13)

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
- Rules file: `firestore.rules` (project root). Matches the above; also
  default-denies every other collection.
- **Setup history**: `signInAnonymously()` initially failed with
  `auth/configuration-not-found` — Firebase Authentication had never been
  initialized for the project. User enabled it (Console → Authentication → Get
  started → Sign-in method → Anonymous), confirmed by re-running the same check
  (succeeded, got back a real anonymous `uid`). User then published
  `firestore.rules` via the Firestore Database → Rules tab in the console
  (`firebase-tools` deploy was attempted first but the existing Admin SDK service
  account lacks the IAM permissions the CLI needs for a `serviceusage.googleapis.com`
  check — 403 — so console paste was used instead; broadening that service
  account's IAM role wasn't done, since it's a live-project permissions change
  and unnecessary for a one-time manual publish).
- **Verified live** (2026-09-13) with three direct SDK checks against the real
  project, each in its own isolated Firebase app instance:
  1. Unauthenticated `getDocs(collection(db, 'store_inventory'))` → **denied**
     (`permission-denied`). Confirms the open test-mode rules are gone.
  2. `signInAnonymously()` then the same read → **succeeded**, returned all
     109 documents. Confirms the frontend's actual `fetchInventory()` path
     (which awaits `authReady` before reading) will work.
  3. Same anonymous session attempting `updateDoc()` on `store_inventory` →
     **denied** (`permission-denied`). Confirms writes are blocked for every
     client regardless of auth state, exactly as intended — only Flask's
     Admin SDK can write.
- **Current state: this is done.** Firestore is no longer in open test mode.
  Reads require (anonymous) Firebase Auth; writes are blocked for all clients
  and only happen via Flask's `record_transaction_firestore()`.

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
3. ~~Enable Firebase Authentication + Anonymous provider~~ — **done** 2026-09-13
   by the user (Section 6).
4. ~~Publish `firestore.rules`~~ — **done and verified live** 2026-09-13
   (Section 6) — unauthenticated reads denied, anonymous reads allowed, all
   client writes denied, confirmed with direct SDK checks against the real
   project.
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
- **`StockCheckPage.tsx` is broken and unwired** — not imported anywhere in
  `App.tsx`, no page ID for it in `Sidebar.tsx`'s `PageId` type or nav items, and
  it doesn't even compile (`StockCheckRecord` / `StockCheckItem` referenced from
  `../types` don't exist there — 2 of the 3 pre-existing `tsc` errors mentioned
  throughout this doc are this file). Not touched this session — explicitly out
  of scope per the user. Undecided: finish building it as the real "physical
  stocktake / bulk ADJUSTMENT" page it was clearly meant to be, or remove it.
- **`CheckoutModal.tsx` / checkout-in-online doesn't reach the backend** —
  `storageService.checkoutItem()` / `checkinItem()` update local UI state and
  buffer an offline mutation, but `enqueueOfflineMutation()` only actually sends
  anything to the server when `isOnline` is false; when online it just stamps
  `lastSyncedAt` and returns. So checking an asset out/in while online never
  calls `postTransaction()` or reaches Flask/Firestore at all — it only shows up
  in that browser's local state until an offline→online sync cycle happens to
  run. Not touched this session — explicitly out of scope per the user.

---

## 9. Feature: Manual IN / OUT / ADJUSTMENT Stock Transactions (2026-09-13)

**New feature, not a bug fix.** Previously, the only UI path that could change
stock quantities was Scan Inventory's "Add Item Manually → Confirm", which is
hardcoded to `action: 'IN'` — there was no UI for OUT or ADJUSTMENT at all (see
the investigation below). This adds one.

### What was found (investigation, before any code was touched)

- **`ConfirmScanModal.tsx`** existed as **dead code** — a fully-built modal with
  an editable item/quantity table and a "Confirm Scan & Update Inventory"
  button, but never imported or rendered by anything in the app. It had no
  concept of transaction `action` type at all — it was implicitly a single
  "commit these detected quantities" flow tied to the old CV-scan-detection
  shape (`DetectedSummaryItem[]`: className/count/confidence, no SKU).
- **`StockCheckPage.tsx`** looked like the natural home for an ADJUSTMENT-style
  "reconcile the physical count" feature but is orphaned/broken (see Section 8)
  — left alone this session per explicit instruction.
- **`CheckoutModal.tsx`** is reachable but models asset custody ("assign to
  Sarah in Engineering"), not a general stock decrement — left alone this
  session per explicit instruction.

### What was built

- **`ConfirmScanModal.tsx` was rewritten** (same file/export name, per
  instruction — not renamed) from a multi-item CV-detection-review table into a
  single-item stock transaction modal:
  - Props changed from `detectedItems: DetectedSummaryItem[]` to `item:
    InventoryItem` (matching `CheckoutModal`'s existing single-item pattern) —
    it's now opened for one specific catalog row at a time.
  - Added a 3-way action selector: **Stock In (IN)**, **Stock Out (OUT)**,
    **Adjustment (ADJUSTMENT)**, styled as segmented pill buttons matching the
    tab pattern already used in `ScanInventoryPage.tsx`.
  - Added an Increase/Decrease sub-toggle that only appears for ADJUSTMENT.
  - Location is shown **read-only** (not an editable dropdown like the old
    version had) — it's fixed to the item's current `location`, since
    `{sku}_{store_name}` is a composite key and letting the user retarget it
    to a different store from this modal would silently write to the wrong
    store's document (or fail if that SKU isn't stocked there).
  - Live preview text shows the resulting `quantity`/`availableQuantity`
    before submit, computed with the exact same math as the backend.
  - On submit, calls `storageService.postTransaction()` **directly** (per
    explicit instruction — this is a deliberate, one-off deviation from
    `CheckoutModal`'s convention of bubbling intent up to `App.tsx` via a
    callback prop; `App.tsx` is only involved for the success toast).
  - **Payload contract** (matches `database/inventory_manager.py`'s
    `record_transaction()` / `record_transaction_firestore()` exactly):
    - IN: `qty_changed` = positive magnitude to add.
    - OUT: `qty_changed` = positive magnitude to remove (server negates it).
    - ADJUSTMENT: `qty_changed` = **signed** delta — positive to increase,
      negative to decrease. **Note**: the task description characterized
      `qty_changed` as "always positive/unsigned regardless of action" — that
      holds for IN and OUT, but not for ADJUSTMENT, whose backend
      implementation (`new_qty = max(0, qty + qty_changed)`) uses the delta's
      sign directly with no server-side negation. Built to match the real
      backend code, not that description; the modal's UI still only ever asks
      the user for a positive magnitude (via the Increase/Decrease toggle) so
      this doesn't leak into the UX, just the outgoing payload.
  - Client-side validates OUT against `item.availableQuantity` before even
    calling the API (fast feedback), but the server's own check is still the
    real guard.
- **`storageService.ts`'s `postTransaction()` signature changed**:
  `Promise<void>` → `Promise<{ success: boolean; error?: string }>`. Previously
  a rejected transaction (e.g. OUT with insufficient stock, a 422) was
  swallowed silently — the optimistic UI update got reverted by a background
  re-fetch, but the caller had no way to know it failed. This is additive/
  backward compatible — `App.tsx`'s existing `handleScanConfirmed` still just
  does `await storageService.postTransaction(txn)` and ignores the return
  value, unaffected. The new modal is the first caller that actually checks
  `result.success` / `result.error` to show a real inline error instead of
  falsely reporting success.
- **`InventoryPage.tsx`**: added a new "Adjust Stock" button (slate/neutral
  styling, existing button pattern) next to the existing Check In/Check Out
  buttons on every row. Opens the modal for that row's item. New optional
  `onStockAdjusted?: (message: string) => void` prop, threaded through.
- **`App.tsx`**: new `handleStockAdjusted(message)` → `addToast('success',
  'Stock Updated', message)`, wired to `InventoryPage`'s `onStockAdjusted`,
  matching the existing toast pattern used for checkout/checkin/sync/etc.

### Testing performed

- `npx tsc --noEmit` — no new errors (same 3 pre-existing ones, both
  `StockCheckPage.tsx` errors and the unrelated `AuthPage.tsx` one).
- Verified all three action types **end-to-end over real HTTP** against the
  running Flask server + live Firestore, sending the exact payload shapes the
  modal itself computes for a given action/direction/magnitude:
  - IN qty_changed=3 on `C001_MAKER_STUDIO` (12/12 baseline) → 15/15. Correct.
  - OUT qty_changed=2 (positive, as the modal sends it) → qty stays 15,
    avail → 13. Correct.
  - ADJUSTMENT qty_changed=-4 (decrease direction) → qty max(0,15-4)=11, avail
    max(0,13-4)=9. Correct.
  - ADJUSTMENT qty_changed=+1 (increase direction) → qty 12, avail 10.
    Correct.
  - Restored the document to its 12/12 baseline afterward.
- Verified the error path: OUT qty_changed=9999 (exceeds available) → HTTP 422,
  `{"error": "Insufficient available stock for OUT: requested 9999, available
  12."}`, and confirmed Firestore was **not** modified. This is the exact
  message `postTransaction()` now surfaces via `result.error`, which the modal
  displays inline.
- **Not tested**: the actual browser click-path (opening the modal, clicking
  through the UI, watching the toast/table update). No browser automation tool
  is available in this environment. See manual test steps below.

### Manual browser test steps (do this to confirm end-to-end)

1. `.env.local` should already have `VITE_USE_FIREBASE=true` (set earlier this
   project). Start both servers: `python database/app.py` and `npm run dev`.
2. Log in as `adam` / `password123`.
3. Go to **Inventory** in the sidebar. Pick any item you don't mind changing
   temporarily (e.g. note its current Quantity/Available values first so you
   can manually restore them after, since this is real production data).
4. Click **Adjust Stock** on that row.
5. **Test IN**: leave "Stock In" selected, enter a quantity (e.g. `2`), click
   **Confirm Transaction**. Expect: a green "Stock Updated" toast, the modal
   closes, and the row's Quantity/Available both increase by 2 within a
   second or two (re-fetched from Firestore).
6. **Test OUT**: reopen the modal on the same item, switch to "Stock Out",
   enter a quantity within the available amount (e.g. `1`), confirm. Expect:
   toast, Available decreases by 1, Quantity unchanged.
7. **Test OUT rejection**: reopen, switch to "Stock Out", enter a quantity
   larger than what's shown as available. Expect: an inline red error in the
   modal itself (no toast, modal stays open) — either the client-side message
   ("Cannot remove N — only M available") if caught before submit, or the
   server's `Insufficient available stock...` message if you bypass the min/max
   on the number input.
8. **Test ADJUSTMENT**: reopen, switch to "Adjustment", try both "Increase (+)"
   and "Decrease (-)" with some quantity, confirm each. Expect: Quantity AND
   Available both change by that amount (unlike IN/OUT, ADJUSTMENT moves both).
9. **Confirm in Firestore console**: open the Firebase console →
   `petrosainsteamb` → Firestore Database → `store_inventory` collection → find
   the document (`{SKU}_{STORE_NAME}`, spaces as underscores) → confirm
   `qty`/`avail_qty`/`status` match what the UI showed after each step above.
10. Restore the item's original values afterward (via another Adjust Stock
    transaction, or by editing the Firestore document directly) if this was
    real inventory data you don't want permanently changed.

---

## 10. Root Cause Fix: className → SKU Identity (2026-09-13)

**This supersedes the framing in Section 9.** Section 9 fixed a real, separate
gap (no UI existed anywhere for OUT/ADJUSTMENT), but the user later clarified
the *original* bug report was specifically about `ScanInventoryPage.tsx`'s
main AI-detection / "Confirm & Update Inventory" workflow — a different page,
untouched by Section 9's work. Investigating that turned up the actual root
cause.

### The bug

Every item on `ScanInventoryPage.tsx` (both AI/webcam/upload detections and
the "Add Item Manually" dropdown) is identified only by a YOLO **className**
string (e.g. `'nodemcu esp32'`) — there was no `sku` field anywhere on
`ConfirmedItemRow`. But the entire backend (`products.sku`, the
`store_inventory` composite key, Firestore's `{sku}_{store_name}` document
IDs) is built around SKU as the identity. `App.tsx`'s `handleScanConfirmed`
tried to bridge this gap with a fallback: match the detection's `className`
against a loaded `InventoryItem`'s catalog `name`, case-insensitively, exact
string equality only.

**That fallback is broken for 13 of the 15 trained YOLO classes.** YOLO class
labels are ML-training tokens (`Arduino_Uno`, `nodemcu esp32`,
`tongue_depressor`) and product catalog names are human-readable strings from
the Excel import (`Arduino Uno`, `NodeMCU`, `Tongue depressor`) — two
independent naming schemes that only coincidentally agree for `breadboard`
and `pen`. Confirmed by direct string comparison and cross-referencing the
real database (SQLite `products` table AND the live Firestore
`store_inventory` collection), not by inference:

| YOLO className | Product name | Exact match? |
|---|---|---|
| `Arduino_Uno` | `Arduino Uno` | No (underscore vs space) |
| `a4_colored_paper` | `A4 colored paper` | No (underscore vs space) |
| `nodemcu esp32` | `NodeMCU` | **No** (extra "esp32", different structure) |
| `scissors` | `Scissor` | No (plural vs singular) |
| `goggles` | `Safety Goggle` | No (unrelated naming) |
| `tongue_depressor` | `Tongue depressor` | No (underscore vs space) |
| `sticky note paper` | `Sticky note` | No (extra word) |
| `breadboard` / `pen` | same | Yes (coincidence) |
| `bag_arduino_20`, `bag_arduino_30`, `bundle_arduino`, `box sticky note`, `cup_rim`, `full_cup` | *(none)* | N/A — no product exists |

When the match fails, `sku` ends up `undefined`, and the old code did
`console.warn(...); return;` — **silently dropping that item** while the
overall scan still fired a green "Scan Committed" toast claiming the full
total quantity was logged. This is very likely the real mechanism behind the
original "my stock changes don't show up" report — for 13 of 15 possible
detections, including the NodeMCU example the user gave, nothing was ever
posted to the backend, with no visible error.

### The fix

- **`YOLOClassLabel`** (`src/types/index.ts`) gained a `sku: string | null`
  field.
- **`yoloConfig.ts`** gained `YOLO_CLASS_SKUS: Record<string, string | null>`
  — a hand-verified className → SKU table, checked against the real product
  catalog (see table above; full reasoning and per-entry comments are in the
  file itself). **9 of 15** classes map to a real SKU; **6 of 15** are
  `sku: null`, for two distinct reasons — this count needed re-verification,
  see "Known catalog gap" below.
- **`modelService.ts`**'s `DEFAULT_YOLO_LABELS` now populates `sku` from that
  table for every class.
- **`ScanInventoryPage.tsx`**: `ConfirmedItemRow` gained `sku: string | null`,
  threaded through all three places a row gets created — the webcam detection
  loop, the upload/YOLO-on-canvas path, and manual "Add Item Manually" — all
  pulling `sku` from the same `DEFAULT_YOLO_LABELS` lookup already used for
  `category`. `handleFinalConfirm` now forwards `sku` to `onScanConfirmed`.
  Also softened the page's own immediate local success banner text (it used
  to unconditionally claim "Successfully logged X units!" before the async
  transactions even ran) to a neutral "submitted for processing" message,
  since the real success/failure report now comes from `App.tsx`'s toast.
- **`App.tsx`**'s `handleScanConfirmed` was rewritten:
  - **SKU resolution now uses `det.sku` (from the verified table) as the
    primary lookup.** The old name-matching logic is kept only as a
    last-resort fallback for defensiveness, not as the source of truth — it's
    the same unreliable comparison as before, just demoted.
  - **No more silent drops.** The function is now `async`, awaits every
    `postTransaction()` call via `Promise.all` (the old code used
    `.forEach(async ...)` and fired its success toast immediately,
    **before any of the transactions had even completed** — a second,
    independent bug this fix also corrects), and classifies each item as
    succeeded or failed (missing SKU, or a real `postTransaction()` rejection
    like insufficient stock).
  - **Honest toasts**: all succeeded → green "Scan Committed". All failed →
    amber "Scan Not Recorded" naming what couldn't be added and why. Mixed →
    a success toast for what went through plus a separate warning toast
    listing what didn't, so the items that DID succeed are never held hostage
    by the ones that didn't.

### Testing performed

- `npx tsc --noEmit` — no new errors beyond the same 3 pre-existing,
  unrelated ones (fixed one *new* error this change introduced in
  `SettingsPage.tsx`'s custom-class-add handler, which also constructs a
  `YOLOClassLabel` — now sets `sku: null` there too, correctly, since a
  freshly user-added class has no catalog mapping yet).
- **Verified the real `YOLO_CLASS_SKUS` table directly** (not just by
  reasoning about it) by evaluating `yoloConfig.ts` with `tsx` — output
  matched the hand-verified table exactly, including `'nodemcu esp32' ->
  'E006'` and all 6 nulls.
- **NodeMCU end-to-end**: simulated the fixed pipeline's resolved payload
  (`sku: 'E006'`, the real value `DEFAULT_YOLO_LABELS` now resolves for
  `'nodemcu esp32'`) as a real HTTP `POST /api/inventory/transaction` against
  the running Flask server, authenticated as `adam`. `E006_CHILLAX` went from
  111/111 → 113/113, confirmed by an independent Firestore read afterward,
  then restored to 111/111.
- **Null-sku warning path**: extracted the exact decision algorithm (item
  resolution → `postTransaction` → success/failure classification → toast
  selection) into a standalone script and ran three cases — all-null-sku
  (→ "Scan Not Recorded" warning), a mix of one resolvable + one null-sku
  item (→ partial-success toast + a separate skipped-items warning), and
  all-resolvable (→ plain "Scan Committed", no warning). All three produced
  the expected toast type and message. This tests the real logic verbatim,
  not a re-implementation — the algorithm was copied into the test script
  unchanged.
- **Not tested**: the actual browser click-path (scanning/manually adding
  NodeMCU through the real UI, watching the toast appear). No browser
  automation tool is available in this environment.

### Known catalog gap (flagged, not decided)

**6 of the model's 15 trained classes have no usable product mapping** —
more than the 4 the user had assumed going in (`bag_arduino_20`,
`bag_arduino_30`, `bundle_arduino`, `box sticky note`); re-verification
against the live database also turned up `cup_rim` and `full_cup`. These
split into two different problems:

- `bag_arduino_20`, `bag_arduino_30`, `bundle_arduino` — **no candidate
  product exists at all** in the 109-item catalog. The model was seemingly
  trained on objects that were never added to inventory, or were later
  removed.
- `box sticky note`, `cup_rim`, `full_cup` — **a plausible candidate product
  exists** (`Sticky note` / `Paper cup`) but each of these pairs with another
  trained class that already claims that same product (`sticky note paper` →
  `Sticky note`; `cup_rim` and `full_cup` both plausibly → `Paper cup`).
  Mapping either one to the shared SKU risks **double-counting a single
  physical object** if both classes fire on it within one scan (e.g. a cup
  detected as `cup_rim` in one frame and `full_cup` in another).

**Not decided here, needs a human call**: either retrain the model to drop
the classes with no product, and merge the ambiguous pairs into one class
each; or extend the product catalog with real SKUs for whichever of these
are actually meant to be tracked separately. Until one of those happens,
scanning/manually adding any of these 6 classes will correctly show a
"could not be added" warning instead of silently vanishing — which is the
fix, but the underlying model/catalog mismatch they represent is still open.

---

## 11. Feature: Per-Item IN/OUT Toggle on ScanInventoryPage (2026-09-13)

**New feature, builds on [Section 10](#10-root-cause-fix-classname--sku-identity-2026-09-13).**
Before this, every confirmed item on `ScanInventoryPage.tsx` — AI detections
*and* manual adds — was hardcoded to `action: 'IN'` in `App.tsx`'s
`handleScanConfirmed`. There was no way to log a removal (`OUT`) from this
page at all; the only OUT-capable UI was `ConfirmScanModal.tsx` ([Section
9](#9-feature-manual-in--out--adjustment-stock-transactions-2026-09-13)), a
one-item-at-a-time modal on the Inventory page. This adds a per-row IN/OUT
toggle directly to the scan confirmation list, so a single scan/manual-add
batch can post a mix of additions and removals in one go. This only makes
sense stacked on top of Section 10's fix — without a resolved `sku` per row,
there'd be nothing to validate an OUT quantity against or post a transaction
for.

### What was built

- **`ConfirmedItemRow` gained an `action: 'IN' | 'OUT'` field**, defaulting to
  `'IN'` everywhere a row is created (webcam detection loop, upload/YOLO
  path, manual "Add Item Manually" dropdown) — preserves the exact prior
  behavior as the default. The webcam loop re-detects and rebuilds this list
  every ~70ms, so it now carries over each row's existing `action` by
  `className` across frames instead of resetting it to `'IN'` on the very
  next detection tick — without that, toggling a live-webcam row to OUT would
  have snapped back to IN before the user could even click Confirm.
- **Per-row IN/OUT toggle**, reusing `ConfirmScanModal.tsx`'s existing
  segmented-pill pattern (bordered pill, `PackagePlus`/emerald for IN,
  `PackageMinus`/rose for OUT) rather than inventing a new control. Each item
  row was restructured from a single line (name/badges + stepper) into two
  stacked lines — name/badges + delete on top, action toggle + quantity
  stepper below — to fit the new control without crowding the existing
  stepper.
- **Client-side OUT-quantity validation**, same pattern `ConfirmScanModal.tsx`
  already uses: `ScanInventoryPage` now receives an `items?: InventoryItem[]`
  prop (`App.tsx` passes `storageState.items`), matches each row's `sku`
  against the item at the page's currently-selected location, and compares
  the row's `quantity` to that item's `availableQuantity`. Rows with no
  resolved `sku` (the Section 10 catalog-gap classes) can't be checked this
  way — they're treated as unbounded here since they'd be skipped by
  `App.tsx` regardless of action.
  - An inline red warning renders directly under any offending row
    ("Cannot remove N — only M available at *Location*").
  - The **Confirm & Update Inventory** button is disabled (not just visually
    warned) while any row is over its available quantity, so an over-limit
    OUT can't be submitted — this is a client-side convenience only; the
    server's own check in `record_transaction_firestore()` is still the real
    guard, unchanged by this feature.
- **Summary text no longer implies one big addition.** The header pill and
  the confirm button both now show an IN/OUT breakdown (e.g. `3 IN · 2 OUT`)
  instead of one combined `"X Units"` total whenever both actions are
  present in the list; falls back to a plain unit count if the list is
  IN-only (unchanged from before) or empty.
- **`App.tsx`'s `handleScanConfirmed`** now reads `det.action` per item
  instead of hardcoding `'IN'` when building each `TransactionPayload`.
  `qty_changed` is unchanged — still the positive magnitude for both IN and
  OUT (the server negates internally for OUT, per the contract documented in
  Section 9). The existing `Promise.all` per-item success/failure handling
  and honest partial-failure toasts from Section 10 are untouched; the
  success/skip toasts were additionally updated to show an IN/OUT breakdown
  (e.g. "Logged 3 IN · 2 OUT at ...") instead of a flat unit count, for the
  same reason as the page's own summary text.
- **The manual-add dropdown gets this for free**: manually-added rows render
  through the exact same `confirmedItems` list and row component as detected
  rows, so the IN/OUT toggle, warning, and totals all apply to them
  automatically — no separate change was needed for that path.

### Testing performed

- `npx tsc --noEmit` — no new errors beyond the same 3 pre-existing, unrelated
  ones (`AuthPage.tsx`, `StockCheckPage.tsx` ×2). One new error this change
  introduced was fixed along the way: `new Map(prev.map(...))` in the webcam
  loop inferred a widened `unknown` value type for the carried-over `action`,
  fixed by typing it explicitly as `Map<string, 'IN' | 'OUT'>`.
- `npx vite build` — production build succeeds (pre-existing chunk-size
  warnings for the TF model bundle, unrelated to this change).
- **Verified the IN/OUT payload wiring against real Firestore**, calling
  `record_transaction_firestore()` directly (the same function
  `/api/inventory/transaction` calls, and what `App.tsx`'s per-item
  `postTransaction()` calls end up hitting) against an isolated test
  SKU/store (`TEST-SKU-INOUT-9001` / `Test-Harness-Location`, seeded at
  qty=100/avail=100 and deleted afterward — no real inventory touched):
  - IN, qty_changed=7 → `new_qty=107`, `new_avail_qty=107`. Confirmed by an
    independent Firestore read after the write, not just the function's
    return value.
  - OUT (same doc, same batch), qty_changed=4 → `new_qty=107` (physical qty
    untouched by OUT, as designed), `new_avail_qty=103`. Also confirmed by
    an independent Firestore read.
  - OUT exceeding available, qty_changed=9999 (> 103 available) → raised
    `ValueError: Insufficient available stock for OUT: requested 9999,
    available 103.`, and the Firestore document was confirmed unchanged
    (107/103) afterward — the rejection didn't partially apply.
  - All 15 checks passed. This exercises exactly the one-IN-one-OUT-in-the-
    same-confirmed-list scenario the task called for, at the layer below the
    UI.
- **Not tested**: the actual browser click-path — toggling a row to OUT in
  the live confirmation list, seeing the inline warning appear/disappear as
  quantity changes, the button actually being disabled, and the resulting
  Firestore change after a real Confirm click. No browser automation tool is
  available in this environment. See manual test steps below.

### Manual browser test steps (do this to confirm end-to-end)

1. Start both servers: `python database/app.py` and `npm run dev`. Log in as
   `adam` / `password123`.
2. Go to **Scan Inventory**. Switch to **Upload Image** (simpler than webcam
   for a controlled test) and use **Add Item Manually** to add two different
   items that both have a real product mapping (avoid the Section 10
   catalog-gap classes — e.g. anything that isn't `bag_arduino_20`,
   `bag_arduino_30`, `bundle_arduino`, `box sticky note`, `cup_rim`,
   `full_cup`).
3. On the first item's row, confirm the IN/OUT pill defaults to **IN**
   (emerald, selected) — this is the "preserves current behavior as the
   default" check.
4. On the second item's row, click **OUT** (rose). Confirm the pill switches
   and the first item's pill is unaffected.
5. Set the second item's quantity (via the +/- stepper) higher than its
   available stock (check the Inventory page first for that item's current
   Available count at this location). Expect: a red inline warning appears
   under that row ("Cannot remove N — only M available at ..."), and the
   **Confirm & Update Inventory** button becomes disabled/greyed out with a
   red notice above it.
6. Lower the quantity back to at or below the available amount. Expect: the
   warning disappears and the button re-enables.
7. Check the header pill and the button label both show something like `1
   IN · 1 OUT` (not a single combined unit count).
8. Click **Confirm & Update Inventory**. Expect a "Scan Committed" toast
   whose message shows the IN/OUT breakdown, then check the Inventory page:
   the IN item's Quantity/Available both went up by its amount, the OUT
   item's Available went down by its amount with Quantity unchanged.
9. Repeat step 5's over-limit case but via the **webcam** tab with the
   camera running: switch a live-detected row to OUT, confirm the warning
   stays up (and the value doesn't snap back to IN) across multiple
   detection frames while the camera keeps running.
10. Confirm in the Firebase console (`petrosainsteamb` → Firestore Database
    → `store_inventory`) that the `qty`/`avail_qty` for both SKUs' documents
    match what the UI showed, and restore them afterward if this was real
    inventory data.

---

## 12. Fix + Route: StockCheckPage.tsx (2026-09-13)

**Fixes the two blockers a prior investigation found before routing this
page**: it didn't compile (`StockCheckRecord`/`StockCheckItem` weren't
exported anywhere), and even if it had, its Expected-vs-Detected comparison
matched on `it.name` / `d.className` string equality — the exact
naming-mismatch bug [Section 10](#10-root-cause-fix-classname--sku-identity-2026-09-13)
fixed in `ScanInventoryPage.tsx`, reintroduced in a second place. Confirming
on, otherwise nothing would have actually reconciled correctly once routed.

### What was built

- **`StockCheckRecord` / `StockCheckItem` added to `src/types/index.ts`**,
  matching exactly what `StockCheckPage.tsx` already expected structurally
  (this was the pre-existing `tsc --noEmit` error — fixed by adding the real
  types, not by loosening/silencing anything). `StockCheckItem` gained two
  fields the page didn't have before: `sku: string | null` and `isNew?:
  boolean` (see below). `StockCheckRecord` gained `appliedToInventory?:
  boolean` — whether "Synchronize inventory" was checked when this record
  was confirmed, i.e. whether it actually wrote anything.
- **`ScanRecord.itemsDetected` gained an optional `sku?: string | null`
  field.** This was already being *passed* at runtime — `App.tsx`'s
  `handleScanConfirmed` stores `data.confirmedItems` (which carries `sku`
  since Section 10) straight into `addScanRecord()` — the type just never
  declared it, so `StockCheckPage.tsx` had no typed way to read it back out.
- **The Expected-vs-Detected comparison in `StockCheckPage.tsx` now matches
  by SKU, not by name/className**:
  - **Expected** side: `InventoryItem[]` filtered by location, keyed by
    `it.itemCode` (already the real SKU — no lookup needed).
  - **Detected** side: each `activeScan.itemsDetected` entry resolves to a
    SKU via the *exact* primary/fallback pattern `App.tsx`'s
    `handleScanConfirmed` already uses — prefer the `sku` stored on the
    detection itself (present on scans recorded since Section 10), fall back
    to re-resolving via `DEFAULT_YOLO_LABELS`/`YOLO_CLASS_SKUS` (the same
    hand-verified table, reused rather than re-derived) for older scan
    records that predate that field.
  - A className that resolves to no SKU at all (e.g. `bag_arduino_20`, one
    of Section 10's 6 no-mapping classes) is **kept visible in its own
    bucket, never silently dropped** — shown with `sku: null` and an
    "Unmapped" badge, but permanently ineligible for reconciliation, matching
    how `ScanInventoryPage.tsx` already treats such items.
  - `manualDetectedOverrides` (the per-row manual-recount input) is now
    keyed by a stable `rowKey()` — the sku, or a namespaced key on the
    className for unmapped rows — instead of the display name, so the
    override can't collide with an unrelated item that happens to share a
    name.
- **New `isNew` concept**: a row where a SKU *was* resolved from a detection,
  but no `InventoryItem` exists for that `(sku, location)` pair at all —
  i.e. this product has never been formally stocked at this location, so
  there's nothing to compare the detection against ("expected" is 0 because
  there's genuinely no record, not because a zero count was confirmed).
  Flagged in the UI with an amber "New" badge, and — critically — **excluded
  from auto-reconciliation entirely** (see below and the flagged decision
  point).
- **`handleStockCheckConfirmed` implemented in `App.tsx`**, reusing
  `storageService.postTransaction()` — the exact same pipeline
  `handleScanConfirmed` and `ConfirmScanModal.tsx` already use, no separate
  write path:
  - Only rows where `variance !== 0` (a real discrepancy) **and** `sku !==
    null` **and** `isNew !== true` are eligible. Each eligible row fires one
    `ADJUSTMENT` transaction with `qty_changed = variance` (the signed
    delta — matches the ADJUSTMENT contract from Section 9: positive
    increases, negative decreases, and unlike IN/OUT it moves **both**
    `quantity` and `availableQuantity`).
  - `applyToInventory` (the page's "Synchronize inventory records with
    physical detected counts" checkbox) is respected literally: **false
    means nothing is written at all** — the result is still reported via
    toast (matched-count / discrepancy-count / what would need manual
    review), it just never calls `postTransaction()`.
  - Per-item success/failure is tracked via `Promise.all`, same honest
    partial-failure toast pattern as `handleScanConfirmed` — a failed
    ADJUSTMENT (e.g. a race with another transaction) doesn't get folded
    into a false "success" for the whole check.
  - Rows excluded for being `isNew` or unmapped are always named in a
    separate warning toast, every time, regardless of `applyToInventory` —
    so "this needs a manual decision" is never silently swallowed the way
    the *original* pre-fix bug silently swallowed unmatched scan items.
- **Routed** into `Sidebar.tsx` (`PageId` gained `'stockcheck'`, new "Stock
  Check" nav item using `ClipboardCheck`) and `App.tsx` (new `activePage ===
  'stockcheck'` branch, passing `items`, `scanHistory`,
  `onConfirmStockCheck={handleStockCheckConfirmed}`, and
  `onNavigateToScan={handleNavigateToScanWithLocation}` — an existing helper
  that was already defined in `App.tsx` but never wired to anything before
  this). Fixed one knock-on compile error this surfaced: `HeaderBar.tsx`'s
  `PAGE_TITLES` record is typed `Record<PageId, string>`, so adding
  `'stockcheck'` to `PageId` required adding its title there too.

### The `isNew` decision point — flagged for you, not decided here

**What I found these rows actually need, concretely:** creating a new
`store_inventory` record isn't just a frontend decision — **neither backend
function supports it.** I confirmed this directly: calling
`record_transaction_firestore()` (or its SQLite counterpart) against a
`(sku, store_name)` pair with no existing document raises
`ValueError: No Firestore inventory document found for SKU='...' /
store='...'` and creates nothing, by design (`doc_ref.get()` inside the
Firestore transaction, then `.update()` — never `.set()` on a missing doc).
So finishing this would require:
1. **A business decision first**: is a detection at a location with no
   existing record actually "this item is now stocked here for the first
   time," or is it more likely "the scan/location was wrong"? Those call for
   different UI (silently seed a row vs. surface a hard warning to double
   check the scan).
2. **If seeding is the right call**: a genuinely new backend code path —
   something like a `record_transaction_firestore()` sibling that `.set()`s
   a fresh doc (`qty`/`avail_qty` = the detected count, `status`
   derived same as the existing functions) instead of updating one, since
   the existing functions explicitly refuse to do this.
3. **Deciding the initial values**: is a first-ever detected count of, say,
   9 units the full physical `qty`, or could some already be checked out
   elsewhere (`avail_qty` < `qty`)? A stock check has no way to know that —
   it can only ever assume `qty == avail_qty` for a brand-new row.

Until that's decided, `isNew` rows stay visible (never hidden, matching this
fix's whole point), clearly badged, explicitly named in a warning toast on
every confirm, and **never** auto-adjusted or auto-created.

### Testing performed

- `npx tsc --noEmit` — the two pre-existing `StockCheckPage.tsx`-related
  errors (`StockCheckRecord`/`StockCheckItem` not exported) are gone; no new
  errors beyond the one pre-existing, unrelated `AuthPage.tsx` one. One
  knock-on error was fixed along the way (`HeaderBar.tsx`'s `PAGE_TITLES`,
  see above).
- `npx vite build` — production build succeeds.
- **Matching-logic verified standalone**, before routing anything: ported
  the exact `verificationRows` algorithm (copied verbatim, not
  reimplemented-from-memory) into a script run via `tsx`, importing the
  *real* `yoloConfig.ts` (`YOLO_CLASS_SKUS`/`YOLO_CLASS_CATEGORIES` — the
  actual hand-verified source of truth). 15 checks, all passed, covering:
  - **NodeMCU, exactly the case asked for**: a fresh detection carrying
    `sku: 'E006'` correctly matches the `NodeMCU` catalog row (by SKU, not
    name) and computes Matched/Short correctly.
  - **NodeMCU again, but simulating an *older* scan record with no stored
    `sku` field** — confirms the `DEFAULT_YOLO_LABELS` fallback resolves
    `'nodemcu esp32' -> 'E006'` correctly even without it.
  - An explicit regression check that `'NodeMCU' === 'nodemcu esp32'` is
    `false` — the concrete proof the old logic would have missed this exact
    case.
  - One Match, one Short (by 4), one Extra (by 3) in the same location/scan
    — all three computed correctly.
  - An `isNew` case (resolvable SKU, no inventory row at that location) and
    an unmapped-class case (`bag_arduino_20`, `sku: null`) — both produce a
    visible row with the right flags, neither silently dropped.
- **ADJUSTMENT reconciliation verified against real Firestore**, calling
  `record_transaction_firestore()` directly (the same function
  `/api/inventory/transaction` calls, and what `handleStockCheckConfirmed`'s
  `postTransaction()` calls end up hitting) against three isolated test
  docs (`TEST-SKU-SC-MATCH/SHORT/EXTRA_Test-Harness-StockCheck`, deleted
  afterward — no real inventory touched):
  - **Match** (expected=20, detected=20, variance=0): confirmed **no
    transaction is fired at all** — `handleStockCheckConfirmed`'s own
    `variance !== 0` filter means this row never reaches `postTransaction`
    — doc verified unchanged (20/20).
  - **Short** (expected=20, detected=15, variance=-5): `ADJUSTMENT`
    qty_changed=-5 → `new_qty=15`, `new_avail_qty=15` (both moved, per the
    ADJUSTMENT contract) — confirmed via an independent Firestore read.
  - **Extra** (expected=5, detected=9, variance=+4): `ADJUSTMENT`
    qty_changed=+4 → `new_qty=9`, `new_avail_qty=9` — confirmed via an
    independent Firestore read.
  - Confirmed that after reconciliation, each row's new `avail_qty` now
    equals what was originally detected — i.e. a second Stock Check against
    the same detection would now show Matched.
  - All 12 checks passed.
- **`isNew`'s backend behavior confirmed directly**, not just inferred:
  called `record_transaction_firestore()` with `ADJUSTMENT` against a
  `(sku, store)` pair with no existing document — raised the `ValueError`
  quoted above, and confirmed via an independent read that no document was
  created as a side effect, before or after.
- **Not tested**: the actual browser click-path (running a real scan,
  opening Stock Check, confirming a mixed Match/Short/Extra check end-to-end
  through the UI, watching the toast and the Inventory page update). No
  browser automation tool is available in this environment. See manual test
  steps below.

### Manual browser test steps (do this to confirm end-to-end)

1. Start both servers: `python database/app.py` and `npm run dev`. Log in as
   `adam` / `password123`.
2. Pick a location and a real, mapped item (avoid the Section 10 catalog-gap
   classes). On **Inventory**, note that item's current Quantity/Available —
   you'll restore it afterward if this is real data.
3. Go to **Scan Inventory**, confirm a scan at that location for that item
   with a quantity **different** from its current Available count (e.g. if
   Available is 10, manually add/confirm 7 — simulating a physical recount
   that's short by 3). Confirm the scan (this also becomes the "Detected"
   source for Stock Check).
4. Go to the new **Stock Check** nav item (should now appear in the
   sidebar). Select the same location. Confirm the item shows: Expected =
   the pre-scan Available count, Detected = what you just confirmed,
   Status = **Short**, with the SKU printed under the item name.
5. Leave **"Synchronize inventory records with physical detected counts"**
   **unchecked** and click **Confirm Stock Check**. Expect: an info toast
   ("Stock Check Reviewed — Not Applied") and the Inventory page's numbers
   **unchanged** — confirm this by checking Inventory or Firestore directly.
6. Run another scan/manual-add at the same location for a *different* item,
   this time confirming **more** than its current Available (simulating an
   Extra). Repeat step 4 — this row should show Status = **Extra**.
7. This time, **check** "Synchronize inventory records..." and click
   **Confirm Stock Check**. Expect a success (or partial-success) toast
   naming what was adjusted. Check Inventory/Firestore: the Short item's
   Available should now equal what was detected, and same for the Extra
   item — both Quantity **and** Available should have moved (unlike IN/OUT,
   which only move Available).
8. If you have (or can simulate) a detection for an item never stocked at
   that location at all, confirm it shows the amber **"New"** badge, is
   excluded from the adjustment even with the checkbox on, and is named in
   a separate warning toast.
9. If a scan ever detects one of the 6 no-mapping classes
   (`bag_arduino_20`, `bag_arduino_30`, `bundle_arduino`, `box sticky note`,
   `cup_rim`, `full_cup`), confirm it shows the grey **"Unmapped"** badge
   and behaves the same way — visible, never adjusted.
10. Confirm in the Firebase console (`petrosainsteamb` → Firestore Database
    → `store_inventory`) that both adjusted documents' `qty`/`avail_qty`
    match the UI, and restore both items to their original values afterward
    if this was real inventory data.

---

## 13. Investigation: Stock Check "only shows 8 items" (2026-09-13)

**Investigation only, per explicit instruction — nothing was changed.**

Checked the real per-location item counts directly against live Firestore
(`store_inventory`, 109 docs total, one per `(sku, location)` pair, no
duplicates found):

| Location | Real item count |
|---|---|
| STORE 1 | 50 |
| MAKER STUDIO | 30 |
| CHILLAX | 22 |
| CHEMICAL ROOM | 7 |

**No slicing, pagination, or artificial limit exists anywhere in the
pipeline.** Grepped `StockCheckPage.tsx` and the rest of `src/` for
`.slice(`, `.limit(`, or any cap on the items/inventory arrays — the only
`.slice(...)` calls anywhere are unrelated date-string formatting
(`toISOString().slice(0, 10)`) and `DashboardPage.tsx`'s own
`recentScans`/`lowStockItems` widgets (deliberately capped at 4-5 for a
dashboard card, and irrelevant to Stock Check). `fetchInventory()`'s
Firestore read is a plain `getDocs(collection(db, 'store_inventory'))` with
no `.limit()`. `verificationRows`' `expectedMap` is built from every
`InventoryItem` matching the selected location, full stop.

**Conclusion: 8 is very likely correct, not a bug — but for a specific
reason worth flagging.** `VALID_LOCATIONS[0]` is `'CHEMICAL ROOM'`, the
**default** location `StockCheckPage.tsx` loads with (`useState<ValidLocation>(VALID_LOCATIONS[0])`).
CHEMICAL ROOM has exactly **7** real items. If the active scan for that
location detected one additional SKU not already stocked there (an `isNew`
row — e.g. `goggles` → `L019`, which isn't among CHEMICAL ROOM's 7 items) or
one unmapped class, the table would show exactly **7 + 1 = 8** rows. That
extra row showing up at all is the *Section 12 fix working as designed* —
surfacing a detection that doesn't match anything, rather than silently
dropping it — not a defect.

**What this doesn't rule out, and what to check next:** I can't inspect the
live browser session, so I can't confirm which location was actually
selected, whether an active scan was in play, or whether `storageState.items`
was fully populated at the time (e.g. a `fetchInventory()` Firestore call
that failed silently — it's wrapped in `try/catch` and falls back to
whatever's cached, with only a `console.warn`, no visible UI error — would
leave stale/partial data with no on-screen indication anything went wrong).
**Before treating this as closed**: confirm which location the location
dropdown was actually set to when 8 was observed. If it was CHEMICAL ROOM,
this is expected behavior given real data, not a bug. If it was MAKER
STUDIO, CHILLAX, or STORE 1 and still showed only 8, that contradicts
everything found here and points at a runtime data-loading issue (stale
cache / failed fetch) rather than a table-rendering bug — worth a fresh
browser check with dev tools open (Network tab, and `console.warn` output)
before writing any fix.

---

## 14. UI Change: "Adjust Stock" Button Hidden on InventoryPage.tsx (2026-09-13)

**Per explicit instruction**: removed the "Adjust Stock" button from each
row's Actions column in `InventoryPage.tsx` — the underlying feature
([Section 9](#9-feature-manual-in--out--adjustment-stock-transactions-2026-09-13))
is untouched and still fully present in the code, just not reachable from
this button anymore.

**What was removed**: only the `<button onClick={() => setAdjustModalItem(item)}>`
JSX element itself (replaced with a one-line comment pointing here), and its
now-dead `SlidersHorizontal` icon import.

**What was deliberately left intact**, per instruction:
- `adjustModalItem` / `setAdjustModalItem` state — still declared, just has
  no remaining caller in this file.
- The `<ConfirmScanModal item={adjustModalItem} .../>` render block — still
  present, will still render correctly if `adjustModalItem` is ever set by
  some other future trigger.
- `onStockAdjusted` prop and its `App.tsx`-side `handleStockAdjusted` handler
  — untouched.
- `storageService.postTransaction()` and the entire IN/OUT/ADJUSTMENT
  backend pipeline — completely unaffected; this was a UI-only change.

**Testing performed**: `npx tsc --noEmit` — no new errors (same one
pre-existing, unrelated `AuthPage.tsx` error). Confirmed nothing else in the
codebase references this specific button or depends on it being present.
`npx vite build` — production build still succeeds.

**Not tested**: the actual browser click-path (confirming the button is
visually gone from the Inventory table, and that the rest of the row's
actions — Check Out/Check In — still render normally). No browser
automation tool is available in this environment.

---

## 15. Restored: Self-Service Registration (2026-09-13)

**Explicit product decision, not a default I chose**: registration is now
**open** — any visitor can create an account via `POST /api/register`, with
no admin approval, invite code, or gate of any kind. This restores the
`AuthPage.tsx` "Create Account" tab's original main-branch capability,
which had been dead (calling a `signUp()` method that didn't exist —
`tsc --noEmit`'s longest-standing pre-existing error) since the Firestore
migration replaced the old client-side/localStorage auth fallback.

### ⚠️ Known security tradeoff — revisit before wider/public deployment

**Open registration means anyone who can reach this server can create a
real, working account with no gatekeeping.** This is fine for a controlled
pilot/demo with a known user base, but before this goes anywhere more
exposed (a public URL, an unmanaged network, production data with real
consequences), reconsider:
- Requiring an invite code, an admin-approval step, or restricting
  registration to an allow-listed email/organization domain.
- Rate-limiting `/api/register` (currently unlimited — nothing stops a
  script from mass-creating accounts).
- Whether `Staff` role by default is enough gating on its own, given
  `Staff` can already post IN/OUT/ADJUSTMENT inventory transactions
  (everything except `/api/sync-queue/process`, which is `Admin`-only).

This tradeoff is deliberate for now, not overlooked — flagging it here so
it's a conscious decision to revisit, not a surprise later.

### What was built

- **`POST /api/register` added to `database/app.py`**, matching the
  `users` table exactly (`user_id`, `password_hash`, `full_name`, `team`,
  `role`): accepts `userId`, `password`, `fullName`, `team`; rejects with
  `400` if any are missing or password is under 6 characters; rejects with
  `409` (not a silent overwrite) if `userId` already exists — checked with a
  `SELECT` first for a clean error message, backed by a `try/except
  sqlite3.IntegrityError` on the `INSERT` as the real guarantee against a
  race. Password hashed with `generate_password_hash()` — the exact same
  call, same werkzeug default method, with no override, as
  `import_xlsx_data.py`'s `seed_admin()` uses for the seeded `adam` account,
  so a self-registered password hash and the seeded admin's are produced
  identically.
- **New accounts are always `role='Staff'`, hardcoded in the `INSERT`
  itself — the request body's `role` field, if a client ever sent one, is
  never even read.** This holds regardless of the open-registration
  decision above; the two are independent safeguards.
- **`authService.ts`'s `signUp()` reconnected** to actually call `/api/register`
  (previously a "existed in `AuthPage.tsx`'s call site with no matching
  method" gap) — same pattern as `login()`: `credentials: 'include'`,
  JSON body, try/catch network-error handling. `AuthPage.tsx`'s signup form
  never collects a separate "full name" field, so one is derived from the
  `userId` (e.g. `aina_07` → `Aina 07`) unless explicitly given — the exact
  formatting main's old client-side registration used.
  **Deliberately not restored**: main's old fallback of *also* writing a
  local `localStorage`-only account when the server call failed. That
  fallback is what made main's auth internally inconsistent (a "logged in"
  user the server had never heard of) — Sections 9–10 already removed the
  equivalent fallback from `login()` for the same reason; reintroducing it
  here for `signUp()` would just recreate that bug in a new place.
- **Registration now logs the user in immediately, with no second manual
  step**: `/api/register` itself doesn't establish a Flask session (only
  `/api/login` does — it's the one place `session[...]` gets set). Rather
  than hand back a locally-fabricated user object like main used to (which
  would leave the browser believing it's authenticated while Flask's
  session cookie was never actually set — every subsequent
  session-gated call, e.g. posting a transaction, would then 401), `signUp()`
  calls `this.login(userId, password)` immediately after a successful
  `/api/register`, and returns *that* result. One click in
  `AuthPage.tsx`'s "Register & Log In" button produces a real, working
  session — not just the appearance of one.

### Testing performed

- `npx tsc --noEmit` — **zero errors of any kind**, for the first time this
  session. This was the one remaining pre-existing error tracked since
  Section 10; it's now gone because the real fix (implementing `signUp()`)
  landed instead of being worked around.
- `npx vite build` — production build succeeds.
- **Real end-to-end HTTP test against the running Flask dev server**
  (`database/app.py`, port 5000), using a fresh `test_reg_<timestamp>`
  username to avoid colliding with anything real, cleaned up from the local
  `users` table afterward. 12 checks, all passed:
  - Register a new user → `201`, response echoes `role: 'Staff'`.
  - Log in with those same credentials immediately after → `200`, role
    still `'Staff'`.
  - `GET /api/me` with the resulting session cookie → confirms
    `authenticated: true`, `role: 'Staff'` — the actual Flask session, not
    just a client-side belief.
  - Login with the right user but a wrong password → `401` (hashing
    actually verifies, not a rubber-stamp).
  - **Registering the same `userId` a second time (different password,
    different name) → `409`, not a silent overwrite.** Confirmed by then
    logging in with the *original* password (still works) and the
    *second attempt's* password (rejected, `401`) — proof the first
    account's row was never touched.
  - Missing `fullName`/`team` → `400`. Password under 6 characters → `400`.
- **Not tested**: the actual browser click-path through `AuthPage.tsx`'s
  "Create Account" tab (filling the form, clicking "Register & Log In",
  landing straight in the dashboard with no second login screen). No
  browser automation tool is available in this environment. Given the HTTP
  test above already proves the full server-side contract
  (`/api/register` → `/api/login` → authenticated session) works exactly
  as `signUp()` calls it, the remaining risk is purely in the React form
  wiring itself (already unchanged — `AuthPage.tsx`'s `handleSignUp` call
  site was untouched, only the previously-missing method it calls was
  implemented).

---

## 16. Fix: test_db.py Rewritten for the Current Schema (2026-09-13)

**The old `test_db.py` tested a schema that no longer exists.** It
referenced `process_detection_batch()`, `audit_inventory_discrepancies()`,
numeric `product_id`/`store_id` foreign keys, and an `image_detections_log`
table — all pre-refactor concepts from before the Firestore migration and
the SKU/store_name composite-key redesign
([Section 10](#10-root-cause-fix-classname--sku-identity-2026-09-13)'s
"What was found" section already flagged this file was stale, but it was
out of scope for that fix). It could not have run against current
`schema.sql` or `inventory_manager.py` — those functions don't exist
anymore.

### What was built

Rewrote it entirely as `unittest.TestCase` tests (real, runnable —
not print statements) against `record_transaction()`, the SQLite
counterpart to `record_transaction_firestore()`, using the actual current
schema:

- **`setUp()`/`tearDown()`** create and destroy an isolated
  `test_inventory_system.db` per test (via `init_database(..., force_reset=True)`),
  seeded with exactly what `record_transaction()`'s own validation requires:
  one `users` row, one `stores` row, one `products` row, and one
  `store_inventory` row (`qty=avail_qty=50`) — mirroring this session's
  earlier direct-Firestore test pattern, but for the local SQLite path.
- **IN**: confirms `qty` and `avail_qty` both increase by the same amount.
- **OUT**: confirms `avail_qty` decreases while `qty` stays fixed (the
  documented "physical qty unchanged on check-out" behavior); a separate
  test confirms the exact boundary (`qty_changed == avail_qty` succeeds,
  driving `avail_qty` to 0 and `status` to `'Out of Stock'`).
- **OUT exceeding available stock**: confirms `ValueError` is raised with
  the expected message, **and** that the rejected transaction left
  `store_inventory` completely untouched and wrote **zero** rows to
  `inventory_logs` — not just that an exception happened.
- **ADJUSTMENT**: confirms both increase and decrease move **both** `qty`
  and `avail_qty` (unlike IN/OUT), and that a large enough decrease clamps
  at 0 rather than going negative.
- **`inventory_logs` correctness**: runs one IN, one OUT, one ADJUSTMENT in
  sequence and asserts, per row, the exact `sku`/`store_name`/`user_id`/
  `action`/`qty_changed` recorded — including the signed-delta semantics
  (IN logs the positive magnitude as-is; OUT logs it negated; ADJUSTMENT
  logs exactly the signed delta given). A separate test confirms a
  **rejected** OUT doesn't add a log row while a **prior successful**
  transaction's log entry remains untouched.
- **Bonus validation coverage** (cheap, same function, not explicitly
  requested but directly relevant): invalid `action` string, unknown
  `sku`, unknown `store_name`, and a `(sku, store)` pair with no
  `store_inventory` row all correctly raise `ValueError` with the expected
  message.

### Testing performed

- `python -m unittest test_db -v` — **13/13 tests pass** against the real,
  current `schema.sql` and `inventory_manager.py` (not mocked). Confirmed
  the isolated `test_inventory_system.db` file is deleted after the run —
  no leftover test artifacts.

---

## 17. Deployment Prep — Flask→Render, Frontend→Vercel (2026-09-13)

**Explicit priority for this pass, per instruction: get it fully working
online, not harden it.** All the code-level prep is done and tested below.
The account-creation/dashboard steps themselves can't be done by me (no
access to create accounts or click through external dashboards) — see the
separate walkthrough delivered in chat for those, and come back to update
this section once URLs exist.

**Branch to deploy from: `refactor_test`.** Confirmed directly
(`git branch --show-current`) — this is the branch all of Sections 9–16's
work landed on, and it's what both Render and Vercel should point at.

### What was built

1. **`database/requirements.txt` created.** Checked actual imports in
   `app.py`/`inventory_manager.py`/`init_db.py` directly rather than
   guessing: `Flask`, `Flask-Cors`, `Werkzeug` (explicit — `app.py` imports
   `werkzeug.security` directly, don't rely on it only being pulled in
   transitively by Flask), `firebase-admin`. Pinned to the exact versions
   already installed and tested in this project's local `.venv`
   (`pip freeze`), not arbitrary latest. Added two more, both load-bearing
   for steps below: `python-dotenv` (step 2) and `gunicorn` (needed for
   Render's start command — see "Known gap" below for why `python app.py`
   alone isn't viable there).
2. **Explicit `.env` loading added to `app.py`**, via `python-dotenv`'s
   `load_dotenv()`, called *before* `inventory_manager` is imported (its
   `USE_FIREBASE` flag is read from `os.environ` at module-import time, so
   load order matters). Previously `USE_FIREBASE` was a bare
   `os.environ.get(..., "true")` with nothing loading a `.env` file at
   all — it worked by accident (the default happened to be correct), not by
   configuration. `database/.env.example` added (committed — the real
   `database/.env`, if ever created, is already covered by the existing
   `.gitignore`'s bare `.env` pattern, confirmed by checking it directly
   rather than assuming).
3. **CORS origins placeholder added to `app.py`**: a literal
   `"https://REPLACE-WITH-VERCEL-URL.vercel.app"` entry, clearly commented,
   sitting alongside the existing localhost origins. Harmless as-is (it
   doesn't match any real `Origin` header, so it grants nothing) — swap it
   for the real Vercel URL once step 7 below produces one; see the chat
   walkthrough for exactly when.
4. **Firebase Admin service account JSON**: confirmed (again, directly —
   `git log --all` for the filename, still empty) it has never been
   committed to any branch. Getting it onto Render is a dashboard step, not
   a code change — see the chat walkthrough.
5. **`src/services/apiConfig.ts` added** — one exported constant,
   `API_BASE_URL`, reading `import.meta.env.VITE_API_URL` with an
   empty-string fallback (preserves the exact current behavior locally,
   where Vite's dev proxy — `vite.config.ts`'s `server.proxy['/api']` —
   handles relative `/api/...` paths). **All 6 relative `/api/...` fetch
   call sites** (grepped for directly, not assumed complete from memory) —
   `authService.ts`'s `login()`/`signUp()`/`logout()`, and
   `storageService.ts`'s `fetchInventory()` and both
   `postTransaction()`/`syncQueue()` transaction posts — now build their URL
   as `` `${API_BASE_URL}/api/...` ``. With `VITE_API_URL` unset (true for
   every local dev run), this is byte-for-byte the same relative path as
   before — confirmed by grepping the built bundle for `/api/login` and
   seeing the plain relative string, not a broken template literal.
6. **`src/services/firebase.ts` now reads `VITE_FIREBASE_*` env vars**
   (with the existing hardcoded values kept as fallback defaults, so
   nothing breaks if they're unset). This wasn't asked for directly, but
   without it, setting `VITE_FIREBASE_*` variables in Vercel's dashboard
   (step 7) would have had **zero effect** — the config was hardcoded
   literals in source, not read from `import.meta.env` at all. Fixing this
   is what makes that env-var guidance actually true instead of a
   well-intentioned dead end.

### Known gap flagged along the way: `app.py`'s dev server isn't Render-viable as-is

`app.py`'s `if __name__ == "__main__": app.run(host="0.0.0.0", port=5000,
debug=True)` has two problems for Render specifically: **it hardcodes port
5000** instead of reading Render's dynamically-assigned `$PORT`, and
**`debug=True` in a publicly reachable deployment is a real exposure** (an
unhandled exception serves an interactive in-browser debugger/console by
default — not just an information leak, an actual remote-code-execution
surface). Fixed by using `gunicorn app:app --bind 0.0.0.0:$PORT` as
Render's Start Command instead of `python app.py` — gunicorn imports the
`app` object directly and never executes that `if __name__ == "__main__"`
block at all, so **no code change to that block was needed**, it simply
becomes irrelevant to the deployed process while remaining exactly as-is
for local dev (`python app.py` still works locally, unchanged).

### Testing performed

- `npx tsc --noEmit` — zero errors (same clean state as Section 15).
- `npx vite build` — succeeds; confirmed via the built bundle that
  `/api/login` still resolves as a plain relative path locally (no
  `VITE_API_URL` set), and the Firebase API key still bakes in correctly
  after the `firebase.ts` change.
- **`requirements.txt` verified against a genuinely fresh, isolated venv**
  (not the project's own `.venv`, which already had everything installed
  from unrelated prior work — that would have hidden a missing dependency):
  created a throwaway venv in the scratchpad, `pip install -r
  requirements.txt` into it with nothing else present, then ran `python -c
  "import app"` **using that isolated venv's own interpreter** — imported
  cleanly. This is the actual thing that matters for Render (a clean
  container installing only what's declared), not just "it works in an
  environment that already has extra packages." `gunicorn` was confirmed
  separately to `pip install` cleanly (Linux-only at runtime — Render's
  container is Linux, so this is fine; not runnable/importable on this
  local Windows dev machine, which is expected and irrelevant to the
  deployed target).
- **`.env` loading verified with a real file, not just reasoning about the
  code**: confirmed `USE_FIREBASE` still defaults to `True` with no
  `database/.env` present (unchanged behavior), then created a real
  `database/.env` with `USE_FIREBASE=false`, re-imported `app`, and
  confirmed it actually read back as `False` this time — proving
  `load_dotenv()` is wired in before the point where `inventory_manager`
  reads the flag. Test file deleted afterward.
- **Full backend smoke test with everything combined**: started the real
  Flask dev server (all changes in place — new `requirements.txt`-only
  deps, `.env` loading, new CORS list) and confirmed `POST /api/login` for
  `adam`/`password123` still returns `200` with the correct user object.
  (One incidental side effect of this test — a few extra `LOGIN` rows in
  the local `inventory_system.db`'s audit table — was reverted afterward,
  consistent with how test-run noise has been handled throughout this
  session.)
- **Not tested, and can't be from here**: the actual Render/Vercel
  dashboards, the deployed public URLs, or a real browser hitting them —
  all of that requires the account-creation steps only you can do. See the
  chat walkthrough for the exact order and what to send back once each URL
  exists.

### What's still open after this pass

- Render account creation, Web Service setup, environment variables, and
  the Secret File upload for the Firebase Admin JSON — dashboard steps, not
  code. Walkthrough delivered in chat.
- Vercel account creation, project import, and environment variables —
  same. Walkthrough delivered in chat.
- Once both URLs exist: swap `app.py`'s CORS placeholder for the real
  Vercel URL, and set the real `VITE_API_URL` in Vercel pointing at the
  real Render URL. Both are quick edits once the URLs are known — send them
  back and this gets finished immediately.
- **`server.ts`** (repo root) is a separate, unrelated Express+`node:sqlite`
  reimplementation of a subset of this same API, against the *old*
  pre-refactor numeric-schema (`product_id`, `image_detections_log`) —
  exactly the kind of staleness [Section 16](#16-fix-test_dbpy-rewritten-for-the-current-schema-2026-09-13)
  found in the old `test_db.py`. It is **not used by the current
  architecture** (the frontend talks to Flask, not this), and Vercel's
  default `npm run build` script would build it into `dist/server.cjs` for
  no reason (wasted build time, not wrong, just pointless) — recommend
  overriding Vercel's Build Command to `vite build` alone, and leaving
  `server.ts` untouched/unused rather than fixing or removing it now, since
  that's a separate decision outside this deployment task's scope.
- Longer-term hosting question already flagged in Section 5/8, still
  unresolved: the `users`/`user_logs`/`inventory_logs` SQLite tables
  persist as a file *inside* the deployed container. Render's free/starter
  tiers do **not** guarantee that file survives a redeploy or a
  restart-after-inactivity — this is fine to defer for a prototype (per
  this session's explicit priority), but is a real data-loss risk for the
  `users` table specifically (new self-registered accounts could vanish on
  a redeploy) that should be revisited before this is anything more than a
  prototype. A Render persistent disk (paid tier) or migrating `users` to
  Firestore too are the two obvious fixes, neither done here.
