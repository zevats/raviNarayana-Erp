# Order → Delivery Workflow (round 7, 2026-10-30)

Audit, design, implementation and verification of the operational workflow: **Orders** (create) → **Delivery** (complete, collect). Evidence: [VERIFICATION_LOG.md](VERIFICATION_LOG.md) VL-48 (live PostgreSQL) and VL-49 (browser E2E). Issues: ISSUE-063 … ISSUE-072 in [ISSUE_REGISTER.md](ISSUE_REGISTER.md).

## 1. Menu recovery

**Searched:**
- the `tiffin_products` table and its seed API (`/api/tiffin/products/seed` → `seedDefaultCatalogIfEmpty`);
- `INITIAL_TIFFIN_CATALOG` in `server/tiffin/tiffinService.ts`;
- `docs/PROJECT_REQUIREMENTS.md`, which is in the repository's first commit `14b60f7`;
- fixtures, tests, and Git history (`git log -S`).

The protected `data/erp.db` was **not** read.

**Source of truth.** PRD §5.1, "Supplied Initial Product Catalog & Baseline Rates", lists 15 rows:
- **14 have fixed prices**, and `INITIAL_TIFFIN_CATALOG` holds exactly those 14 with the same codes and prices. This is the "Catalog Items 14/14" seen before.
- **The 15th**, `SNK-PARTY` (Samosa / Bread Pakora / Burger, minimum 15 pieces), is priced *Quoted*. It has no fixed price, so it is not a menu row.

| Code | Name (seeder) | Price | Unit | Category |
|---|---|---|---|---|
| TIF-DAILY | Daily Standard Tiffin | ₹80 | per meal | Standard meal |
| TIF-MON-BOTH | Monthly Lunch & Dinner Package | ₹3,500 | per month | Subscription package |
| TIF-MON-SINGLE | Monthly Single Meal Package | ₹2,000 | per month | Subscription package |
| TIF-FRI-BOWL | Friday Curry Rice Bowl | ₹60 | per portion | Special |
| EXT-ROTI | Extra Chapati / Tawa Roti | ₹8 | per piece | Extra |
| EXT-CURD | Fresh Curd (Dahi) | ₹30 | per portion | Extra |
| EXT-RAITA | Boondi / Veg Raita | ₹35 | per portion | Extra |
| EXT-SWEET | Sweet of the Day | ₹40 | per portion | Extra |
| EXT-LASSI | Sweet Punjabi Lassi | ₹50 | per portion | Beverage |
| EXT-CHAAS | Spiced Buttermilk (Chaas) | ₹25 | per portion | Beverage |
| EXT-PAPAD | Roasted / Fried Papad | ₹10 | per piece | Extra |
| EXT-PICKLE | Premium Pickle Pack | ₹15 | per portion | Extra |
| EXT-PANEER | Paneer Sabzi Upgrade | ₹40 | per portion | Extra |
| EXT-RICE | Extra Steamed Rice | ₹20 | per portion | Extra |

The PRD writes three names slightly differently:
- "Monthly Lunch & Dinner";
- "Monthly Single Meal";
- "Buttermilk / Spiced Chaas".

The prices are identical. **Owner decision:** which spelling to keep. Nothing was renamed.

**Not yet restored on your local DB.** `ravinarayana_erp_local` currently holds **0** products. Restoring them means inserting the 14 rows, which is a seed and needs approval.
- Prepared path: the existing, idempotent seeder. It only inserts when the table is empty and never deletes or rewrites rows. Run it as the Owner with `POST /api/tiffin/products/seed`, or through the same function.
- The two monthly packages are subscription products. The order form no longer offers them as order items (see 3.3).

## 2. Audit findings

These are traced in code and confirmed in tests before any change.

