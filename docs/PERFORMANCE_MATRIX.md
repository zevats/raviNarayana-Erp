# Performance Matrix — page by page

Round 6, 2026-10-30. Companion to [VERIFICATION_LOG.md](VERIFICATION_LOG.md) (VL-39 … VL-47) and [ISSUE_REGISTER.md](ISSUE_REGISTER.md) (ISSUE-053 … ISSUE-062).

## How these numbers were obtained

- **App:** the working-tree code in `next dev` (development mode, which is how this machine runs the ERP), on a verification instance at `http://localhost:3003` with its own build folder. It ran the same code as your :3001 server, against the **real local database** `ravinarayana_erp_local`, with OTP email written to a local outbox instead of Gmail.
- **Warm-up:** the server was warmed with `scripts/warm-erp-routes.ps1` exactly as `start-erp.ps1` does. Figures for a server that is still compiling are given separately in VL-39 and VL-41.
- **Accounts:** the two local profiles, `rishabh_manager` (Manager) and `zevats_delivery` (Delivery). The Owner was not used on the real database: its OTP goes to a real inbox, and signing in would end your own session. **Owner page timings were not measured in this round** (the planned sandbox Owner run was superseded by the order-workflow work); Owner access to Orders and Delivery was exercised in the workflow tests (VL-48, VL-49).
- **Browser:** headless Microsoft Edge driven over CDP. Manager at 1366×900; Delivery at 390×844 with touch.
- **Timings:** measured inside the page with `performance.now()`:
  - **Usable** = the URL is reached, no navigation progress bar, no skeleton blocks, and page text is rendered.
  - **Click feedback** = the first frame showing the click registered.
- **Request counts:** API counts come from the browser's network log. DB queries, DB time, the slowest single query and **new PostgreSQL connections** come from the dev-only metrics endpoint.
- **Phases:**
  - **first** = first visit in this browser session (the server is warm);
  - **return** = second visit;
  - **after 1/5/15 min** = another tab was in front for that long (the app tab hidden and its polling paused), then the user switched back and visited every page again.
- **Typed-URL rows** are full document loads, such as a bookmark or a typed address, and include any redirect.
- **Read-only:** no data was written to your records. Mutation freshness (orders, deliveries, payments appearing in other open browsers without a reload) was tested in the sandbox workflow E2E (VL-49).
- **Known data limitation:** migration `0012` is not applied to the local DB (ISSUE-039), so every `/orders` data request returns 400 there. The Orders page itself renders and shows its error state, and the Kitchen and Tiffin redirects land on it.

## Results

#### Manager (1366×900 desktop)

Login: page interactive 1089 ms · password → code field 676 ms (login API 644 ms, 8 queries) · OTP submit → URL 556 ms → usable 865 ms → settled 1480 ms (verify API 246 ms; 30 queries, 1 new connections).

| Page | How | First | Return | After 1 min | After 5 min | After 15 min | Click feedback (max) | API (first/return) | DB queries first (ms) | Max query ms | New conns | Failed requests | Correct page |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| /rooms | nav link | 270 | 40 | 53 | 305 | 218 | 23 | 1/0 | 4 (18) | 26 | 0 | none | yes |
| /residents | nav link | 300 | 78 | 22 | 222 | 205 | 32 | 2/0 | 6 (35) | 16 | 0 | none | yes |
| /finance | nav link | 528 | 55 | 126 | 240 | 257 | 36 | 3/0 | 9 (88) | 16 | 0 | none | yes |
| finance tab: residents | tab | 36 | 33 | 33 | 33 | 37 | 37 | 0/0 | 0 (0) | 0 | 0 | none | yes |
| finance tab: invoices | tab | 88 | 35 | 127 | 192 | 202 | 43 | 1/0 | 3 (11) | 30 | 0 | none | yes |
| finance tab: closing | tab | 50 | 37 | 34 | 35 | 37 | 50 | 4/4 | 16 (149) | 44 | 0 | none | yes |
| /orders | nav link | 464 | 95 | 69 | 303 | 260 | 35 | 1/1 | 2 (7) | 10 | 0 | 400 /api/orders | yes |
| /delivery | nav link | 455 | 39 | 56 | 291 | 288 | 37 | 3/0 | 9 (171) | 35 | 0 | none | yes |
| /dashboard | nav link | 119 | 57 | 52 | 443 | 494 | 32 | 0/0 | 0 (0) | 20 | 0 | none | yes |
| /offline | typed URL | 275 | n/a | 226 | 192 | 229 | — | 0/— | 0 (0) | 0 | 0 | none | yes |
| /staff | typed URL | 519 | n/a | 528 | 451 | 430 | — | 1/— | 16 (194) | 47 | 0 | none | yes |
| /kitchen | typed URL | 316 | n/a | 242 | 209 | 314 | — | 2/— | 4 (41) | 18 | 0 | 400 /api/orders | yes |
| /tiffin | typed URL | 248 | n/a | 270 | 277 | 360 | — | 2/— | 4 (27) | 23 | 0 | 400 /api/orders | yes |

In-app navigation, time to usable content — first visits: n=6, p50 300 ms, p95 528 ms, worst 528 ms; return: n=6, p50 55 ms, p95 95 ms, worst 95 ms; after inactivity (1/5/15 min): n=18, p50 222 ms, p95 494 ms, worst 494 ms. Click feedback over all link/tab clicks: n=45, p50 26 ms, p95 40 ms, worst 50 ms. Console errors: Failed to load resource: the server responded with a status of 400 (Bad Request) | WebSocket connection to 'ws://localhost:3003/_next/webpack-hmr' failed: Page entered Back-Forward Cache.. Horizontal overflow at the end: -6 px.

