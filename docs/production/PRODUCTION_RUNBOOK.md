# Ravinarayan ERP — Production Operations & Disaster Recovery Runbook

**Target Infrastructure:** Managed Cloud Platform (Render / AWS ECS / Fly.io / VPS)  
**Primary Database:** Managed PostgreSQL (v15+) with PgBouncer  
**Edge / CDN:** Cloudflare (Strict SSL & DDoS Shield)  
**Owner / Escalation:** Dr. Ravinder Gulia (Super Administrator)  

---

## 1. Environment Topology & Separation

```text
┌────────────────────────┐      ┌────────────────────────┐      ┌────────────────────────┐
│      Development       │      │        Staging         │      │       Production       │
├────────────────────────┤      ├────────────────────────┤      ├────────────────────────┤
│ • Local workstations   │      │ • Isolated cloud node  │      │ • High-availability    │
│ • SQLite data/erp.db   │      │ • Staging PostgreSQL   │      │ • Managed PostgreSQL   │
│ • Synthetic demo data  │      │ • Sanitized seed data  │      │ • Zero demo data       │
│ • Port 3000 / 3001     │      │ • staging-erp.ravinarayan│    │ • erp.ravinarayan.in   │
└────────────────────────┘      └────────────────────────┘      └────────────────────────┘
```

### Environment Isolation Rules
1. **Zero Production Cross-Talk:** Development and staging instances must never connect to the production PostgreSQL cluster.
2. **Prohibition of Synthetic Data in Production:** `ALLOW_SYNTHETIC_SEED` is strictly prohibited in production. Startup must immediately abort if `NODE_ENV === 'production'` and synthetic data execution is attempted.
3. **Dedicated Connection Credentials:** Staging and production use separate database users with isolated connection strings and database names (`ravinarayan_staging` vs `ravinarayan_production`).

---

## 2. Environment Variables & Secret Management

> [!IMPORTANT]
> Never commit `.env` or `.env.production` files to version control. Inject environment variables securely via cloud provider secret managers or CI/CD vault variables.

### Production Environment Variables Reference

| Variable Name | Required | Default / Format | Description & Policy |
| :--- | :---: | :--- | :--- |
| `NODE_ENV` | **Yes** | `production` | Enforces production runtime guards and strict cookie security. |
| `DATABASE_URL` | **Yes** | `postgresql://user:pass@host:6543/db?sslmode=require` | Pooled connection string to PgBouncer. |
| `DIRECT_URL` | **Yes** | `postgresql://user:pass@host:5432/db?sslmode=require` | Direct database connection string used for schema migrations. |
| `TRUST_PROXY_HEADERS` | **Yes** | `true` | Enables edge proxy header parsing (`CF-Connecting-IP`, `X-Forwarded-For`). |
| `ERP_ADMIN_USERNAME` | **Yes** | `admin` | Super Admin login identifier. |
| `ERP_ADMIN_EMAIL` | **Yes** | `admin@ravinarayan.in` | Super Admin email address. |
| `ERP_ADMIN_PASSWORD` | **Yes** | `<secret-min-12-chars>` | Master administrator password (must be $\ge 12$ chars, cannot be demo password). |
| `ERP_ADMIN_NAME` | **Yes** | `"Dr. Ravinder Gulia"` | Display name for property owner. |
| `NEXT_PUBLIC_APP_URL` | **Yes** | `https://ravinarayan.in` | Canonical URL of public showcase website. |
| `NEXT_PUBLIC_ERP_DOMAIN`| **Yes**| `erp.ravinarayan.in` | Canonical domain of operations ERP portal. |

---

## 3. Database Migration Execution Procedure

Database migrations must execute as an isolated, pre-deployment release step prior to starting the application process.

### Step-by-Step Release Command
```bash
# 1. Apply version-controlled PostgreSQL schema migrations via direct connection
npx drizzle-kit migrate:pg

# 2. Start Next.js production server binding to assigned PORT
npx next start apps/erp -p ${PORT:-3001}
```

### Safety Rules During Migration
1. **Transaction Wrapping:** All DDL migrations execute inside transactions (`BEGIN ... COMMIT`). If a migration fails halfway, PostgreSQL rolls back changes automatically.
2. **Backward-Compatible Schema Changes:** Never drop columns or rename active columns in a single deploy. Use the expand-contract pattern:
   - *Phase A:* Add new column/table, deploy code that writes to both old and new.
   - *Phase B:* Backfill historical records.
   - *Phase C:* Deploy code that reads only from new column.
   - *Phase D:* Drop deprecated column in subsequent release.

