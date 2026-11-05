# Performance audit, navigation fix and verification — November 2026

Date: 2026-11-04 (final pre-commit audit included: §11–§16). Status: **implemented and verified; not committed, pushed or deployed.** No migration was written or applied in this work. No data was deleted, and no test ran against Neon or against `ravinarayana_erp_local`.

## 1. Summary

| Complaint | Real cause found | Result |
|---|---|---|
| Some page switches take 10–15 s | Switching between a green and an orange section left the shell in its "opening" state until a 15-second safety timer cleared it. The page had arrived in about 50 ms. This happens in production too. | Fixed. Residents → Orders 15,080 → 345 ms, Orders → Residents 15,062 → 90 ms (fresh production server) |
| The previous page stays on screen, then a spinner | Nothing could show the destination until the server answered. On localhost (development mode) the server first compiles the page (1.6–11 s), then each API route on first use (2–3 s each). | Fixed for the screen: the destination's title and frame appear in 6–164 ms in every mode. The compile time itself is development-mode only (§7). |
| First click does nothing | (a) Dialog code was downloaded on the first click. (b) The magnifier icon in 7 search boxes covered the left part of the field and swallowed clicks. | Fixed |
| Submitting an order is slow | A fixed 1.5 s wait before the dialog closed, during which a second click created a duplicate order; and 39 database queries per order | Fixed: 1.7–2.2 s → 0.27–0.6 s; 39 → 29 queries |
| Saves are slow, lists reload twice | Every save reloaded the affected lists twice (the echo of your own save on the live-update stream) | Fixed |
| Search and filters are sluggish | Orders and Activity sent a request per keystroke; money and date formatting in list rows was 17–30× more costly than needed; Orders drew every order of the day at once | Fixed |
| (found during verification) duplicate records on a same-instant double activation | Money and create forms relied only on the button's disabled state, which takes effect after a render; four money forms also made a new idempotency key per click | Fixed: stable key per entry plus an in-flight guard; verified with same-instant and real mouse double-clicks |
| (found during verification) people sent to sign-in during a database hiccup | The live-update heartbeat treated any database error as "session ended" | Fixed: only a definite "no such session" signs out |
| (final audit) two tiffin billing runs for the same month at the same moment | Both runs saw "not yet billed" and each created invoices | Fixed: runs for one billing period are serialised with a transaction lock; 3 concurrent runs → 1 invoice |
| (final audit) tiffin payment retry could record twice | The form had no stable idempotency key | Fixed: one key per opened form; 5 concurrent identical requests → 1 payment |
| (final audit) Cashbook search with 500 entries on a slow phone | Every keystroke rebuilt all row elements | Fixed: rows are memoised; median 56–70 → 34–40 ms per keystroke (4× throttle) |
| (final audit) Dashboard chart tooltip 1 px past the screen edge at 360 px | Tooltip centred on the first/last bar | Fixed: edge bars anchor the tooltip inside the card |
| (final audit) 4 failing finance test assertions | Tests written for October dates; reversals are dated "today", so run in November they land in another period | Tests now pin the clock to 20 Oct 2026; all pass. Accounting code unchanged. One policy decision remains (§11.3) |

## 2. How this was measured

- **Production builds** of the code before and after this work, built in an isolated copy, never in the working tree. They ran against a throwaway PostgreSQL database seeded with test data (`rn_erp_verify_e2e_test`), plus a large copy (`rn_erp_verify_large_test`: 5,000 cashbook entries this month, 405 orders today, 307 tiffin customers, 20,000 audit entries). Headless Microsoft Edge was driven over the DevTools protocol at 1366×900.
- **Development mode** (what localhost:3001 runs): a second `next dev` of the same working tree with an empty build folder, against the throwaway database. Your localhost server was not used for signed-in tests, because that needs your real login. Its own log was used as evidence of what you experienced.
- **Timings** come from `performance.now()` on every animation frame, plus the browser's network timestamps. "Usable" means: right address, destination content rendered, no loader, no progress bar.
- **Machine load:** the PC was busy (VS Code, a remote-desktop session, several servers). Single runs at 4× CPU throttle varied 3–10×, so only repeated or clearly separated results are claimed.

## 3. Navigation

### 3.1 Root causes and fixes

1. **Stuck "opening" state on green ↔ orange switches (the 15 s).** The click handler sets the pending state inside a View Transition callback, which runs a frame later. When the destination was already prefetched, the router arrived *before* that callback. The pending flag was then set after arrival and stayed until the 15-second timer. *Fix:* "pending" is derived on every render as "clicked and not there yet" (`navPending` in `ErpShell.tsx`), and cleared once the address matches.
2. **Previous page shown while the server works.** A Next.js loading state appears only once the server starts answering, which in development mode means after compiling. Measured on a cold dev navigation (Dashboard → Residents):

   | Time after click | What happens |
   |---:|---|
   | 16 ms | Request sent |
   | 16 → 1,650 ms | Server compiles the page |
   | ~1,650 ms | Hot-reload refetch |
   | ~1,870 ms | Page JavaScript arrives |
   | 2,085 → 4,200 ms | Three API routes compile in parallel |

   *Fix:* on click the shell replaces the page area with the destination's frame (`NavSkeleton`: title, breadcrumb and skeleton cards in that page's layout). The sidebar and top bar persist. The previous page stays mounted but hidden, so an abandoned navigation restores it. No server round trip is involved.
3. **Pages never prefetched.**
   - Staff, Activity and Settings sit below the fold and were never prefetched.
   - Dashboard and My account only got a partial prefetch.
   - The page loading screen added React's minimum fallback time (`FALLBACK_THROTTLE_MS = 300`).

   *Fix:* the sidebar prefetches every section, one per idle moment, and again after a save refreshes the router cache. The group `loading.tsx` was removed; it is kept for `/delivery` and `/account`, which the delivery staff app uses.
4. **Finance tabs re-rendered the page on the server.** The tabs now update the address with `history.replaceState`.
5. **Orders drew every order of the day.** With 405 orders: 1,176 ms to usable. It now shows 60 at a time ("Show more"); search and filters still cover the whole day. Result: 464 ms cold, 113 ms warm.
6. **Database unavailable on localhost.** WSL (which hosts the local database) hung during this session, and every page waited 15 s for a connection timeout (`GET /finance?tab=invoices 500 in 15964ms` in your server log). Recovered with a WSL restart and `scripts/local-db.ps1 start`; the data lives in the named volume and was unaffected. Separately, the heartbeat no longer signs people out on such an error (§1).

### 3.2 Benchmark — every manager route (Owner, sidebar expanded; ms after the click)

"Cold" = first visit in a fresh browser session on a freshly started server; "warm" = second visit; "destination shown" = previous page gone and the destination frame visible.

