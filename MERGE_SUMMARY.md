# What's Actually In `refactor_test`

This documents the real content of `refactor_test` (created from `database`'s
tip, `03fa680`, with `main` merged in). It's organized by feature, not by
commit — the git log is a list of *events*, not a description of the
resulting system, and events don't map 1:1 to what's actually running.

## The headline verification, done directly

**Question:** the merge reported "Already up to date" with zero new commits.
Does that mean `main` truly has nothing `database` doesn't already have — or
could `database`'s version have silently "won" on some file without git ever
treating it as a conflict?

**Answer: `main` is a genuine, verified ancestor of `database`. There is no
silent-win scenario, and here's why that's not just an inference from the
merge output:**

```
$ git merge-base --is-ancestor main database && echo CONFIRMED
CONFIRMED
```

`--is-ancestor` walks the actual commit graph — it's a direct structural
check, not a heuristic. It confirms `main`'s tip commit (`325a5fa`) is
literally one of `database`'s ancestors. That means `database`'s history is:

```
main's commits (325a5fa and everything before it)
        │
        ▼
  4999c34  set up firebase (firestore)
  d487a9a  Migrate inventory writes to Firestore via Admin SDK; add security rules
  925e2d2  kill me
  03fa680  just in case  (the per-item IN/OUT feature)
```

Because it's a straight line — not two branches that diverged and then both
touched the same file differently — there is **no content on `main` that
isn't byte-for-byte present in `database`'s history at commit `325a5fa`,
before being further edited by the four commits above.** A "silent win"
requires a real three-way merge with two independent edits to the same
region; that situation cannot occur here structurally, regardless of file
content.

I still checked file content directly rather than resting on that logic
alone, per your ask. 67 files exist on both branches; **21 of them differ**:

```
.gitignore                        database/schema.sql               src/pages/SettingsPage.tsx
database/app.py                   package-lock.json                 src/services/authService.ts
database/init_db.py               package.json                      src/services/modelService.ts
database/inventory_manager.py     server.ts                         src/services/storageService.ts
database/inventory_system.db      src/App.tsx                       src/services/yoloConfig.ts
src/components/ConfirmScanModal.tsx  src/data/locations.ts           src/types/index.ts
src/pages/InventoryPage.tsx       src/pages/ScanInventoryPage.tsx   tsconfig.json
                                                                      vite.config.ts
```

Every one of these differs *because `database`'s commits kept editing files
main had already touched* — not because two divergent histories both claimed
ownership of the same lines. `git diff main database -- <file>` for any of
these shows a superset of edits, not a conflicting alternate version. The
feature sections below explain what each of the interesting ones actually
changed, so "different content" has a concrete meaning instead of being a
bare file list.

---

## Authentication (login)

