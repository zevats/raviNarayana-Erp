# Release status: ERP P0–P2 (2026-11-05)

## Where things stand (updated 2026-11-05, after the production checks)

| Stage | Status |
|---|---|
| Implemented | Yes: P0 fixes, migrations 0016–0021, Pay Later, Receivables, statements, Receive payment, Cashbook refund lines, production gate tooling |
| Automated tests | Final candidate: **65 suites, 62 passed, 0 failed, 3 skipped by design** (live-resource suites: the shared local database and real email). Typecheck: app 0 errors, tests 0 errors |
| Browser tests (disposable data, server serving the working tree) | P2 workflows 22/22 (Cashbook refund check now baseline-relative); states and errors 8/8 (server error + Try again, no-match search, over-amount validation, lost answer → changed retry refused → identical retry); offline 6/6; P2 screens at 360–1440 px 58/58. One intermittent failure seen once under load (driver part-payment field), passed on rerun: kept as a known flaky check |
| Built | ERP production build passes (sandbox; existing `emailAdapter` warning only). Lint: no ESLint configuration exists |
| Committed / pushed | Branch `release/erp-p0-p2-2026-11` only. **`master` (production) unchanged at `a3a3ccc`** |
| Deployed / production-verified | **No** |

Not committed:
- `scratch/test-full-auth-flow.js`: real credentials, now in `.gitignore`. It was never committed, so there is no Git exposure.
- `docs/performance-evidence-2026-11/`: 6 MB of screenshots.

## Release gate

| Check | Result |
|---|---|
| Duplicate invoice scan (production) | **PASS**: exit 0, complete, zero duplicates |
| Q0 read-only | **PASS** |
| Q1 migration level | **PASS**: 15 records, newest 0015 (`1792471200000` / `0f0652008797519f`). Record 0002 is missing but its schema is present; this comes from early hand-applied Neon migrations. Nothing is to be inserted |
| Q2 shared phones | **PASS** |
| Q3 delivered work outside Receivables | **PASS**: 93 delivered tasks, 0 unexplained differences |
| Q4 orders without a customer | **PASS** |
| Q5 sizes | 9 orders, 4 collections, 0 invoices; 0017 creates 56 beds. Locks last about 1–2 s |
| Render configuration | **PENDING**: owner, dashboard (below) |
| Neon restore branch | **PENDING**: owner, immediately before the merge |
| Migrations 0016–0021 | **Ready, pending the two items above** |
| Website | **No release**: `apps/website` has not changed since `52dad00`. The live `ravinarayan.in` is served by nginx with a different page title, so it is not deployed from this repository (owner to confirm the host) |
| Production deployment | **PENDING** |

## Remaining manual actions (owner)

1. **Render** (Dashboard → ERP web service; read only):

   | Where | Check |
   |---|---|
   | Settings → Build & Deploy | Branch = `master` |
   | Settings → Build & Deploy | Start Command = `npm run render:start` (or `node scripts/migrate-production.js && npm run start:render`) |
   | Settings → Build & Deploy | Pre-Deploy Command empty |
   | Settings → Build & Deploy | Auto-Deploy On or Off (On: the merge push deploys) |
   | Settings | Health Check Path = `/api/health`, or empty |
   | Disks | None |
   | Environment | Names `DATABASE_URL`, `DIRECT_URL`, `ERP_PRODUCTION_MIGRATE` (value `apply`) present; don't open other values |
   | Events | Latest deploy is `a3a3ccc` and Live |

   Also note the service's public URL.
2. **Neon:**
   - Project → Branches → create a branch from `main` at the current point, named `pre-release-0016-0021`;
   - note its UTC time;
   - optionally run `node scripts/prod-readonly-checks.js` against the branch's direct string (Q1 must match `main`).
3. **Website:** tell us where `ravinarayan.in` is hosted and whether this repository's `apps/website` should replace it (a separate decision and release).
4. **Release** (quiet time, after 1 and 2):
   1. Merge `release/erp-p0-p2-2026-11` into `master` and push. With Auto-Deploy on this deploys; otherwise click **Manual Deploy** for that commit.
   2. Watch the Render log for `[migrate-production] Migrations: 15 before, 21 now (6 applied)`, then Live.
   3. Check `/api/health` returns 200.
   4. Run the acceptance checklist below.
5. **Driver app:** test it on a phone after release. Delivery files other than the approved payment changes were also changed by the earlier P0 and performance rounds (custody panel, history, manager board). Automated delivery suites and offline tests pass.

## Release procedure (after every gate passes)

1. Create the Neon restore branch and record its UTC time.
2. In a quiet window, merge `release/erp-p0-p2-2026-11` into `master` and push. With Auto-Deploy on, the push itself deploys and migrates.
3. Watch the Render log for:
   - `[migrate-production] Migrations: 15 before, 21 now (6 applied)`;
   - the service going Live;
   - `/api/health` returning 200.
4. If the migration fails:
   - the transaction rolls back and the old version keeps serving;
   - capture the error and do not push again blindly;
   - do not restore Neon unless data is actually damaged.

## Known limitations

- **Receive payment dates:** order payments taken there are dated on the day entered.
- **Driver app:** no driver screen for collecting a balance later.
- **Cash corrections:** no individual cash-collection reversal and no cash handover correction; both need a separate migration and workflow.
- **D10–D14:** open business decisions; existing behaviour is kept.
- **P3:** the global loading redesign is deferred.
- **Older orders:** delivered orders not marked completed would be missing from Receivables. Production Q3 decides whether this matters (expected 0 on the fresh Neon database).

## Owner acceptance checklist (after deployment)

Use real accounts with care; do not create fake financial transactions.

- [ ] Sign in (OTP) as Owner and as Manager; the dashboard loads.
- [ ] Rooms and residents: beds are listed per room; existing residents are unchanged.
- [ ] Finance → Cashbook totals match the day before the release.
- [ ] Finance → Receivables:
  - [ ] totals per PG / Tiffin / Delivery look right;
  - [ ] open one account and its statement.
- [ ] Tiffin → a customer profile shows the Pay Later panel (off by default).
- [ ] Orders and Delivery:
  - [ ] today's board loads;
  - [ ] the driver phone shows Cash / UPI / Pay Later;
  - [ ] Pay Later stays disabled for customers who are not approved.
- [ ] Notifications open; there are no error banners.
- [ ] The Android app opens the live site and signs in.