| Navigation | Cold before | Cold after | Warm before | Warm after | Destination shown after (cold / warm) | Dev cold before | Dev cold after | Dev warm after |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Dashboard → Residents | 287 | 256 | 55 | 39 | 59 / 13 | 5,445 | 4,671 | — ¹ |
| Residents → Orders (green → orange) | **15,080** | 345 | 123 | 71 | 122 / 70 | 7,120 | 6,495 | 697 |
| Orders → Delivery | 341 | 247 | 70 | 75 | 16 / 14 | 6,305 | 6,720 | 443 |
| Delivery → Finance (orange → green) | 266 | 289 | 27 | 87 | 89 / 87 | 7,278 | 6,608 | 713 |
| Finance → Tiffin | 192 | 96 | 57 | 52 | 10 / 13 | 4,091 | 2,591 | 287 |
| Tiffin → Staff | 473 | 122 | 87 | 51 | 26 / 18 | 6,032 | 3,069 | 376 |
| Staff → Settings | 486 | 112 | 43 | 53 | 9 / 5 | 4,511 | 4,805 | 337 |
| Settings → Dashboard | 92 | 114 | 89 | 68 | 13 / 8 | 211 | 143 | 319 |
| Dashboard → Rooms | 169 | 87 | 43 | 60 | 12 / 15 | 4,227 | 4,433 | 305 |
| Rooms → Reports | 106 | 135 | 49 | 43 | 14 / 12 | 6,770 | 6,586 | 281 |
| Reports → Activity | 466 | 121 | 163 | 79 | 6 / 18 | 10,924 | 6,087 | 397 |
| Activity → Daily closing | 161 | 75 | 106 | 79 | 19 / 18 | 5,090 | 702 | 240 |
| Daily closing → My account | 166 | 102 | 55 | 36 | 12 / 10 | 20,523 | 6,700 | 103 |
| My account → Orders | 83 | 58 | 55 | 126 | 58 / 126 | 957 | 746 | 287 |
| Orders → Residents (orange → green) | **15,062** | 90 | 86 | 85 | 87 / 85 | 617 | 173 | 261 |

¹ Script error in that pass (it started on the destination page); fixed for later runs.

| Build | Cold usable (median / worst) | Warm usable (median / worst) | Destination shown (cold, worst) |
|---|---|---|---|
| Production, before | 266 / 15,080 | 57 / 163 | 190 |
| Production, after | 114 / 345 | 68 / 126 | 122 |
| Production, final build (re-check after the full workflow suite grew the data) | 222 / 684 | 125 / 245 | 164 |
| Development mode, before | 5,445 / 20,523 | 236 / 658 | 11,598 (previous page shown meanwhile) |
| Development mode, after | 4,671 / 6,720 (compile time) | 319 / 713 | 116 |

Other conditions, on the after build:

- **Sidebar collapsed:** median 92 ms, worst 284 ms.
- **Manager:** median 95 ms, worst 317 ms. Staff, Settings and Activity have no link for a Manager, and their URLs send a Manager to the dashboard.
- **Large dataset:** first visits 81–604 ms; Orders 464 ms after the paging fix (1,176 ms before it).
- **Theme:** the green ↔ orange View Transition runs on every switch and lands on the right colours. The sidebar layout check shows no item movement and no footer overlap.

### 3.3 Navigation stress (production build, large data): 20 of 20 passed

Cases:

- second section clicked 40 ms and 0 ms after the first;
- the same link clicked three times;
- browser Back and Forward;
- three rounds of four green ↔ orange switches;
- two navigations with the sidebar collapsed.

Every case settled on the right page in 67–320 ms and stayed settled 1.5 s later. In **no frame** were the previous page and the destination frame visible together, and no progress bar or skeleton was left behind. No console errors.

### 3.4 Authentication and middleware

No change was needed:

- The middleware only checks that a session cookie exists; it does no database work.
- Each page request validates the session once, shared by the layouts and page guards through React's request cache. Settings and demo provenance are cached in memory, so a navigation costs one indexed query.
- API requests validate once each (1–3 ms).
- Nothing is cached across users.

## 4. Buttons, forms, saves and orders

| Action (production build) | Before | After |
|---|---|---|
| "New order", first click → menu usable | 104–291 ms, 2 requests | 14–32 ms, 0 requests |
| Confirm order → dialog closed and order listed | 1,721–2,241 ms | 274–701 ms |
| Order on a 1.5 s-latency network | — | busy state in 20–55 ms; one order |
| Orders search (5 keystrokes) | 4–6 requests | 0 requests (filtered in the browser, same matching rules) |
| Orders status filter | 1 request | 0 requests |
| Activity / Reports search (5 keystrokes) | 5 requests | 1 request, after typing pauses (verified: `search=signe` only) |
| Save expense / payment / settings | lists reloaded twice | reloaded once |
| Record payment, Expense, Deposit, Rent charge: first click → form | 9–41 ms | 11–38 ms |
| Typing in list search, per keystroke (no throttle) | — | 4–40 ms (large data included) |

Order creation server work: **39 → 29 database queries**. Assign and dispatch each reloaded the whole task, and order creation only needed the new status. The delivery API endpoints and the driver flows still return the full task.

### 4.1 Double submissions — no duplicate order or money entry possible

Server (5 identical requests sent at the same moment with one idempotency key; large data): **5 of 5 passed.**

- Delivery order: 1 order.
- Dine-in sale: 1 ledger entry.
- Expense: 1 entry.
- Reusing a key with a different amount, or an order key with different items: refused (400).

Screen:

| Action | How clicked | Records created |
|---|---|---|
| Create order | three times | 1 |
| Create order, slow network | three times | 1 |
| Record payment | three times / real mouse double-click | 1 / 1 |
| Rent charge | twice | 1 |
| Register resident | twice | 1 |
| Add staff | twice | 1 (the second request is refused: username exists) |
| Edit order | twice | revision 1 |
| Accept handover | twice | 1 acceptance |
| Tiffin customer, before the fix | same instant | **2** |
| Tiffin customer, after the fix | same instant / real mouse double-click | 1 / 1 |
| Invoice draft, before the fix | same instant | **2** |
| Invoice draft, after the fix | same instant | 1 |

A person's double-click is two separate events, so the button's disabled state already blocked it. Two activations in the same instant (my test, or an automated retry) could get through. Now hardened:

- the payment, expense, rent-charge, deposit and tiffin payment forms keep **one idempotency key per entry**, so a retry or second click is the same record to the server (server-side checks in §13);
- those four, plus tiffin customer, subscription, product, tiffin payment, tiffin invoices, invoice, reversal and allocation, ignore a second activation while one is in flight.

### 4.2 Errors, slow network, empty and large data

- **Server error on save (simulated 500 on expense; 503 on order):** the message is shown, the entered data is kept and the button works again. The retry saves exactly once.
- **Empty data:** a cashbook range with no entries and an order date with none both show their empty states.
- **Large data:** see §3.2. All list searches stay under 100 ms per keystroke at the median, except the Cashbook search with 500 loaded entries on a 4×-slowed CPU (§9).

## 5. Database and API

- **Indexes:** every filter and join is already indexed. At volume, page reads take 3–34 ms, the orders-for-a-day query 0.36 ms and the Activity first page 0.27 ms. No index was added and no migration was written.
- **Slow query fixed:** the Activity people filter took 47.5 ms at 60,000 rows (rewritten as `EXISTS`: 0.2 ms, same rows).
- **Slowest requests:**
  - development server, warm: `POST /api/orders` 224 ms; `/api/reports/executive` 88 ms (12 queries); `/api/delivery/tasks` 83 ms;
  - production navigation runs: 30–150 ms;
  - Delivery's 5 requests on the grown test data: 466 ms in total.
- **Duplicate requests removed:** save echo, menu and customer reload per "New order", per-keystroke searches, Finance-tab server round trip.
- **Formatting:** amounts and dates reuse `Intl` formatters (28 µs → 1.6 µs per amount, ~160 µs → ~6 µs per date in Edge). Output was compared on 5,000 values and is identical.

## 6. Tests and checks (exact results, final source)

All of these ran on the final source after the last code change (Dashboard tooltip), except where a row says otherwise.