**What it does:** username/password login via a Flask session cookie,
backed by a SQLite `users` table (`werkzeug`-hashed passwords). On success,
Flask sets a session cookie and the frontend caches the returned user object
in `localStorage` for offline resilience (e.g. so the header still shows who
you are if a page reload happens while the network's down).

**Origin:** both branches have a version — `database`'s replaced `main`'s.

**What main's version actually looked like, and why the difference matters:**
`main`'s `authService.ts` had a **two-tier fallback** design:
1. Try Flask `/api/login` first.
2. If that failed for any reason (server down, network error) — or really,
   as the primary path in a lot of real usage — fall back to a **client-side
   `localStorage` "registered users" list**, seeded with hardcoded demo
   accounts (`john_smith`, `tariq_mansour`, `sarah_jenkins`, `aminah01`) and
   a self-service `/api/register` endpoint (SQLite `INSERT INTO users`) with
   a matching "Register & Log In" UI flow.

`database`'s version **removes the fallback and the demo accounts entirely**
— Flask is now the *only* path, `credentials: 'include'` is added to
actually send the session cookie (main's fetch call was missing this), and
the returned `role` field is now taken from the server instead of being
hardcoded to `'Store Officer'` for everyone. This is a real, deliberate
architecture change: main's auth would silently work "offline" via demo
accounts even with zero backend, database's requires the Flask server.

**Nothing was silently lost** — main's fallback logic is fully visible in
`git show main:src/services/authService.ts` if it's ever needed for
reference — but it's worth knowing it's genuinely gone from `refactor_test`,
not merely superseded-but-still-reachable.

**A leftover loose end worth knowing about:** the backend's `/api/register`
route (and the SQLite `INSERT` behind it) was **also removed** in `database`
— but `AuthPage.tsx`'s "Register & Log In" tab still calls
`authService.signUp(...)`, and no `signUp` method exists on `AuthService`
anymore. This is a genuine broken code path already on `database`/
`refactor_test` (confirmed by `npx tsc --noEmit`: `Property 'signUp' does not
exist on type 'AuthService'`) — **not something the merge caused**, since
main never had this problem (it had a working, if fallback-only,
registration flow). It's pre-existing breakage on `database` that the merge
simply carried forward unchanged.

---

## Inventory reads

**What it does:** on login/mount, the app loads the full inventory list and
renders it across Dashboard/Inventory/Scan pages.

**Origin:** `database`. This is not "Firestore vs. SQLite" on main vs.
database — **main didn't read from any backend database at all.**

Main's entire storage layer (`storageService.ts`) was pure client-side
`localStorage` — a seeded "factory dataset" baked into the frontend, with no
`fetch()` calls and no server round-trip anywhere in the file. It's a
self-contained demo/mock data layer.

`database` introduces **two real, network-backed read paths**, chosen by a
`USE_FIREBASE` flag (mirrors the backend's own `USE_FIREBASE` env var — kept
in sync manually, they're separate runtimes per the code's own comment):
- **Firestore path** (when the flag is on): `getDocs(collection(db,
  'store_inventory'))` via the Firebase client SDK directly from the browser,
  after an anonymous `signInAnonymously()` (required by `firestore.rules` —
  see below).
- **SQLite path** (flag off): `GET /api/inventory` on Flask, which does a
  `products JOIN store_inventory` SQL query and returns JSON.

Both paths map into the same `InventoryItem` shape the rest of the app
expects, so the toggle is invisible to every page above `storageService.ts`.

**Nothing hidden by the merge** — main simply never had a backend read path
to compare against; there's no "main's SQLite version" that got quietly
dropped, because main's inventory data was never in a database at all.

---

## Inventory writes / transactions

**What it does:** every stock change (Scan Inventory confirmations, the
Adjust Stock modal, checkout/check-in) ultimately becomes one call to `POST
/api/inventory/transaction` with `{ sku, store_name, action, qty_changed }`,
where `action` is `IN` / `OUT` / `ADJUSTMENT`. Flask validates the session,
then calls either `record_transaction()` (SQLite) or
`record_transaction_firestore()` (Firestore, via the Admin SDK inside a
Firestore transaction for atomicity), chosen by the same `USE_FIREBASE` env
var as the read path. `qty_changed` is always a positive magnitude for
IN/OUT — the server negates it internally for OUT; ADJUSTMENT takes a signed
delta. Both functions reject an OUT that would take `avail_qty` negative
(`ValueError`, surfaced as HTTP 422), and still log every transaction to a
local SQLite `inventory_logs` audit table even when the live data lives in
Firestore (Firestore doesn't have a matching page that reads that table, so
this is low-risk and preserves operator accountability without migrating
that table too).

**Origin:** `database`, and this one **is** a from-scratch replacement, not
an evolution. Main's backend had a completely different write model: `POST
/api/process-detections`, driven by a computer-vision detection batch
(`sku`, `detected_quantity`, `confidence_score`, `image_path`), writing to a
numeric `store_id`/`product_id`-keyed schema with a confidence threshold
deciding "verified" vs. "conflict." There was no concept of IN/OUT/
ADJUSTMENT at all — every successful detection was implicitly additive.
`database`'s `schema.sql` changed by 144 lines to move off that numeric-FK
design onto direct `sku`/`store_name` keys, matching Firestore's
`{sku}_{store_name}` document-ID scheme.

**Nothing hidden** — this is a genuine redesign that happened entirely
within `database`'s own commit history (`4999c34` → `d487a9a`), main's old
detection-batch endpoint is gone by design, not silently overwritten by a
merge decision.

---

## Firestore security rules

**What it does:** `firestore.rules` (new file, only ever existed on
`database`) — reads on `store_inventory` require *any* authenticated
Firestore session (including the anonymous one `firebase.ts` signs in with
on load); every write is hard-blocked for every client
(`allow write: if false`), always. The Admin SDK used server-side by Flask
bypasses these rules entirely, so all real writes still funnel through the
one audited path (`/api/inventory/transaction`) — a client can't reach
Firestore directly to change stock even if it has the anonymous session.

**Origin:** `database` only. `main` has no Firestore integration at all, so
there was never a rules file to compare against — this can't have been
silently overwritten.

**One thing worth confirming, and I checked it directly rather than
assuming:** the Firebase **Admin SDK credential file**
(`database/petrosainsteamb-firebase-adminsdk-fbsvc-e4494b1913.json`, a
private key) exists on disk but is **not tracked in git on any branch** —
`git log --all` for that filename returns nothing, and it's excluded going
forward via a `.gitignore` entry added in the same commit that introduced it.
No secret leak in history from this merge.

---

## The Scan Inventory page and the SKU-mapping fix

**What it does:** AI-detection (webcam/upload) and manual item entry, with a
confirmation list before posting transactions. The "SKU-mapping fix"
(documented in full in `PROJECT_STATUS.md` §10) addresses a real, previously
silent bug: every row was identified only by a YOLO **class name** string
(e.g. `'nodemcu esp32'`), and the old code tried to match that against the
product catalog's human-readable `name` field by exact case-insensitive
string comparison. That match fails for 13 of 15 trained classes (different
naming schemes — `Arduino_Uno` vs. `Arduino Uno`, `nodemcu esp32` vs.
`NodeMCU`, etc.), so those items were silently dropped while the UI still
showed a green "Scan Committed" success toast for the full quantity.

**Origin:** `database` exclusively — the entire SKU concept
(`YOLOClassLabel.sku`, `YOLO_CLASS_SKUS` lookup table, `ConfirmedItemRow.sku`)
doesn't exist on `main` at all. Main's `ScanInventoryPage.tsx` used the old
`ConfirmScanModal` multi-item review table (see below) with no SKU field
anywhere, tied to the old `/api/process-detections` write model.

**Layered on top of the SKU fix, also `database`-only:** the per-item
IN/OUT toggle (this session's most recent work, `PROJECT_STATUS.md` §11) —
each confirmed row now carries its own `action: 'IN' | 'OUT'`, defaulting to
`IN`, with a segmented-pill toggle per row, client-side over-limit
validation against `availableQuantity`, and IN/OUT breakdown totals instead
of one misleading combined unit count.

**Nothing hidden** — main's version is a genuinely different, older
implementation (different data shape, different write endpoint, no SKU
concept), fully superseded rather than merge-reconciled.

---

## The Adjust Stock feature (IN / OUT / ADJUSTMENT modal)

**What it does:** a single-item modal (opened from an "Adjust Stock" button
on each Inventory page row) that lets an operator record Stock In, Stock
Out, or an Adjustment against one item at one location, with a live
before/after quantity preview and inline validation against
`availableQuantity` for OUT.

**Origin:** `database`. The component file (`ConfirmScanModal.tsx`) existed
on `main` too, but as something structurally different: a **multi-item CV
detection review table** — `detectedItems: DetectedSummaryItem[]`
(className/count/confidence, no SKU, no action concept), a "Confirm Scan &
Update Inventory" button, and a `handleSubmit` that just posted the whole
edited list back to the old detection-batch flow. It was also, per
`PROJECT_STATUS.md` §9's investigation, **dead code on `main`/pre-database**
— never imported or rendered anywhere.

`database` rewrote the same file (same export name, by explicit instruction
at the time — not a rename) into the single-item, 3-way-action modal
described above, wired it into `InventoryPage.tsx` with a real "Adjust
Stock" button, and gave `storageService.postTransaction()` a real return
value (`{ success, error? }`) so a rejected transaction (e.g. insufficient
stock) surfaces as an actual inline error instead of being silently
swallowed.

**Nothing hidden** — main's version being dead code means there's doubly
nothing lost: it wasn't reachable through the UI even on `main`, and the
file was substantively rewritten rather than merge-reconciled with the old
multi-item version.

---

## Other meaningful differences a plain `git log` wouldn't surface

- **Storage architecture, overall:** the single biggest thing a commit list
  doesn't convey is that `main` was a **frontend-only demo app** — all state
  lived in `localStorage`, seeded from a baked-in dataset, with zero network
  calls to any backend for inventory data. `database` turned it into a real
  three-tier system (React → Flask session auth + SQLite audit log → SQLite
  *or* Firestore for the live inventory data, selectable via one flag). This
  isn't a "feature" so much as the frame everything else in this document
  sits inside.
- **Dev script split:** `package.json`'s `dev` script changed from `tsx
  server.ts` (main) to `vite` (database), with the old behavior preserved
  under a new `dev:server` script. If you're used to running `npm run dev`
  expecting the Express/tsx server on `main`'s workflow, `refactor_test`
  (following `database`) now starts the Vite dev server instead.
- **New dependency:** `firebase` (client SDK, `^12.19.0`) was added to
  `package.json` — not present on `main` at all, needed for the client-side
  Firestore read path and anonymous auth.
- **`cookies.txt`:** an empty curl cookie-jar file (just the standard
  Netscape-format header comment, no actual cookie data) is committed at the
  repo root on `database`/`refactor_test`. Not a secret leak — the file has
  no content — but it looks like an accidental commit from manual `curl
  -c cookies.txt` testing (matches this session's own testing style in
  `PROJECT_STATUS.md`). Worth a cleanup commit if you want the tree tidy;
  not urgent.
- **`database/inventory_system.db` (the SQLite file itself) is tracked in
  git and differs between branches** (90112 → 110592 bytes) — it's a binary
  database file being version-controlled directly, which means every schema
  change or data change shows up as an opaque binary diff. Not a merge
  problem, just worth knowing if you're ever confused why this file shows
  up in diffs with no readable content.

---

## Bottom line for your judgment call

`refactor_test` is, content-wise, simply `database`'s tip. `main` is fully
and verifiably contained within it — not one line of main's history was at
risk of being silently discarded by the merge, because there was no
divergence for git to arbitrate in the first place. The things actually
worth your attention aren't merge risk; they're the pre-existing loose ends
now living in `refactor_test` regardless of how it was created:
the broken `signUp` registration path, and the empty `cookies.txt` file.
Neither blocks anything, but both are easy, low-risk cleanups if you want
them gone before this goes further (e.g. before pushing, or before basing
more work on this branch).
