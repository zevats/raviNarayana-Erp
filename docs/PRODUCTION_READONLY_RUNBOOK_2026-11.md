# Production read-only checks before migrations 0016–0021

For: the owner, run by hand. Nothing here writes to production. Never paste a connection string, password or query output that contains one into a chat, ticket or file in the repository.

**Before you start:**
- You need this repository on your computer, and Node.js (`psql` is not needed).
- Do every step in **your own** PowerShell window, not in a session shared with an assistant.
- Allow about 20 minutes.

---

## 1. Get the direct connection string (and keep it to yourself)

1. In the Neon Console, open the ERP project and click **Connect**.
2. In **Connect to your branch**, choose the production branch, compute, database and role.
3. Turn **Connection pooling** **off**. The host must **not** contain `-pooler`; the checker refuses pooled strings.
4. Copy the string and load it without displaying it, in your own PowerShell window at the repository root:

```powershell
$env:PROD_DB_URL = (Get-Clipboard).Trim()
Set-Clipboard -Value " "
$env:PROD_DB_URL = $env:PROD_DB_URL -replace '([?&])channel_binding=[^&]*&?', '$1' -replace '[?&]$', ''
```

The last line removes `channel_binding=require`. The database driver cannot pass that option on, and the scan would otherwise fail with exit 1. `sslmode=require` stays, so TLS is still enforced. `scripts/prod-readonly-checks.js` removes it by itself.

When you finish: `Remove-Item Env:PROD_DB_URL`. `psql` is **not** needed.

---

## 2. Duplicate invoice scan (gate for migration 0020)

```powershell
node scripts/scan-invoice-duplicates.js $env:PROD_DB_URL
"exit code: $LASTEXITCODE"
```

The scan runs in one read-only transaction and never prints the URL, user, password or host.

| Exit code | Last line starts with | Meaning |
|---|---|---|
| 0 | `RESULT: NO DUPLICATES - scanned N … completely` | Migration 0020 can be applied |
| 2 | `RESULT: DUPLICATES FOUND - G group(s), S subscription(s), I invoice(s)` | **Blocks approval.** A person checks each group's payments and cancels the wrong invoice in the ERP, then reruns the scan. Nothing is resolved automatically |
| 1 | `RESULT: SCAN FAILED - …` | **Unknown, not clean.** Fix the cause and rerun |

---

## 3. The read-only checks Q0–Q5

```powershell
node scripts/prod-readonly-checks.js
"exit code: $LASTEXITCODE"
```