| # | Finding | Effect |
|---|---|---|
| A1 | `createUnifiedOrder` priced lines with the **browser's** `unitPrice`. Lines without a product id were accepted as free text. | Totals and prices could be set by the client. |
| A2 | The delivery form read items by parsing `[ORDER_JSON:…]` out of the task notes. If that was missing it **invented "Meal Portion" at ₹120**. | Possibly fabricated data and prices. |
| A3 | One aggregate delivered count was spread over items by ratio with rounding. | Per-item delivered quantities could be wrong. |
| A4 | Expected amount = delivered portions × **average** unit price. | Wrong amount for mixed orders. For example, 1 thali (₹80) plus 5 rotis (₹8) gave ₹20 for the thali alone. |
| A5 | The server never computed the amount due. Collection was not limited (any amount ≥ 1). There was no balance. | Over-collection possible. Partial payments could not be tracked. |
| A6 | `recordDeliveryCollection` overwrote the collected total, with no cap, lock or method check. | A later payment replaced the first. Concurrent payments could race. |
| A7 | The Orders list measured payment against the full order total. | A partly delivered order paid in full for what was delivered still showed "partial / unpaid". |
| A8 | A new idempotency key was generated on every click. | A retry after a lost response created a second order. |
| A9 | The form pre-added the first product (×1), offered the ₹3,500 and ₹2,000 monthly packages, and "Reuse" put items no longer on the menu back in at their old price. | Accidental lines and wrong items. |
| A10 | The form was not reset between orders. | The next order inherited the previous customer's phone (seen in E2E: a dine-in guest got the delivery customer's number). |
| A11 | Updates from other staff arrived only through 20-second polling. | Not real time. |
| A12 | My own round-6 cache change: a second invalidation of a key whose reload was in flight cancelled the reload without notifying the page. Found by E2E. | After two quick saves, the Orders list stayed stale until the next poll (up to 20 s). |
| A13 | Dead code: `DispatchBoardView` (the Owner's driver-run console), `DriverRunView`, `BatchAssignModal` and `TaskTimelineModal` are not imported anywhere. | No runtime effect. Not reintroduced; left in place. |

**Answers to the feasibility questions (§6):**

1. **Several orders per customer per day?** Yes. There is no constraint, and it is verified.
2. **Reuse without touching history?** Yes. Reuse copies the lines into a new draft, and the old order is unchanged (verified).
3. **Prices snapshotted?** Yes. `order_items.unit_price` is taken from the menu at creation (now server-side).
4. **Menu price changes don't alter orders?** Verified: price changed to ₹95, and the placed order stayed at ₹90.
5. **Dine-in in Delivery?** No. A dine-in order is a counter sale with no delivery task (verified in UI and DB).
6. **Complete twice?** No. A status-guarded update applies once. Three concurrent completions produce one event, and repeats are no-ops.
7. **Partial delivery accurately?** Yes, per item: delivered quantity plus reason, stored in `order_items`.
8. **Balance after delivery?** Yes. Amount due is Σ delivered × saved price; balance = due − collected; a "Collect balance" action follows.
9. **Collection without marking delivered?** Balance collection requires a delivered order. Delivery and payment are separate states (delivered and unpaid is shown as "₹80 pending").
10. **False success after a failed API call?** No. Errors are shown, entries are kept, and success comes only from a 2xx response (verified with an injected 500).
11. **Concurrent updates?** Completion is applied once. Balance payments are serialized with a row lock and capped, so two simultaneous final payments result in one accepted. Order editing does not exist (ISSUE-036, Owner decision).
12. **Roles enforced server-side?**
   - Delivery cannot create orders (403), cannot complete or collect for another driver's task, and is redirected away from `/orders`.
   - Manager and Owner create orders.
   - Owner-only finance actions are unchanged.
13. **Recovery after refresh or network loss?** Orders and outcomes are server-persisted. An offline delivery completion is queued on the phone and replayed with the same per-item payload. A replay of an already recorded outcome is idempotent.
14. **Traceable?** Yes, through:
   - the order and its lines (price snapshot, delivered quantity, reason);
   - delivery task events (each payment with amount, method and running balance);
   - audit rows with per-line outcome, amount due, collected amount and balance.

## 3. Current → target flow

| Step | Before | Now |
|---|---|---|
| Choose type | Delivery / Dine-in first ✓ | Unchanged (verified first). |
| Customer | Existing search ✓, new ✓; form not reset; history shows 2 orders | Clean form on every open; up to 5 past orders; "Reuse" note: *copies at today's prices, past orders unchanged*; items no longer on the menu are left out and named. |
| Menu | All active products, including monthly packages, first item pre-added | Only orderable items (12 of 14: monthly packages excluded); nothing pre-added; larger +/− buttons (36 px). |
| Prices and totals | Client prices trusted | Name and price from the menu on the server; client price ignored; inactive and non-menu lines rejected. |
| Save | New key per click | One key per draft (double click or retry = same order). |
| Assignment | Default delivery account (`ERP_DEFAULT_DELIVERY_USERNAME`, else the longest-serving active) | Unchanged (a real staff record; no manual assignment UI). |
| Delivery card | Items from notes text | Structured lines; shows due, collected and balance; "Collect balance" when money is outstanding; open deliveries listed first. |
| Complete | One portions counter, average price, ₹120 fallback | One row per item: delivered and not-delivered steppers (either drives the other), "All delivered" and "Nothing delivered" shortcuts; reason required on any shortfall; live due / collected / remaining; outcome line ("Partly delivered (5 of 6) · ₹34 pending"); bottom sheet on phones with 40 px targets. |
| Server completion | Trusted client figures | Validates every line (0…ordered, delivered + undelivered = ordered); due computed from saved prices; collected must be 0…due; nothing delivered → "not delivered" with a reason and nothing collectable; writes task, lines, order status, event and audit in one guarded transaction. |
| Payment state | Measured against the order total | Measured against the amount due for delivered items; Orders shows Delivered / Partly delivered / Not delivered and PAID / PART PAID ₹x · ₹y PENDING / UNPAID / NOTHING DUE. |
| Updates | 20-second polling | Live (see 4), with polling kept as the fallback. |

## 4. Live updates

**Mechanism.** Server-Sent Events on `GET /api/events`, authenticated.
1. After any committed write to a business table, the database layer raises an in-process signal (`changeSignals.ts`, already used for server caches) naming the written tables.
2. The stream maps those tables to cache tags (orders, delivery, finance and so on), merges bursts over 250 ms, and sends `{tags}` only. It never sends data.
3. Each tab invalidates those tags and refetches through the normal permission-checked APIs. It skips tags it invalidated itself in the last 2 seconds (its own save already refreshed them).
4. A heartbeat goes out every 25 s and re-checks the session. A signed-out or replaced session gets `signed-out` and is sent to the login page.
5. The header shows **Live**, **Connecting…** or **Reconnecting…**. On phones, the Online badge shows "Live".

**Measured** (sandbox, two browsers): a new delivery appeared on the driver's phone in ≤2 s. A delivery outcome or payment appeared on the Manager's Orders page in 0.62–0.79 s. No reloads were needed.

**Limitations:**
- Signals are per server process. That matches this deployment (one `next dev` or `next start`). Several app instances would need PostgreSQL `LISTEN/NOTIFY` to share them.
- Each open tab holds one HTTP connection.
- If the stream drops, the browser reconnects every 3 s, and the 20-second polling on Orders and Delivery still refreshes the data.

**Stale responses.** A late response never replaces newer state. In-flight requests are cancelled by invalidation (A12 fixed), and the page shows only what the cache holds for its current key.

## 5. Files changed (round 7)

**Server:**
- `server/orders/orderService.ts`: menu-priced lines; amount due, balance and delivery outcome in the order list; real order id in the history.
- `server/delivery/deliveryService.ts`:
  - structured order lines on tasks;
  - order-backed completion (`completeOrderDelivery`);
  - additive, capped, locked balance collection (`collectOrderBalance`);
  - offline replay carries `lines`, and a not-delivered replay is idempotent.
- `server/database/changeSignals.ts` and `db.ts`: the signal carries the written table names.
- `app/api/events/route.ts` (new): the live-update stream.
- `app/api/delivery/tasks/[id]/deliver/route.ts`: passes `lines`.
- `types/index.ts`: `DeliveryOrderLine`, `DeliveryLineOutcome`, plus order and task payment fields.

**UI:**
- `modules/delivery/components/modals/SingleScreenDeliveryModal.tsx`: rewritten.
- `app/(management)/delivery/page.tsx`: structured items, money line, Collect balance, open-first ordering.
- `app/(management)/orders/page.tsx`: outcome and payment badges.
- `modules/orders/components/NewOrderModal.tsx`: draft key, clean form, orderable menu, reuse rules, larger controls.
- `components/layout/ErpShell.tsx`: live connection and indicator.
- `lib/cache/erpDataCache.ts`: a cancelled reload now triggers a refetch.

**Tests:**
- `tests/pg_order_delivery_workflow.test.ts` (new, 46 checks);
- `tests/pg_orders.test.ts`: menu-priced lines, client price ignored, monthly and inactive items rejected, price snapshot;
- `tests/task01b_70_two_page_workflow.test.ts` and `tests/task01b_71_runtime_fixes_and_ux.test.ts`: per-line completion.

**Schema:** no new migration. Everything uses migration `0012` (`orders`, `order_items` with `unit_price`, `delivered_quantity`, `undelivered_reason`), which is prepared but **not applied** to your local DB.

## 6. Verification matrix

Isolated infrastructure only:
- disposable PostgreSQL 16 (`127.0.0.1:55432`, tmpfs);
- sandbox copy of the code with no env files;
- synthetic Owner, Manager and Delivery accounts (the driver is named "Suresh" and configured as the default);
- the real 14-item catalog loaded into that disposable database;
- outbox email.

No real records were touched.

**Evidence key:** **PG** = `pg_order_delivery_workflow` 46/46 (service level, live PostgreSQL). **UI** = `workflow_e2e.js`, 30/30 on two consecutive runs, with Manager on desktop and Suresh on a 390 px phone side by side.

| # | Test | Expected | Actual | Result | Evidence |
|---|---|---|---|---|---|
| 1 | New customer + delivery order | Customer saved; one order; total from the menu | ₹192 (2×80 + 4×8); customer row created | PASS | UI M2/1, PG §1 |
| 2 | Existing customer order | Pick customer; history shown | Found by search; past orders listed | PASS | UI 2a, PG §2 |
| 3 | Reuse and change quantities | New order; old one unchanged | Cart 2+4 → 3+4; orders ₹192 and ₹272; first unchanged | PASS | UI 2/3, PG §2 |
| 4 | Dine-in not in Delivery | No delivery task | 0 tasks; not on the phone | PASS | UI 4, PG §3 |
| 5 | Automatic assignment to Suresh | Assigned to the configured account | "Assigned to Suresh" | PASS | UI 5, PG §1 |
| 6 | Driver sees the details | Name, phone, address, items, quantities, total, order id | All present on the card and in the modal | PASS | UI 6, PG §1 |
| 7 | Fully delivered | Delivered; due = order total | "Fully delivered · fully paid"; PAID ₹80 | PASS | UI 7, PG §5 |
| 8 | Partial delivery with reason | Reason required; per-item stored | Blocked without a reason; 2/2 and 3/4 stored with reason | PASS | UI 8a/8, PG §6 |
| 9 | Undelivered with reason | Not delivered; nothing due or collectable | Saved; payment hidden; Orders shows Not delivered / NOTHING DUE | PASS | UI 9, PG §8 |
| 10 | Quantities reconcile | Delivered + not delivered = ordered | Stepper pair; server rejects mismatches, negatives and excess | PASS | UI 10, PG §4 |
| 11 | Expected from delivered × saved prices | ₹184 for 2 thali + 3 roti | ₹184 (not the ₹192 ordered) | PASS | UI 11, PG §6 |
| 12 | Full payment | Balance 0 | Collected ₹184 after balance payment; PAID | PASS | UI 12, PG §5 |
| 13 | Partial payment and balance | ₹150 of ₹184 → ₹34 pending | Balance ₹34; then collected once more | PASS | UI 8/13/15, PG §6 |
| 14 | Delivery ≠ payment | Delivered with ₹0 → pending | "Fully delivered · ₹80 pending"; PENDING | PASS | UI 14, PG §7 |
| 15 | Delivery result persists | Stored in DB and shown after save | Card balance plus API figures match | PASS | UI 8/13/15, 11 |
| 16 | Live update without refresh | Phone and Orders update by themselves | Phone ≤2 s; Orders 0.62–0.79 s | PASS | UI 16a/16b/16c |
| 17 | Duplicate clicks | One order; one payment | Double click on Confirm → 1 order; double click on Record payment → ₹34 once | PASS | UI 1/17, 12/17b, PG §5/§6 |
| 18 | Concurrent updates | No silent overwrite | 3 concurrent completions → 1 event; 2 concurrent final payments → 1 accepted, never over-collected | PASS | PG §5/§6 |
| 19 | Permissions | Delivery cannot create orders or open Orders; other drivers locked out | 403; /orders → /delivery; other driver cannot see or complete | PASS | UI 19, PG §1/§4/§10 |
| 20 | Mobile | No horizontal scroll; usable controls | Overflow 0 px; modal fits 390 px; tap targets ≥ 40 px | PASS | UI 20a/20b |
| 21 | Errors and retry | Error shown; entries kept; retry works | Injected 500 → "Temporary server problem", ₹150 and 3 rotis kept; retry saved | PASS | UI 21b |
| — | Over-collection | Blocked in UI and server | "cannot be more than ₹184"; server rejects ₹201 > ₹200 | PASS | UI 11a, PG §4 |
| — | Offline replay | Same per-item outcome | 3 of 4 delivered and ₹24 stored via sync | PASS | PG §9 |
| — | Console | No errors | None, apart from the deliberately injected 500 | PASS | UI |

**Not verified:**
- **On your local DB**, which lacks migration 0012 and has no menu, so Orders returns 400 there.
- **On a physical phone or installed PWA:** emulated 390 × 844 with touch only.
- **Owner-role browser run:** Owner order creation and assignment are covered at service level (PG §10).

## 7. Decisions and approvals needed

1. **Apply migration 0012** to `ravinarayana_erp_local` (`npm run db:migrate`, then the idempotent backfill `scripts/backfill-orders.js`). Without it, Orders and the new delivery completion cannot work on your local app. This is ISSUE-039, still blocked pending approval.
2. **Restore the menu**: run the existing seeder on the local DB (inserts the 14 items listed above). Approval needed.
3. **The "Suresh" account.** There is no Suresh account locally; the only delivery account is *Zevats Delivery*. Either create Suresh's staff account (name, email for OTP, password) and set `ERP_DEFAULT_DELIVERY_USERNAME`, or confirm that Zevats Delivery stands in for now.
4. **Menu name spelling:** keep the seeder names or use the PRD wording (prices identical).
5. **Price override.** PRD §5.1 says authorised managers may override prices per order. The server now uses menu prices only (no override in the UI or the API). Should an Owner-approved override be added?
6. **Party snacks** (`SNK-PARTY`, "Quoted") are not on the menu, and there is no quoted-price order path.
7. **Order edit/cancel** (ISSUE-036) and Manager settlement authority (ISSUE-026) are still open.
