# CORE-INVENTORY — Project Status & Handoff

*Last updated: 2026-09-13 — Firestore write path (via Flask + Admin SDK) and
Firestore Security Rules are both done and verified live. Two separate UI
fixes landed this session: a manual IN/OUT/ADJUSTMENT stock transaction UI on
the Inventory page (Section 9), and — the actual root cause of the original
bug report — a broken className→SKU identity mapping on the Scan Inventory
page that silently dropped 13 of 15 detectable item types, including NodeMCU
(Section 10, supersedes Section 9's framing as "the" bug). Next up: manual
browser click-through of both fixes, a product/model decision on the 6
classes with no catalog mapping (Section 10), then deployment (Section 5).*

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