| Check | Result |
|---|---|
| TypeScript, app (`tsc --noEmit`) | **0 errors** |
| TypeScript, tests (`tsc -p tests/tsconfig.json --noEmit`) | **0 errors** |
| Production build (sandbox copy, throwaway database address) | **passes**; shared JS 87.6 kB; one existing warning (`emailAdapter.ts` dynamic require) |
| Lint | **not run**: the repository has no ESLint configuration, and `next lint` only offers to create one |
| Automated suite (`npm run test:safe`, 57 suites) | **54 passed, 0 failed, 3 skipped** (exit 0; run after the last code change) |
| End-to-end workflow suite (125 checks, development server on the working tree, throwaway DB) | **125 passed, 0 failed** (run 3; history in §12) |
| Session policy (one session per Owner, preemption, sign-out, expiry, Manager) | **12/12** |
| Duplicate-submission audit, API (5 money types × 3–4 cases + invoices + tiffin billing) | **20 passed, 2 failed** — both failures are the invoice gap in §13 (decision required). A separate race test found the tiffin billing double-run; fixed and re-tested: 3 concurrent runs → 1 invoice |
| Duplicate submissions on screen | all money and create forms: 1 record per entry (§4.1) |
| Functional regression extras (deposit, tiffin edit, transfer, room delete, delivery assignment) | **4/5 by the script**; the 5th (room delete) was a script misfire (its button lookup reached the whole grid). Delete re-verified twice directly: request 200, `room.deleted` audit entry, room and bed rows gone |
| Navigation stress (final build, large data) | **20/20**, settled in 53–225 ms |
| Responsive overflow (12 pages × 360/390/768/1024 px) | **46/48 clean**; the 2 failures were the Dashboard tooltip at 360/390 px (1 px), fixed and re-checked clean on the final build |
| Financial reconciliation (whole history) | cashbook ₹12,000 = posted rent receipts ₹12,000 (§11.2) |
| Account flow | **4/4**: sign-in with emailed code → change password with emailed OTP → sign in with the new password |
| Control inventory | **251/251 controls have a result** (§10) |

The 3 skipped suites (`live_postgresql_integration`, `task01b_74_local_admin_and_manifest`, `task01b_75_complete_auth_flow`) need the real local database or real email, so the safe runner skips them by design. They were not run.

The four suites that failed earlier in this round now pass, and none of them was weakened:

| Suite | Earlier | Cause | Change | Now |
|---|---|---|---|---|
| `integration_audit` | 1 failed | The scenario is "a September payment reversed in October", written on 20 Oct 2026. Reversals are dated with today's business date, so run in November the refund lands in November and October shows ₹12,000. | Test clock pinned to 20 Oct 2026 12:00 IST (`tests/helpers/fixedClock.ts`). Assertions unchanged. | 97/97 |
| `task01b_63_financial_integrity_phase2` | 3 failed | Same cause | Same clock pin; assertions unchanged | 39/39 |
| `fixture_isolation_and_transaction_integrity` | 6 failed | The source-text checks compared against a file checked out with Windows line endings (CRLF) | Line endings normalised before comparison; the checked text is unchanged | passes |
| `task01b_68_mobile_pilot_verification` | 1 failed | Asserted the Android SDK is *absent*; it is installed (the APK is built here) | If the SDK is present, it now asserts the Capacitor Android project exists | passes |
| `pg_tiffin_management` | passed | — | Strengthened: the first billing run is now two concurrent runs, asserting exactly one invoice (covers the fix in §13) | passes |

## 7. Localhost (development mode)

Localhost runs `next dev`, which compiles each page and API route on first use and again after any code change. Your log shows the same Finance navigation at **45,170 ms** while routes compiled and **239 ms** once compiled. During this session my edits caused repeated recompiles.

Done:

- The warm-up script (`scripts/warm-erp-routes.ps1`, run by `start-erp.ps1`) now also compiles Tiffin, Reports, Activity, Settings, My account and Notifications.
- It was run against your server after the last edit.
- With the destination frame, the previous page is no longer shown while compiling.

**Decision for you:** localhost would match the production numbers if it ran a production build. That is not set up, because `apps/erp/.env.local` points at Neon and a local production build would need the local database address passed explicitly.

## 8. Files changed in this round (56 + 1 removed; final-audit additions in §16)

- **Navigation:**
  - `components/layout/ErpShell.tsx` (derived pending state, destination frame, breadcrumb follows the destination, echo skipping, re-prefetch after refresh)
  - `components/layout/shell/NavSkeleton.tsx` (new), `components/layout/shell/AppSidebar.tsx`
  - `styles/globals.css`
  - `app/(management)/loading.tsx` (removed); `delivery/loading.tsx`, `account/loading.tsx` (new, same loader as before)
  - `app/(management)/finance/page.tsx`, `app/(management)/tiffin/page.tsx`
- **Orders:**
  - `app/(management)/orders/page.tsx` (browser-side filters, paging)
  - `modules/orders/components/NewOrderModal.tsx`
  - `server/orders/orderService.ts`
  - `server/delivery/deliveryService.ts` (opt-in `{ detail: false }`)
- **Live updates:** `server/database/changeSignals.ts`, `server/authorization/authorize.ts`, `app/api/events/route.ts` (origin tagging; heartbeat no longer signs out on database errors).
- **Duplicate protection:**
  - finance dialogs: Payment, Expense, RentCharge, SecurityDeposit, CreateInvoice, Reversal, AllocatePayment;
  - tiffin dialogs: Customer, Subscription, Product, RecordTiffinPayment, GenerateTiffinInvoices.
- **Lists and formatting:**
  - `lib/format.ts`, `lib/preloadWhenIdle.ts`, `lib/useDebouncedValue.ts` (new)
  - `modules/finance/utils/formatUtils.ts`
  - Residents, Rooms, Daily Closing, AccountingPeriodSelector, CashbookLedger, InvoiceLedgerView, Reports, Activity, Dashboard (3 files)
  - Tiffin billing, customers, menu and subscriptions
  - ManagerDelivery, Delivery history, Staff custody, NotificationBell
  - `useInlineDialogs.ts`, `useStackedTables.ts`
- **Server query:** `server/audit/activityLogService.ts`.
- **Scripts and tests:** `scripts/warm-erp-routes.ps1`; `tests/client_cache_and_signals.test.ts` (new origin tests).
- **Report and evidence:** this file and `docs/performance-evidence-2026-11/` (17 screenshots).

**Protected areas, confirmed untouched:**

- The delivery staff app: `DeliveryStaffShell.tsx`, `StaffDelivery/StaffCash/StaffHistory.tsx`, `staffKit.tsx`, `staffParts.tsx`, `ui.tsx` and `offlineQueue.ts`. `git status` shows no changes, and none of them imports a changed module. The driver's `/delivery` and `/account` keep their loader.
- The Android app in `mobile/`: no changes.
- **Kitchen** stays dormant: no changes, and `/kitchen` still redirects to Orders.
- No migrations; Neon and `data/erp.db` were not accessed.

## 9. Unresolved issues (after the final audit)

Decisions required from you:

1. **Cashbook ₹0 floor for months whose refunds exceed receipts** (§11.3): keep it, allow negative months, or show refunds as a separate line. Today monthly figures do not sum to multi-month ranges in that case. Daily closings and cash in hand are correct either way.
2. **Invoice idempotency on the server** (§13): two identical invoice requests at the same instant create two invoices. The form blocks this from the screen; a server fix needs a migration.
3. **Localhost compile time** (§7): first use of each page and API route after a server start or code change costs seconds in development mode. A local production build removes it.

Known, not fixed:

4. **Cashbook search with 500 loaded entries on a 4×-slowed CPU:** improved to 34–40 ms median per keystroke, worst 97–115 ms. Unthrottled 8 ms.
5. **New order dialog typing** is the heaviest form: about 90 ms per keystroke at 4× throttle.
6. **The earlier 6–12 s slow start was not reproduced** in 5 fresh starts (§14). It is most likely machine load at the time, but this is not proven.
7. **Test-environment cookie loss** seen once in a long-idle headless browser did not recur in three later runs (§12). The app has no client code that removes the cookie.
8. **Cosmetic:** a negative "expected cash in hand" displays as `₹-12,18,220` (seen only with artificial bulk data).
9. **Not tested:** the 3 skipped suites (they need the real local database or real email); Render and Neon performance (no access, by design); lint (no ESLint configuration in the repository).