The queries are in `scripts/prod-readonly-checks.sql`. You can also paste them into **Neon Console → SQL Editor** after deleting the lines that start with `\`.

How the checker stays read-only:
- Everything runs in one `READ ONLY` transaction, which is always rolled back.
- Nothing runs unless the database reports `transaction_read_only = on`. A write is refused by the database (tested).

What the output contains:
- Counts, internal ids, dates and amounts.
- Phone numbers as the last four digits only.
- No names or addresses.

It ends with `GATE` lines and `RESULT: CHECKS COMPLETE` (exit 0). `RESULT: CHECKS FAILED` (exit 1) means no conclusion can be drawn.

| Check | PASS when | Blocks release |
|---|---|---|
| **Q1** migration level | The newest record is 0015 (`1792471200000`, hash starting `0f0652008797519f`); the schema of every migration 0000–0015 is present (Q1e all true); no record matches no journal entry; none of the 0016–0021 objects exist. The record count is reported, not gated: the Neon history applied some early migrations by hand without a record, and Drizzle reads only the newest record. Production on 2026-11-05: 15 records | A missing 0000–0015 schema object, an unknown record, a newer record, or any 0016–0021 object. Never insert a missing record by hand |
| **Q2** shared phones | 0 | No. REVIEW lists masked numbers and customer ids. Records are never merged |
| **Q3** delivered work outside Receivables | 0 orders not marked completed, 0 tasks without an order, 0 unexplained collection differences | Unexplained differences > 0. Amounts owed are computed with the Receivables rule, which excludes reversed UPI |
| **Q4** orders without a customer | None with money owed | No. Each becomes its own account in Receivables, without Pay Later |
| **Q5** sizes | Always REVIEW: row counts and sizes of `invoices`, `orders`, `tiffin_customers`, `resident_stays`, `delivery_collections`, `staff_users`, `rooms`, `residents`, and the number of beds 0017 will create | No; it sizes the quiet window (§4) |

---

## 4. Lock impact

The migration batch locks tables until it commits:
- **Locked against all reads and writes:** `invoices`, `orders`, `tiffin_customers`, `resident_stays`, plus the new tables.
- **Readable but not writable:** `delivery_collections`, plus `staff_users`, `rooms` and `residents` (new foreign keys point at them).

While the batch runs, the **old** version keeps serving. Requests that touch those tables wait rather than fail.

**Measured on a local copy:**

| Data | Time |
|---|---|
| 30,000 orders, 3,000 invoices, 22,500 collections (0020 + 0021) | 6.4–7.8 s |
| Small database (0016–0021) | 1.6 s |

Neon adds network time for about 54 statements (typically under 2 s more).

| Q5 result | Expected wait |
|---|---|
| Under 5,000 orders and 1,000 invoices | A few seconds |
| Up to 30,000 orders | Under ~10 s |
| Much larger | Plan a quiet window and tell staff not to record payments for a few minutes |

There is no lock timeout. If someone runs a long report while the migration starts, the migration waits for it.

---

## 5. Restore point (do this immediately before the deploy, not now)

1. **History window:** Neon Console → project settings → check that the history (restore) window covers at least the next 24 hours.
2. **Restore branch:** **Branches** → **New branch** → parent `main`, from **Current point in time** (head) → name it `pre-release-0016-0021`. Creating a branch does not change `main`.
3. **Note the time:** write down the UTC time shown for that branch.
4. **Verify it:**
   - **Branches** lists `pre-release-0016-0021` with parent `main` and that time.
   - Optionally connect to the **branch** (Connect → choose that branch; pooling off) and run Q1: it must show the same values as `main`.
5. **Afterwards:** delete the branch only after the release has been confirmed for a few days. It may count towards storage or compute.

To undo after a bad release, restore `main` with **Backup & Restore → Restore from history** to the noted time. This also removes **everything** written after that time, so it is a last resort; the normal recovery is a code rollback (§7).

---

## 6. Render settings to read (Dashboard → the ERP web service)

Read only; change nothing. Note these values:

| Setting | Where | Expected |
|---|---|---|
| Start Command | Settings | `npm run render:start` (runs `node scripts/migrate-production.js && npm run start:render`) |
| Build Command | Settings | `npm install …` and `npm run build:erp` (or similar) |
| Pre-Deploy Command | Settings | Empty (migrations run in the start command) |
| Health Check Path | Settings | `/api/health`, or empty |
| `ERP_PRODUCTION_MIGRATE` | Environment | `apply` means **deploying applies the migrations** |
| `DIRECT_URL` | Environment | Present (the migrator prefers it). Do not copy its value anywhere |
| Disks | Disks | **None expected.** A persistent disk turns off zero-downtime deploys |
| Instances | Settings / Scaling | Number of instances |
| Last deploy log | Events → latest deploy → Logs | The line `[migrate-production] Migrations: X before, 15 now` (production has 15 records; see Q1) |

---

## 7. What blocks approval

| Result | Blocks |
|---|---|
| Scan exit 2 (duplicates) | 0020 and the release, until each group is resolved and the scan returns exit 0 |
| Scan exit 1 (failed or incomplete) | Everything: no decision without a complete scan |
| Q1 GATE not PASS | The release, until the actual level is understood (the plan assumes 0016–0021 are pending) |
| No restore branch created, or history window under 24 h | The deploy |
| `ERP_PRODUCTION_MIGRATE` is not `apply` | The deploy as planned. The new code needs at least 0019, so it must not start against a 0015 database |
| A persistent disk is attached | The zero-downtime assumption. The deploy then has downtime; plan a window |
| Q5 far above 30,000 orders | Not a blocker; plan a longer quiet window |
| Q2, Q3, Q4 non-zero | Not blockers; follow-ups after release |

---

## Appendix: if Q3 is not zero

Q3a already gives the amount owed using the Receivables rule (reversed UPI collections do not count) next to the figure that would count them. Send both numbers and the order counts; the correction is then designed and tested on disposable data before any change.
