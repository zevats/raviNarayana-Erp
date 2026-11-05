# Release status: ERP P0–P2 (2026-11-05)

## Where things stand

| Stage | Status |
|---|---|
| Implemented | Yes: P0 fixes, migrations 0016–0021, Pay Later, Receivables, statements, Receive payment, Cashbook refund lines, production gate tooling |
| Automated-tested | Yes, on disposable databases. Last full run: 64 suites, 61 passed, 0 failed, 3 skipped by design (live resources). After the gate tooling was added, the targeted suites ran: production checks 12/0, duplicate scan 13/0 |
| Manually verified (browser) | Offline 6/6, layout 58/58 at 360–1440 px, P2 workflow 21/1. The one failure is a test defect: the Cashbook refund check expects ₹5,000 on a persistent database where repeated runs correctly add up refunds. Not yet fixed |
| Built | ERP production build passes in the sandbox (existing `emailAdapter` warning only). Website: unchanged since `52dad00`, not rebuilt |
| Lint | Not available: the ERP has no ESLint configuration (`next lint` would ask to create one). Typecheck: 0 errors |
| Committed | `5f77d56` on branch `release/erp-p0-p2-2026-11` |
| Pushed | Release branch only. **`master` (production) is unchanged at `a3a3ccc`** |
| Deployed | **No** |
| Production-verified | **No** |

Not committed:
- `scratch/test-full-auth-flow.js`: real credentials, now in `.gitignore`. It was never committed, so there is no Git exposure.
- `docs/performance-evidence-2026-11/`: 6 MB of screenshots.

## Release gate (all must pass before `master` is updated)

| Check | Result |
|---|---|
| Duplicate invoice scan | PENDING: run `node scripts/scan-invoice-duplicates.js $env:PROD_DB_URL`; needs exit 0 |
| Production checks Q0–Q5 | PENDING: run `node scripts/prod-readonly-checks.js`; Q1 must be PASS (16 / 1792471200000 / 0f0652008797519f); Q3 unexplained differences must be 0 |
| Render configuration | PENDING: runbook §6 (start command `npm run render:start`, `ERP_PRODUCTION_MIGRATE=apply`, no disk, Auto-Deploy state, branch) |
| Neon restore branch `pre-release-0016-0021` | PENDING: create immediately before release |
| Migrations 0016–0021 | PENDING: rehearsed on disposable data (one transaction, full rollback on failure, retry safe, old code works on the new schema) |
| Website | PENDING: deployment target is not in the repository; owner to confirm its URL and host |
| Production deployment | PENDING |

Steps: [PRODUCTION_READONLY_RUNBOOK_2026-11.md](PRODUCTION_READONLY_RUNBOOK_2026-11.md).

## Release procedure (after every gate passes)

1. Create the Neon restore branch and record its UTC time.
2. In a quiet window, merge `release/erp-p0-p2-2026-11` into `master` and push. With Auto-Deploy on, the push itself deploys and migrates.
3. Watch the Render log for:
   - `[migrate-production] Migrations: 16 before, 22 now (6 applied)`;
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