## 10. Control inventory and testing matrix

Every interactive control on every manager page and tab (Owner, production build), with how it was tested and the result.

- **"Passed"** means the control was clicked or changed and its effect verified: dialog, navigation, list update, request status, database record or downloaded file.
- **"Passed (after fix)"** means it failed first and passed after a fix in this round.
- **"Not applicable"** means disabled by design in that state.

Controls that commit data were exercised with real records on the throwaway databases.

### Screenshots (`docs/performance-evidence-2026-11/`)

- **Navigation:** `nav_01_skeleton_list_page`, `nav_02_skeleton_dashboard`, `nav_03_skeleton_green_to_orange` (the destination's frame and breadcrumb while the page opens).
- **Workflows:** `workflow_01`–`10`:
  - resident form and listing;
  - expense server error with the data kept;
  - empty cashbook range;
  - order created, and the order server error with the form kept;
  - empty order date;
  - handover verification;
  - notifications; account.
- **Actions:** room added, resident checked in, invoice draft created, daily closing finalized and locked.

Controls: **251** on 16 pages and tabs. Passed: 244 · Passed (after fix): 4 · Not applicable: 3.

#### /dashboard (19)

| Control | Kind | First-click test | Functional test / evidence | Time to effect | Result |
|---|---|---|---|---:|---|
| Go to a section | field:text | focus on 1st click | focus on 1st click; accepts input | — | Passed |
| Notifications | button | registered | registered; opened | 26 ms | Passed |
| Profile and account | button | registered | registered; opened | 18 ms | Passed |
| All | link | registered | registered; navigated | 106 ms | Passed |
| PG | link | registered | registered; navigated | 94 ms | Passed |
| Tiffin | link | registered | registered; navigated | 106 ms | Passed |
| Export Report | submit | registered | registered; opened | 33 ms | Passed |
| Residents 1 50% of 2 beds | link | link | click → /residents opened (221 ms) | — | Passed |
| Deliveries today 2/4 2 waiting · 0 out | link | link | click → /delivery?tab=board opened (138 ms) | — | Passed |
| Boxes out today 6 Lunch 6 · Dinner 0 | link | link | click → /orders opened (202 ms) | — | Passed |
| 30 days | button | already selected | already selected; selecting the current option changes nothing | — | Passed |
| 6 months | button | registered | registered; content changed | 30 ms | Passed |
| Table | button | registered | registered; content changed | 23 ms | Passed |
| Open the cashbook | link | link | click → /finance?tab=cashbook opened (182 ms) | — | Passed |
| Rent owed ₹0 | link | link | click → /reports?report=outstanding opened (119 ms) | — | Passed |
| See all | link | link | click → /finance?tab=cashbook opened (182 ms) | — | Passed |
| Rooms & beds 1 room 1 occupied · 1 free | link | link | click → /rooms opened (136 ms) | — | Passed |
| Tiffin 2 Active plans 0 Paused 3 Customers | link | link | click → /tiffin?tab=subscriptions opened (251 ms) | — | Passed |
| Table (2nd row) | button | registered | registered; content changed | 20 ms | Passed |

#### /orders (13)

| Control | Kind | First-click test | Functional test / evidence | Time to effect | Result |
|---|---|---|---|---:|---|
| Go to a section | field:text | focus on 1st click | focus on 1st click; accepts input | — | Passed |
| Notifications | button | registered | registered; opened | 18 ms | Passed |
| Profile and account | button | registered | registered; opened | 5 ms | Passed |
| Today 1 | button | already selected | already selected; selecting the current option changes nothing | — | Passed |
| Subscriptions | button | registered | registered; content changed | 30 ms | Passed |
| Menu | button | registered | registered; content changed, 1 request(s) 200 | 339 ms | Passed |
| New order | button | registered | registered; opened | 52 ms | Passed |
| Search name, phone or address | field:text | focus on real click | focus on real click; real mouse click + typing verified (audit index slip) | — | Passed |
| Service date | field:date | native picker | date → 2026-11-01: list updated, 1 request(s) 200 | — | Passed |
| Order type | field:select-one | native picker | option → DELIVERY: list updated, 1 request(s) 200 | — | Passed |
| Status | field:select-one | native picker | option → ACTIVE: list updated, no request | — | Passed |
| Refresh orders | button | registered | registered; 1 request(s) 200 | — | Passed |
| View Delivery → | link | link | click → /delivery opened (116 ms) | — | Passed |

#### /delivery (23)

| Control | Kind | First-click test | Functional test / evidence | Time to effect | Result |
|---|---|---|---|---:|---|
| Go to a section | field:text | focus on 1st click | focus on 1st click; accepts input | — | Passed |
| Notifications | button | registered | registered; opened | 31 ms | Passed |
| Profile and account | button | registered | registered; opened | 8 ms | Passed |
| Lunch | button | already selected | already selected; selecting the current option changes nothing | — | Passed |
| Dinner | button | registered | registered; content changed, 2 request(s) 200/200 | 32 ms | Passed |
| Previous day | button | registered | registered; content changed, 3 request(s) 200/200/200 | 16 ms | Passed |
| Choose date | field:date | native picker | date → 2026-11-01: list updated, 3 request(s) 200 | — | Passed |
| Next day | button | registered | registered; content changed | 20 ms | Passed |
| View only | button | registered | registered; toggled | 25 ms | Passed |
| Waiting 2 | button | registered | registered; content changed | 26 ms | Passed |
| Out 0 | button | registered | registered; content changed | 21 ms | Passed |
| Delivered 1 | button | not clicked here | filter applied | — | Passed |
| Partial 1 | button | registered | registered; content changed | 16 ms | Passed |
| Not delivered 0 | button | registered | registered; content changed | 15 ms | Passed |
| Board | button | registered | registered; content changed | 48 ms | Passed |
| Problems 1 | button | registered | registered; content changed | 20 ms | Passed |
| Custody | button | registered | registered; content changed 2 request(s) 200/200 | 33 ms | Passed |
| History | button | already selected | already selected; selecting the current option changes nothing | — | Passed |
| Export lunch (CSV) | button | registered | registered; downloads deliveries-<date>-lunch.csv (688 B, 5 lines) — browser download event | — | Passed |
| Lunch (2nd row) | button | already selected | already selected; selecting the current option changes nothing | — | Passed |
| Dinner (2nd row) | button | registered | registered; content changed 1 request(s) 200 | 92 ms | Passed |
| Whole day | button | registered | registered; 1 request(s) 200 | — | Passed |
| Meera Subscription · 1 of 2 Daily Standard Tiffin — Took few | button | registered | registered; content changed 1 request(s) 200 | 29 ms | Passed |

#### /residents (13)

| Control | Kind | First-click test | Functional test / evidence | Time to effect | Result |
|---|---|---|---|---:|---|
| Go to a section | field:text | focus on 1st click | focus on 1st click; accepts input | — | Passed |
| Notifications | button | registered | registered; opened | 18 ms | Passed |
| Profile and account | button | registered | registered; opened | 12 ms | Passed |
| Refresh residents | button | registered | registered; request(s) 200 /api/residents/settlement-proposals, 200 /api/residents, 200 /api/rooms | — | Passed |
| Check in | button | not clicked here | check-in confirmed on screen; resident and stay ACTIVE in the database | — | Passed |
| Register resident | button | registered | registered; opened | 28 ms | Passed |
| Search name, phone or room | field:text | focus on 1st click | focus on 1st click; accepts input | — | Passed |
| Status | field:select-one | native picker | option → ACTIVE: list updated, no request | — | Passed |
| E2E Resident | submit | registered | registered; opened, 3 request(s) 200/200/200 | 157 ms | Passed |
| Profile and stay history | submit | registered | registered; opened, 3 request(s) 200/200/200 | 65 ms | Passed |
| Edit profile | submit | registered | registered; opened, 1 request(s) 200 | 41 ms | Passed |
| Transfer | submit | not clicked here | form opens; submission covered by the workflow suite (transfer via API, checkout approved on this screen) | — | Passed |
| Check out | submit | not clicked here | form opens; submission covered by the workflow suite (transfer via API, checkout approved on this screen) | — | Passed |

#### /tiffin (22)

| Control | Kind | First-click test | Functional test / evidence | Time to effect | Result |
|---|---|---|---|---:|---|
| Go to a section | field:text | focus on 1st click | focus on 1st click; accepts input | — | Passed |
| Notifications | button | registered | registered; opened | 33 ms | Passed |
| Profile and account | button | registered | registered; opened | 9 ms | Passed |
| Customers | button | already selected | already selected; selecting the current option changes nothing | — | Passed |
| Subscriptions | button | registered | registered; content changed | 28 ms | Passed |
| Menu & prices | button | registered | registered; content changed, 1 request(s) 200 | 344 ms | Passed |
| Billing | button | registered | registered; content changed | 17 ms | Passed |
| Search by customer name, phone number, delivery address, or | field:text | FAILED before fix: search icon covered the field | search icon covered the field; fixed and verified with a real mouse click | — | Passed (after fix) |
| Refresh customer list | submit | registered | registered; content changed 1 request(s) 200 | 16 ms | Passed |
| Add Customer | submit | not clicked here | a same-instant double click created 2 customers before the fix; after adding the in-flight guard: 1 (same-instant and real mouse double-click) | — | Passed (after fix) |
| Filter by customer type | field:select-one | native picker | option → INDIVIDUAL: list updated, no request | — | Passed |
| Filter by dietary preference | field:select-one | native picker | option → VEG: list updated, no request | — | Passed |
| Filter by customer status | field:select-one | native picker | option → INDIVIDUAL: list updated, no request | — | Passed |
| View Walk-in Arjun profile | submit | registered | registered; content changed 1 request(s) 200 | 55 ms | Passed |
| Edit Walk-in Arjun | submit | registered | registered; content changed | 22 ms | Passed |
| Deactivate Walk-in Arjun | submit | not clicked here | status INACTIVE | — | Passed |
| View Meera Subscription profile | submit | registered | registered; content changed 1 request(s) 200 | 50 ms | Passed |
| Edit Meera Subscription | submit | registered | registered; content changed | 35 ms | Passed |
| Deactivate Meera Subscription | submit | not clicked here | status INACTIVE | — | Passed |
| View Kabir Subscription profile | submit | registered | registered; content changed 1 request(s) 200 | 31 ms | Passed |
| Edit Kabir Subscription | submit | registered | registered; content changed | 32 ms | Passed |
| Deactivate Kabir Subscription | submit | not clicked here | status INACTIVE | — | Passed |

#### /rooms (14)

| Control | Kind | First-click test | Functional test / evidence | Time to effect | Result |
|---|---|---|---|---:|---|
| Go to a section | field:text | focus on 1st click | focus on 1st click; accepts input | — | Passed |
| Notifications | button | registered | registered; opened | 23 ms | Passed |
| Profile and account | button | registered | registered; opened | 14 ms | Passed |
| Refresh rooms | button | registered | registered; request(s) 200 /api/rooms | — | Passed |
| Add room | button | not clicked here | 1 room(s) T4OV8A | — | Passed |
| Search room or resident | field:text | focus on 1st click | focus on 1st click; accepts input | — | Passed |
| Floor | field:select-one | native picker | option → 0: list updated, no request | — | Passed |
| Status | field:select-one | native picker | option → VACANT: no visible change, no request; re-tested with "Occupied": list updated | — | Passed |
| Beds & maintenance | button | registered | registered; opened, 1 request(s) 200 | 25 ms | Passed |
| Edit resident profile | submit | registered | registered; opened, 1 request(s) 200 | 20 ms | Passed |
| Check out resident | submit | not clicked here | same server actions as Residents check-in/check-out (passed on screen there and in the workflow suite); this screen's form opens (control audit) | — | Passed |
| Assign tenant | submit | not clicked here | same server actions as Residents check-in/check-out (passed on screen there and in the workflow suite); this screen's form opens (control audit) | — | Passed |
| Edit | submit | registered | registered; opened | 32 ms | Passed |
| Cannot delete: room is occupied | submit | registered | registered; opened | 10 ms | Passed |

#### /finance?tab=cashbook (22)

| Control | Kind | First-click test | Functional test / evidence | Time to effect | Result |
|---|---|---|---|---:|---|
| Go to a section | field:text | focus on 1st click | focus on 1st click; accepts input | — | Passed |
| Notifications | button | registered | registered; opened | 19 ms | Passed |
| Profile and account | button | registered | registered; opened | 8 ms | Passed |
| Refresh financial records | button | registered | registered; request(s) 200 /api/finance/transactions, 200 /api/finance/cashbook, 200 /api/residents | — | Passed |
| Export the cashbook as CSV | button | n/a | CSV downloaded (ui_workflows) | — | Passed |
| Monthly rent | button | registered | registered; opened, 1 request(s) 200 | 33 ms | Passed |
| Rent charge | button | registered | registered; opened | 14 ms | Passed |
| Deposit | button | registered | registered; opened | 23 ms | Passed |
| Expense | button | registered | registered; opened | 45 ms | Passed |
| Record payment | button | not clicked here | payment recorded once after triple click and real double-click | — | Passed |
| This Month | button | already selected | already selected; current period; aria-pressed added in this round | — | Passed |
| Last 30 Days | button | registered | registered; content changed, 3 request(s) 200/200/200 | 27 ms | Passed |
| All Time | button | registered | registered; request(s) 200 /api/finance/transactions, 200 /api/finance/cashbook, 200 /api/residents | — | Passed |
| 2026-11-01 | field:date | native picker | date → 2026-10-29: list updated, 3 request(s) 200 | — | Passed |
| 2026-11-04 | field:date | native picker | date → 2026-10-29: list updated, 3 request(s) 200 | — | Passed |
| Search by party, room, reference, or description... | field:text | focus on 1st click | focus on 1st click; accepts input | — | Passed |
| All Divisions PG Guesthouse Tiffin Service | field:select-one | native picker | option → PG: list updated, no request | — | Passed |
| All Types Rent Payment Rent Charge (Billed) Security Deposit | field:select-one | native picker | option → RENT_PAYMENT: list updated, no request | — | Passed |
| All Methods Cash UPI / QR Bank Transfer Cheque Card / Other | field:select-one | native picker | option → CASH: list updated, no request | — | Passed |
| All Status Posted Reversed | field:select-one | native picker | option → POSTED: list updated, no request | — | Passed |
| Record Payment | submit | not clicked here | payment recorded once after triple click and real double-click | — | Passed |
| Issue Rent Charge | submit | not clicked here | rent charge posted once after double click | — | Passed |

#### /finance?tab=residents (14)

| Control | Kind | First-click test | Functional test / evidence | Time to effect | Result |
|---|---|---|---|---:|---|
| Go to a section | field:text | focus on 1st click | focus on 1st click; accepts input | — | Passed |
| Notifications | button | registered | registered; opened | 25 ms | Passed |
| Profile and account | button | registered | registered; opened | 10 ms | Passed |
| Refresh financial records | button | registered | registered; request(s) 200 /api/finance/transactions, 200 /api/finance/cashbook, 200 /api/residents | — | Passed |
| Export the cashbook as CSV | button | n/a | export covers the cashbook only; disabled by design on this tab | — | Not applicable |
| Monthly rent | button | registered | registered; opened, 1 request(s) 200 | 35 ms | Passed |
| Rent charge | button | registered | registered; opened | 15 ms | Passed |
| Deposit | button | registered | registered; opened | 33 ms | Passed |
| Expense | button | registered | registered; opened | 20 ms | Passed |
| Record payment | button | not clicked here | payment recorded once after triple click and real double-click | — | Passed |
| Search residents by name, phone, or assigned room number... | field:text | focus on 1st click | focus on 1st click; accepts input | — | Passed |
| All Residents Currently In-House (Active) Checked Out | field:select-one | native picker | option → ACTIVE: list updated, no request | — | Passed |
| E2E Resident | submit | registered | registered; content changed, 1 request(s) 200 | 20 ms | Passed |
| View Statement | button | registered | registered; content changed 1 request(s) 200 | 8 ms | Passed |

#### /finance?tab=invoices (17)

| Control | Kind | First-click test | Functional test / evidence | Time to effect | Result |
|---|---|---|---|---:|---|
| Go to a section | field:text | focus on 1st click | focus on 1st click; accepts input | — | Passed |
| Notifications | button | registered | registered; opened | 27 ms | Passed |
| Profile and account | button | registered | registered; opened | 10 ms | Passed |
| Refresh financial records | button | registered | registered; request(s) 200 /api/finance/transactions, 200 /api/finance/cashbook, 200 /api/residents, 200 /api/finance/invoices | — | Passed |
| Export the cashbook as CSV | button | n/a | export covers the cashbook only; disabled by design on this tab | — | Not applicable |
| Monthly rent | button | registered | registered; opened, 1 request(s) 200 | 30 ms | Passed |
| Rent charge | button | registered | registered; opened | 24 ms | Passed |
| Deposit | button | registered | registered; opened | 32 ms | Passed |
| Expense | button | registered | registered; opened | 16 ms | Passed |
| Record payment | button | not clicked here | payment recorded once after triple click and real double-click | — | Passed |
| Search invoice #, resident, room... | field:text | focus on 1st click | focus on 1st click; accepts input | — | Passed |
| All Statuses Draft Issued Partially Paid Paid Cancelled | field:select-one | native picker | option → DRAFT: list updated, 1 request(s) 200 | — | Passed |
| All Sources (PG + Tiffin) PG Accommodation Commercial Tiffin | field:select-one | native picker | option → RESIDENT: no visible change, 1 request(s) 200 | — | Passed |
| All Bill Types Regular Bill (Non-GST) GST Tax Invoice | field:select-one | native picker | option → REGULAR_BILL: list updated, 1 request(s) 200 | — | Passed |
| Reload invoices | submit | registered | registered; request(s) 200 /api/finance/invoices | — | Passed |
| Generate Invoice | submit | not clicked here | a same-instant double click created 2 invoices before the fix; after the in-flight guard: 1 | — | Passed (after fix) |
| Generate First Invoice | submit | not clicked here | a same-instant double click created 2 invoices before the fix; after the in-flight guard: 1 | — | Passed (after fix) |

#### /finance?tab=closing (19)

| Control | Kind | First-click test | Functional test / evidence | Time to effect | Result |
|---|---|---|---|---:|---|
| Go to a section | field:text | focus on 1st click | focus on 1st click; accepts input | — | Passed |
| Notifications | button | registered | registered; opened | 18 ms | Passed |
| Profile and account | button | registered | registered; opened | 17 ms | Passed |
| Refresh financial records | button | registered | registered; request(s) 200 /api/finance/transactions, 200 /api/finance/cashbook, 200 /api/residents, 200 /api/finance/closing/preview, 200 /api/finance/closing/preview, 200 /api/finance/closing/preview | — | Passed |
| Export the cashbook as CSV | button | n/a | export covers the cashbook only; disabled by design on this tab | — | Not applicable |
| Monthly rent | button | registered | registered; opened, 2 request(s) 200/200 | 43 ms | Passed |
| Rent charge | button | registered | registered; opened, 1 request(s) 200 | 18 ms | Passed |
| Deposit | button | registered | registered; opened, 1 request(s) 200 | 36 ms | Passed |
| Expense | button | registered | registered; opened, 1 request(s) 200 | 41 ms | Passed |
| Record payment | button | not clicked here | payment recorded once after triple click and real double-click | — | Passed |
| 2026-11-04 | field:date | native picker | date → 2026-11-01: list updated, 1 request(s) 200 | — | Passed |
| Combined | button | already selected | already selected; current division; aria-pressed added in this round | — | Passed |
| PG Hostel | button | registered | registered; request(s) 200 /api/finance/closing/preview | — | Passed |
| Commercial Tiffin | button | registered | registered; request(s) 200 /api/finance/closing/preview | — | Passed |
| e.g. 15000 | field:number | focus on 1st click | focus on 1st click; accepts input | — | Passed |
| Verified online account balance | field:number | focus on 1st click | focus on 1st click; accepts input | — | Passed |
| e.g. Reconciled with evening cashier Shift B | field:text | focus on 1st click | focus on 1st click; accepts input | — | Passed |
| Save Draft | button | not clicked here | closing saved as DRAFT with counted cash | — | Passed |
| Finalize & Lock Closing | button | not clicked here | closing FINALIZED; later postings to that day refused | — | Passed |

#### /reports (19)

| Control | Kind | First-click test | Functional test / evidence | Time to effect | Result |
|---|---|---|---|---:|---|
| Go to a section | field:text | focus on 1st click | focus on 1st click; accepts input | — | Passed |
| Notifications | button | registered | registered; opened | 29 ms | Passed |
| Profile and account | button | registered | registered; opened | 15 ms | Passed |
| Daily cash closing | button | already selected | already selected; open report (aria-current=page) | — | Passed |
| Rent collection | button | registered | registered; toggled, 1 request(s) 200 | 28 ms | Passed |
| Occupancy | button | registered | registered; content changed, 1 request(s) 200 | 8 ms | Passed |
| Resident ledger | button | registered | registered; content changed, 1 request(s) 200 | 11 ms | Passed |
| Expenses | button | registered | registered; toggled, 1 request(s) 200 | 24 ms | Passed |
| Tiffin revenue | button | registered | registered; toggled, 1 request(s) 200 | 17 ms | Passed |
| Deliveries | button | not clicked here | filter applied | — | Passed |
| Cash with staff | button | registered | registered; content changed, 1 request(s) 200 | 17 ms | Passed |
| Outstanding balances | button | registered | registered; toggled, 1 request(s) 200 | 19 ms | Passed |
| 2026-11-01 | field:date | native picker | date → 2026-10-29: no visible change, 1 request(s) 200 | — | Passed |
| 2026-11-04 | field:date | native picker | date → 2026-10-29: no visible change, 1 request(s) 200 | — | Passed |
| All | button | already selected | already selected; selecting the current option changes nothing | — | Passed |
| PG | button | registered | registered; request(s) 200 /api/reports | — | Passed |
| Tiffin | button | registered | registered; request(s) 200 /api/reports | — | Passed |
| Search report | field:text | focus on 1st click | focus on 1st click; accepts input | — | Passed |
| Export CSV | link | download | download; 200 text/csv; charset=utf-8 | — | Passed |

#### /activity (8)

| Control | Kind | First-click test | Functional test / evidence | Time to effect | Result |
|---|---|---|---|---:|---|
| Go to a section | field:text | focus on 1st click | focus on 1st click; accepts input | — | Passed |
| Notifications | button | registered | registered; opened, 1 request(s) 200 | 22 ms | Passed |
| Profile and account | button | registered | registered; opened | 10 ms | Passed |
| Search action, record or person | field:text | focus on 1st click | focus on 1st click; accepts input | — | Passed |
| Area: All areas | button | registered | registered; opened | 24 ms | Passed |
| Person: Everyone | button | registered | registered; opened, 1 request(s) 200 | 11 ms | Passed |
| From | field:date | native picker | date → 2026-11-01: list updated, 1 request(s) 200 | — | Passed |
| To | field:date | native picker | date → 2026-11-01: list updated, 1 request(s) 200 | — | Passed |

#### /staff (17)

| Control | Kind | First-click test | Functional test / evidence | Time to effect | Result |
|---|---|---|---|---:|---|
| Go to a section | field:text | focus on 1st click | focus on 1st click; accepts input | — | Passed |
| Notifications | button | registered | registered; opened, 1 request(s) 200 | 15 ms | Passed |
| Profile and account | button | registered | registered; opened | 10 ms | Passed |
| Add staff | button | not clicked here | account created once after double click | — | Passed |
| Search name, username or email | field:text | focus on 1st click | focus on 1st click; accepts input | — | Passed |
| Role | field:select-one | native picker | option → SUPER_ADMIN: list updated, 1 request(s) 200 | — | Passed |
| All | button | already selected | already selected; selecting the current option changes nothing | — | Passed |
| Active | button | registered | registered; request(s) 200 /api/staff, 200 /api/notifications | — | Passed |
| Deactivated | button | not clicked here | filter applied | — | Passed |
| Login history for E2E Owner | button | registered | registered; opened, 1 request(s) 200 | 20 ms | Passed |
| Actions for E2E Owner | button | registered | registered; opened | 16 ms | Passed |
| Login history for E2E Manager | button | registered | registered; opened, 2 request(s) 200/200 | 25 ms | Passed |
| Actions for E2E Manager | button | registered | registered; opened | 20 ms | Passed |
| Login history for Ravi Kumar | button | registered | registered; opened, 2 request(s) 200/200 | 22 ms | Passed |
| Actions for Ravi Kumar | button | registered | registered; opened | 17 ms | Passed |
| Login history for Suresh | button | registered | registered; opened, 2 request(s) 200/200 | 30 ms | Passed |
| Actions for Suresh | button | registered | registered; opened | 21 ms | Passed |

#### /settings (18)

| Control | Kind | First-click test | Functional test / evidence | Time to effect | Result |
|---|---|---|---|---:|---|
| Go to a section | field:text | focus on 1st click | focus on 1st click; accepts input | — | Passed |
| Notifications | button | registered | registered; opened, 1 request(s) 200 | 19 ms | Passed |
| Profile and account | button | registered | registered; opened | 11 ms | Passed |
| Ravinarayan PG Guesthouse | field:text | focus on 1st click | focus on 1st click; accepts input | — | Passed |
| (input text) | field:text | focus on 1st click | focus on 1st click; accepts input | — | Passed |
| (input email) | field:email | focus on 1st click | focus on 1st click; accepts input | — | Passed |
| (textarea textarea) | field:textarea | focus on 1st click | focus on 1st click; accepts input | — | Passed |
| https:// | field:text | focus on 1st click | focus on 1st click; accepts input | — | Passed |
| Save | button | not clicked here | settings saved (interaction run: Saved. in 65–110 ms; workflow suite: rent due day saved) | — | Passed |
| 08:00 | field:time | focus on 1st click | focus on 1st click; accepts input | — | Passed |
| 07:30 | field:time | focus on 1st click | focus on 1st click; accepts input | — | Passed |
| 15:30 | field:time | focus on 1st click | focus on 1st click; accepts input | — | Passed |
| 15:00 | field:time | focus on 1st click | focus on 1st click; accepts input | — | Passed |
| Save (2nd row) | button | not clicked here | settings saved (interaction run: Saved. in 65–110 ms; workflow suite: rent due day saved) | — | Passed |
| Default delivery partner: Automatic (the longest-serving act | button | registered | registered; opened | 17 ms | Passed |
| (input number) | field:number | focus on 1st click | focus on 1st click; accepts input | — | Passed |
| on | field:checkbox | registered | registered; request(s) 200 /api/notifications | — | Passed |
| on (2nd row) | field:checkbox | not clicked separately | toggled true, restored true (not saved) | — | Passed |

#### /notifications (7)

| Control | Kind | First-click test | Functional test / evidence | Time to effect | Result |
|---|---|---|---|---:|---|
| Go to a section | field:text | focus on 1st click | focus on 1st click; accepts input | — | Passed |
| Notifications | button | registered | registered; opened, 1 request(s) 200 | 22 ms | Passed |
| Profile and account | button | registered | registered; opened | 12 ms | Passed |
| All | button | already selected | already selected; selecting the current option changes nothing | — | Passed |
| Unread | button | registered | registered; content changed, 2 request(s) 200/200 | 10 ms | Passed |
| Refresh | button | registered | registered; request(s) 200 /api/notifications | — | Passed |
| Mark all read | button | n/a | unread → 0 (ui_workflows) | — | Passed |

#### /account (6)

| Control | Kind | First-click test | Functional test / evidence | Time to effect | Result |
|---|---|---|---|---:|---|
| Go to a section | field:text | focus on 1st click | focus on 1st click; accepts input | — | Passed |
| Notifications | button | registered | registered; opened, 1 request(s) 200 | 20 ms | Passed |
| Profile and account | button | registered | registered; opened | 11 ms | Passed |
| Change email | button | not clicked here | form opens; confirm step uses the same OTP flow as the password change (passed) | — | Passed |
| Change password | button | not clicked here | password changed with emailed OTP; signed in with the new password | — | Passed |
| Sign out | button | not clicked here | signed out; protected pages then require sign-in | — | Passed |

## 11. Final audit — accounting

### 11.1 What the four failing assertions were

The four failures (`integration_audit` 1, `task01b_63` 3) did **not** reflect an accounting rule change. The suites were written on 20 Oct 2026 around "a September payment reversed in October", and a reversal is always dated with the current business date. Run on 4 November, the reversal lands in November, so October no longer sees the refund. With the test clock pinned to 20 Oct 2026 (assertions untouched), both suites pass in full (97/97 and 39/39). No accounting code was changed.

### 11.2 How the app behaves today (verified on an isolated database, `rn_erp_verify_acct_test`)

The policy below is what the code and its existing tests already enforce: cash basis, reversal dated the day it is made, history never rewritten.

| Scenario | Cashbook (rent collected) | Daily closing | Resident balance |
|---|---|---|---|
| Paid ₹6,000 on 10 Jan, reversed 20 Jan (same month) | Jan ₹0 | 10 Jan in ₹6,000; 20 Jan out ₹6,000 | charged 6,000, paid 0, owes 6,000 |
| Paid 15 Mar, reversed 5 Apr (nothing else in April) | Mar ₹6,000; Apr **₹0**; Mar–Apr **₹0** | 15 Mar in 6,000; 5 Apr out 6,000 | owes 6,000 |
| Paid ₹6,000 on 15 May, reversed 5 Jun; ₹2,000 collected 3 Jun | May ₹6,000; Jun **₹0**; May–Jun ₹2,000 | 3 Jun in 2,000; 5 Jun out 6,000 | charged 12,000, paid 2,000 |
| Partial refund (₹2,000 of ₹6,000): reverse and re-record ₹4,000 on 8 Jul | Jul ₹4,000 | 8 Jul in 4,000, out 6,000 | paid 4,000, owes 2,000 |
| Second refund of the same payment | — | — | refused ("already reversed") |
| Reversing a reversal | — | — | refused ("Reversal records cannot themselves be reversed") |
| Same payment submitted twice with one key | Aug ₹6,000 | — | paid once |
| Paid 31 Dec 23:30, reversed 1 Jan 00:30 IST | Dec ₹6,000; Jan ₹0; year ₹18,000 | 1 Jan out 6,000 | owes 6,000 |
| Whole history | ₹12,000 | — | = posted rent receipts in the ledger ₹12,000 |

Also verified: the Dashboard's "rent settled" counts only payments still posted, so it shows March ₹0 for the March payment reversed in April. There is no partial-reversal feature; a partial refund is a full reversal plus a new receipt.

### 11.3 Decision required from you (nothing changed)

The cashbook subtracts a refund from another month in the month of the refund, but floors rent collected at **₹0** (`Math.max(0, …)`). As a result:

- a month whose refunds exceed its receipts shows ₹0, not a negative figure (April: ₹0 shown, −₹6,000 actual movement; June: ₹0 shown, −₹4,000 actual movement);
- monthly figures then do not add up to a multi-month range (Mar ₹6,000 + Apr ₹0 ≠ Mar–Apr ₹0; May ₹6,000 + Jun ₹0 ≠ May–Jun ₹2,000);
- the Dashboard's "rent settled" for March shows ₹0 while the cashbook shows ₹6,000 for March.

The daily closings always show the real in and out, so cash in hand is right. The choice is only about the monthly report:

- **A. Keep the floor** (current behaviour): no negative months, but months don't sum.
- **B. Allow negative months:** months sum exactly to ranges and match the daily closings.
- **C. Keep ₹0 but show refunds as a separate line** in the month they happen.

No existing product rule, document or test states which is intended when a month's refunds exceed its receipts, so no policy was invented.

## 12. Final audit — end-to-end workflow suite

| Run | Result | Notes |
|---|---|---|
| Original (earlier this round) | 98 passed, 25 failed | Script issues and test-environment issues, see below |
| Corrected script, run 1 | 124 passed, 1 failed | Rent preview: script still used a case-sensitive label |
| Corrected script, run 2 (fresh fixtures) | 124 passed, 1 failed | Rent preview: the script read the dialog while it still said "Preparing" (its wait matched the static subtitle). The same run's server check passed: charged ₹8,700 prorated for the resident who joined on the 2nd and ₹9,000 for the full month, with a second run charging nothing. |
| Corrected script, run 3 (fresh fixtures, waits for the loaded preview) | **125 passed, 0 failed** | Final. Took 36 min against 27 for run 2: the PC was low on memory (1.0 GB of 15.7 GB free); no request over 1 s, no errors, no recompiles, no source change during the run |

Script corrections (no app change, no assertion relaxed): the beds selector finds the button by its text; the rent-run label is matched case-insensitively and the preview is read only once loaded; the ledger range extends to the checkout date the script itself chooses; the Owner desktop signs in again after the phone sign-in, because the one-session rule correctly ends the first session.

**The 16 Manager failures** did not recur in any of the three runs. A diagnostic recorded the Manager cookie and a 200 from `/api/auth/me` before and after the idle period. The session policy was then tested on its own (**12/12**):

- signing in on a second device ends the first session (401 `SESSION_PREEMPTED`);
- the second device is unaffected;
- signing out invalidates the session;
- an expired session is refused;
- the Manager is unaffected by the Owner's sign-ins.

## 13. Final audit — duplicate submissions

Screen (every money and create form): one idempotency key per opened form, and a second activation is ignored while a request is in flight (§4.1). This was added in this round to the tiffin payment form.

API, large dataset, results per type:

| Type | 5 identical requests at once, one key | Abort, then retry with the same key | Invalid, then valid | Balances moved once |
|---|---|---|---|---|
| Rent charge | 1 row, 1 audit entry | 1 row | 400 then 201, 1 row | yes |
| Rent payment | 1 row, 1 audit entry | 1 row | 400 then 201, 1 row | yes |
| Security deposit | 1 row, 1 audit entry | 1 row | 400 then 201, 1 row | yes |
| Expense | 1 row, 1 audit entry | 1 row | 400 then 201, 1 row | yes |
| Tiffin payment | 1 row, 1 audit entry | 1 row | 400 then 200, 1 row | — |
| Tiffin billing run | **fixed**: 3 concurrent runs for one month created more than one invoice before; now 1 | — | — | — |
| **Invoice (draft or issued)** | **2 identical requests at once → 2 invoices; issued → 2 posted charges** | — | — | — |

**Decision required (invoices):** invoices have no idempotency key on the server. The form already blocks double clicks and in-flight resubmits, so this needs two identical requests from outside the app at the same instant (or a network-level retry). A server-side fix needs an idempotency-key column on invoices, which is a **migration**, so it was not done. Options: (a) add the column and key handling (migration needed, small); (b) accept the client-side protection.

## 14. Final audit — performance

**Cashbook search** (500 entries loaded, 4× CPU throttle, three interleaved before/after rounds, ms per keystroke):

| | Median | Worst |
|---|---|---|
| Before | 69 / 56 / 70 | 219 / 147 / 147 |
| After | **40 / 34 / 39** | **100 / 97 / 115** |
| Unthrottled | 12 → 8 | — |

Results were identical before and after ("1 to 12 of 12", every row matched). Change: rows are memoised and only rebuilt when the visible page changes, and the filter uses a deferred copy of the query (`CashbookLedger.tsx`).

**Cold start**, investigated over 5 fresh production-server starts (large dataset). The earlier 6–12 s was **not reproduced**:

| Measure | Range over 5 trials |
|---|---|
| Server ready | 4.4–5.3 s |
| First database request | 157–245 ms |
| First page | 660–919 ms (2,062 ms once, under parallel load) |
| First navigation: feedback / destination frame | 20–30 ms |
| First navigation: data rendered | 202–302 ms |
| Return visit | 39–63 ms |

The remaining candidate for the one slow start is machine load at the time (WSL hosting the database was under strain that day; §3.1 item 6). Not proven.

**Re-check of the navigation work** on the final build: stress 20/20 (53–225 ms). No frame showed the previous page together with the destination frame.

## 15. Final audit — isolation evidence

- Test databases: container `rn_erp_verify_pg` (in-memory storage) on 127.0.0.1:55432, holding `rn_erp_verify_test`, `rn_erp_verify_e2e_test`, `rn_erp_verify_large_test` and `rn_erp_verify_acct_test`. Every test server was started with an explicit address pointing there.
- Your local database `ravinarayana_erp_local` (container `ravinarayana-postgres-local`, port 5432) was not used by any test or test server.
- Neon: never contacted. `.env.local` unchanged (`git status` shows no change).
- No production build or start in the working tree; builds ran only in `%TEMP%\rn-erp-test-sandbox`.
- No migration written or run in this work. The four untracked migration files (`0016_business_settings` … `0019_order_revisions`, dated 1 Nov, plus their journal entry) are from the earlier feature work, are unchanged by this audit and have not been applied to Neon.
- Delivery staff app, `mobile/`, Kitchen: no changes; `/kitchen` still redirects to Orders.

## 16. Final audit — files changed

On top of §8:

- `apps/erp/src/server/tiffin/tiffinBillingService.ts`: per-period lock in `generateTiffinInvoices`.
- `apps/erp/src/modules/tiffin/components/modals/RecordTiffinPaymentModal.tsx`: stable idempotency key per opened form.
- `apps/erp/src/modules/finance/components/CashbookLedger.tsx`: memoised rows, deferred query.
- `apps/erp/src/app/(management)/dashboard/DashboardCharts.tsx`: tooltip anchoring at the edges.
- `tests/helpers/fixedClock.ts` (new), `tests/integration_audit.test.ts`, `tests/task01b_63_financial_integrity_phase2.test.ts`: test clock pinned to 20 Oct 2026.
- `tests/fixture_isolation_and_transaction_integrity.test.ts`: line-ending normalisation.
- `tests/task01b_68_mobile_pilot_verification.test.ts`: SDK-present branch.
- `tests/pg_tiffin_management.test.ts`: concurrent first billing run.
- This report.