#### Delivery (390×844 mobile)

Login: page interactive 975 ms · password → code field 638 ms (login API 567 ms, 8 queries) · OTP submit → URL 500 ms → usable 696 ms → settled 1485 ms (verify API 121 ms; 24 queries, 0 new connections).

| Page | How | First | Return | After 1 min | After 5 min | After 15 min | Click feedback (max) | API (first/return) | DB queries first (ms) | Max query ms | New conns | Failed requests | Correct page |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| /offline | nav link | 208 | 48 | 52 | 74 | 197 | 27 | 0/0 | 0 (0) | 24 | 0 | 401 /api/notifications, 401 /api/delivery/tasks, 401 /api/delivery/handover | yes |
| /delivery | nav link | 18 | 21 | 17 | 237 | timeout | 126 | 0/0 | 0 (0) | 9 | 0 | none | NO |
| /dashboard | typed URL | 408 | n/a | 466 | 477 | — | — | 3/— | 10 (86) | 15 | 0 | none | NO |
| /rooms | typed URL | 352 | n/a | 422 | 453 | — | — | 3/— | 10 (77) | 26 | 0 | none | NO |
| /finance | typed URL | 516 | n/a | 538 | 540 | — | — | 3/— | 10 (87) | 17 | 0 | none | NO |
| /staff | typed URL | 486 | n/a | 474 | 417 | — | — | 3/— | 14 (127) | 21 | 0 | none | NO |

In-app navigation, time to usable content — first visits: n=2, p50 18 ms, p95 208 ms, worst 208 ms; return: n=2, p50 21 ms, p95 48 ms, worst 48 ms; after inactivity (1/5/15 min): n=5, p50 74 ms, p95 237 ms, worst 237 ms. Click feedback over all link/tab clicks: n=9, p50 23 ms, p95 126 ms, worst 126 ms. Console errors: WebSocket connection to 'ws://localhost:3003/_next/webpack-hmr' failed: Page entered Back-Forward Cache. | Failed to load resource: the server responded with a status of 401 (Unauthorized). Horizontal overflow at the end: 0 px.


**Delivery after 15 min — invalid.** At 11:18 IST, during that idle window, someone signed in to the `zevats_delivery` account from another browser. The single-session policy then ended the test session, so every request after the 15-minute idle returned 401 and the page ended on /login. This is the policy working as designed, not a defect. Excluding that phase, all 20 Delivery measurements landed on the correct page, and there were no failed requests. The 401s in the `/offline` row and the "NO" in the "Correct page" column come only from that phase.

**Reading the numbers**

- **Click feedback** (progress bar and active item) appears within 6–50 ms, p50 26 ms, on every click.
- **Return visits** are usable in 21–95 ms with **0 API calls and 0 DB queries**. The exceptions:
  - Finance › Daily Closing is always reloaded, by design: the reconciliation must be fresh.
  - `/orders` refetches because its request fails on this database (ISSUE-039).
- **After 5 and 15 minutes away**, in-app visits take 205–305 ms, and the dashboard 443–494 ms. The 2-minute router cache has expired by then, so a server round trip is needed, and data past its TTL is revalidated. No database connection was reopened in any phase (`New conns` 0); the 30-minute pool idle timeout covers these gaps.
- **First visits on a warmed server** take 270–528 ms. Of that, the database accounts for 7–171 ms. The rest is `next dev` request overhead, plus the dev-only partial-then-full page fetch (ISSUE-049).
- **Typed URLs and bookmarks** are full document loads in dev: 248–540 ms, including redirects. Kitchen and Tiffin now redirect in middleware.
- **Sign-in:** the login page is interactive in about 1.0 s. OTP submit to a usable dashboard takes 0.70–0.87 s. The OTP verify API takes 121–246 ms, of which 36–60 ms is server work.
- **Sign-out:** feedback in 22 ms, server revocation in 183 ms, login form usable in 0.90 s (VL-41).

**Targets not met, and why**

- **Uncached first visit to Finance (528 ms) and post-idle Dashboard (494 ms)** sit at the edge of the 500 ms target in dev. The cost is development-mode request overhead (about 70–100 ms per API) and the dev-only double page fetch, not the database. A production build measured 89–172 ms in the sandbox (VL-28).
- **Full document loads (login, sign-out, typed URLs)** take 0.25–1.0 s because `next dev` serves unbundled JavaScript.
- **Warm-up after a server start** takes about 4 minutes (112 routes). During that window, a request can wait behind a compile (ISSUE-062).

## Data volume (VL-45)

These read paths were measured on a disposable copy grown to 50,001 ledger rows and 30,004 delivery tasks:

| Read path | p50 | Worst | Queries |
|---|---|---|---|
| Notifications feed | 21 ms | 180 ms | 7 |
| Dashboard metrics | 63 ms | 132 ms | 12 |
| Finance transactions (month) | 73 ms | 368 ms | 1 |
| Cashbook summary (month) | 12 ms | 20 ms | 3 |
| Residents | 6 ms | 20 ms | 1 |
| Rooms | 6 ms | 10 ms | 2 |
| Delivery tasks (day) | 26 ms | 45 ms | 2 |
| Fleet custody (day) | 17 ms | 24 ms | 4 |

The hot filters are already indexed, so no index was added. The dashboard's monthly aggregate (57 ms) scans the ledger; it is the first query to watch as data grows.