---

## 4. Automated Backup & Point-in-Time Recovery (PITR)

### 4.1 Automated Backup Schedule
- **Daily Full Snapshot:** Executed automatically at 02:00 AM IST (20:30 UTC) during lowest operational activity.
- **Write-Ahead Log (WAL) Archiving:** Managed PostgreSQL provider archives continuous WAL segments every 5 minutes.
- **Retention Period:** 30 days of continuous point-in-time recovery.
- **Off-Site Replication:** Automated encrypted replication to an independent cloud storage bucket (AWS S3 or Cloudflare R2).

### 4.2 Disaster Recovery Drill (Monthly Exercise)
To test and verify backup integrity:
1. Restore the most recent automated snapshot into an isolated test database (`ravinarayan_dr_test`).
2. Run database integrity validation script:
   ```bash
   node scratch/verify_restored_database.mjs
   ```
3. Assert that:
   - `SELECT COUNT(*) FROM staff_users` matches production count.
   - `SELECT COUNT(*) FROM financial_transactions` matches production count.
   - Sum of active rent balances (`SELECT SUM(amount) FROM financial_transactions WHERE transaction_type = 'RENT_PAYMENT'`) matches expected ledger balance.
4. Tear down the test database after recording audit verification.

---

## 5. Health Checks & Uptime Monitoring

### 5.1 Endpoint Specification: `GET /api/health`
A dedicated lightweight health probe that executes a sub-second database query:

```typescript
// Proposed apps/erp/src/app/api/health/route.ts
import { NextResponse } from "next/server";
import { getDb } from "@/server/database/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const startTime = Date.now();
  try {
    const db = getDb();
    // Execute fast roundtrip probe
    db.prepare("SELECT 1 as alive").get();
    const duration = Date.now() - startTime;

    return NextResponse.json({
      status: "healthy",
      timestamp: new Date().toISOString(),
      databaseLatencyMs: duration,
      version: process.env.npm_package_version || "1.0.0",
    }, { status: 200 });
  } catch (error) {
    return NextResponse.json({
      status: "unhealthy",
      error: error instanceof Error ? error.message : "Database connection failure",
      timestamp: new Date().toISOString(),
    }, { status: 503 });
  }
}
```

### 5.2 External Uptime Monitoring
Configure an external monitoring service (Better Uptime, UptimeRobot, or Pingdom):
- **URL:** `https://erp.ravinarayan.in/api/health`
- **Interval:** Every 60 seconds.
- **Timeout:** 5 seconds.
- **Alert Channel:** Immediate SMS / WhatsApp / Email alert to Dr. Ravinder Gulia if the probe fails 2 consecutive checks.

---

## 6. Incident Response & Emergency Procedures

### Scenario A: Suspected Compromised Staff Account
1. Log into ERP as Super Admin.
2. Immediately deactivate the compromised user account:
   ```sql
   UPDATE staff_users SET is_active = FALSE, updated_at = CURRENT_TIMESTAMP WHERE username = 'compromised_user';
   ```
3. Invalidate all active sessions for the user:
   ```sql
   DELETE FROM sessions WHERE staff_id = (SELECT id FROM staff_users WHERE username = 'compromised_user');
   ```
4. Review `audit_logs` where `actor_username = 'compromised_user'` within the last 48 hours to inspect unauthorized mutations.

### Scenario B: Database Outage or Network Disconnection
1. **Immediate Action:** The application returns HTTP 503 on health check; alerting fires.
2. **Failover:** If primary database node fails, managed PostgreSQL automatically promotes standby replica within 60–120 seconds.
3. **Application Reconnection:** The application connection pool automatically retries dropped connections with exponential backoff.
4. **Post-Mortem:** Review provider connection metrics and PgBouncer pool utilization.

### Scenario C: Emergency Application Rollback
If a newly deployed ERP version introduces unexpected errors:
1. Trigger instant rollback in cloud dashboard (Render / AWS ECS) to the previous known good Docker image / deployment artifact.
2. Do not rollback database schema unless the new schema broke backward compatibility.
3. Test `/api/health` and verify application operational status.
