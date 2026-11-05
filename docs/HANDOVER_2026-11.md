# Ravinarayana ERP: handover (release P0–P2, November 2026)

For: the owner. Deployment-specific facts that only exist after the release are marked **(fill in at release)**.

## 1. What is where

| Item | Value |
|---|---|
| ERP code | This repository, `apps/erp` (Next.js 14, PostgreSQL on Neon) |
| ERP hosting | Render web service; deploys branch `master` (repository evidence and memory; confirm in the dashboard). Start: `npm run render:start` = `node scripts/migrate-production.js && npm run start:render` |
| ERP URL | **(fill in at release)**. `erp.ravinarayan.in` does not resolve from here (checked 2026-11-05), so the Render URL is the live address |
| Production commit | `a3a3ccc` today; release candidate on branch `release/erp-p0-p2-2026-11` **(fill in the merge commit at release)** |
| Database | Neon PostgreSQL. 2026-11-05: 15 migration records, newest 0015 (missing record 0002 with its schema present; expected, never insert by hand). The release applies 0016–0021: log `Migrations: 15 before, 21 now` |
| Android app | `mobile/` (Capacitor shell). It loads the hosted ERP, so no rebuild is needed for this release. Unchanged since production |
| Public website | `apps/website` in this repository, never deployed with the ERP. `https://ravinarayan.in` is served by nginx and its page title differs from this repository's website, so the live site is not (or not the current version of) `apps/website`. Owner to confirm the host |

## 2. Roles

| Role | Can |
|---|---|
| Owner (`SUPER_ADMIN`) | Everything. Deposit decisions, reversals, invoice allocation, direct tiffin payments, settings, staff |
| Manager (`OPERATIONS_MANAGER`) | Day-to-day operations:<br>• residents, rooms and beds<br>• rent and tiffin billing<br>• orders and delivery<br>• Pay Later approval<br>• Receive payment (Receivables)<br>• cash handover acceptance<br>• checkout settlement proposals |
| Accountant (`ACCOUNTANT`) | Finance views as configured |
| Delivery staff (`DELIVERY_PERSON`) | Their own stops: deliver, Cash / UPI / Pay Later (only for approved customers), offline queue, cash declaration |

## 3. Money workflows (how to use them)

- **Rent:**
  - the monthly rent run charges each active stay, prorated by days;
  - record payments on the resident;
  - reversals keep the original and add a dated reversal.
- **Tiffin:**
  - monthly billing creates one invoice per subscription and month (the database enforces this from 0020);
  - payments are allocated to invoices;
  - unallocated money shows as credit.
- **Orders and delivery:**
  - the driver records what was collected at the door (Cash / UPI) or chooses Pay Later;
  - an unapproved remainder is accepted and flagged for a Manager review;
  - cash goes into the collector's custody until the handover is accepted.
- **Finance → Receivables:**
  - one list of everything owed (PG, Tiffin, Delivery), with ageing and statements;
  - **Receive payment** records each part through its own module;
  - a retry never records twice, and a changed retry is refused.
- **Pay Later:** Tiffin → customer → Pay Later panel (Owner / Manager; audited; off by default).
- **Cashbook:** refunds of earlier receipts show on their own line; the net can be negative.

## 4. Configuration (names only; values live in Render, never in Git)

`DATABASE_URL`, `DIRECT_URL` (direct Neon string, used by the migrator), `ERP_PRODUCTION_MIGRATE=apply`, `JWT_SECRET`, `SESSION_SECRET`, `NEXTAUTH_SECRET`, `NEXTAUTH_URL`, `ERP_APP_URL`, `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_ERP_DOMAIN`, `EMAIL_ADAPTER`, `EMAIL_FROM`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_APP_PASSWORD`, `TRUST_PROXY_HEADERS`, `NODE_ENV`, `PORT`.

One-time variables: `ERP_ADMIN_*` (first Owner only; remove `ERP_ADMIN_PASSWORD` after the first start).

`ERP_RESET_ALL_DATA` is ignored and must not be set.

## 5. Backup and recovery

- **Before every release with migrations:**
  - create a Neon branch from `main` (e.g. `pre-release-0016-0021`);
  - record its UTC time;
  - run `node scripts/prod-readonly-checks.js` against it.
- **Failed migration:** the batch is one transaction and rolls back, and Render keeps the previous deploy serving. Fix the cause and redeploy. Never edit migration records by hand.
- **Bad code after a release:** redeploy the previous commit. The previous code works on the new schema (tested).
- **Last resort:** Neon **Backup & Restore → Restore from history** to the recorded time. This discards everything written after it.

## 6. Monitoring

- **Render:**
  - **Events:** each deploy shows the `[migrate-production]` line;
  - **Logs:** errors;
  - **health check:** `GET /api/health` (database ping; 200 = healthy).
- **Neon:** compute status, storage, history window.
- **Before migrations:** `node scripts/scan-invoice-duplicates.js` (exit 0/2/1) and `node scripts/prod-readonly-checks.js` (GATE lines). Steps: [PRODUCTION_READONLY_RUNBOOK_2026-11.md](PRODUCTION_READONLY_RUNBOOK_2026-11.md).

## 7. Known limitations and deferred work

- **Receive payment dates:** order payments entered in Receive payment are dated on the day entered.
- **Driver app:** no driver screen for collecting a balance later; the office collects in Receivables.
- **Cash corrections:** individual cash-collection reversal and cash-handover correction need a future migration and workflow.
- **D10–D14:** open business decisions; existing behaviour is kept:
  - rent invoice uniqueness;
  - order numbering;
  - new PG charge types;
  - package pause;
  - overdue rules.
- **Kitchen:** dormant (`/kitchen` redirects).
- **Global loading redesign (P3):** not started.
- **Lint:** no ESLint configuration in the ERP (typecheck is used instead).

## 8. Acceptance checklist

See [RELEASE_STATUS_2026-11.md](RELEASE_STATUS_2026-11.md#owner-acceptance-checklist-after-deployment).
