# Ravinarayan PG & Tiffin ERP — Authoritative Security Audit & Threat Model

**Document Reference:** `docs/SECURITY_AUDIT.md`  
**Status:** Canonical Security Baseline (Phase 00)  
**Date of Audit:** 16 October 2026  
**Auditor:** Antigravity Engineering (Senior Security Architect)  
**Standard:** OWASP Top 10 (2021), CIS Benchmarks, NIST SP 800-63B (Digital Identity)  

---

## 1. Executive Summary & Security Posture

An extensive, non-destructive security evaluation of the Ravinarayan ERP and public website repository was conducted on 16 October 2026.

### Verified Strengths
- **Cryptographic Password Storage:** Passwords hashed with `bcryptjs` using 12 salt rounds.
- **Timing-Safe Login:** Constant-time dummy hash verification prevents timing-based username enumeration.
- **Session Tokens Hashed at Rest:** Raw session tokens (256-bit entropy) are never stored; only one-way SHA-256 digests exist in the database.
- **3-Layer Rate Limiting:** Enforces IP limits, Account+IP limits, and progressive distributed throttling without locking out legitimate administrators.
- **Tamper-Evident Audit Logging:** Centralized audit logs automatically sanitize sensitive keys matching `/password|token|secret/i`.
- **SQL Injection Immunity:** All database queries utilize parameterized prepared statements. Zero dynamic SQL string concatenation of user inputs.
- **Formula Injection Defense:** CSV exports escape formula prefixes (`=`, `+`, `-`, `@`, `\t`, `\r`) with single quotes.

### Production Vulnerabilities & Actionable Risks
1. **Critical:** Ephemeral SQLite storage on cloud containers risks catastrophic data loss (`SEC-01`).
2. **Critical:** Binary SQLite test databases actively committed to Git repository (`SEC-02`).
3. **High:** Complete absence of HTTP security headers (CSP, HSTS, X-Frame-Options) in Next.js config (`SEC-03`).
4. **High:** Email OTP during login and self-service password recovery not yet implemented (`SEC-04`).
5. **High:** Single active session per account across web and mobile not yet strictly enforced (`SEC-05`).
6. **Medium:** Absence of explicit CSRF defense on mutating REST API routes (`SEC-06`).
7. **Medium:** Document attachments (KYC, expense slips) currently lack private storage and malware validation (`SEC-07`).

---

## 2. Threat Analysis & Vulnerability Register

| Vulnerability ID | Vulnerability Title | Severity | Impacted Area | Verification Status | Remediation Phase |
| :---: | :--- | :---: | :--- | :---: | :---: |
| **SEC-01** | Ephemeral SQLite Storage on Cloud Hosts | **Critical** | Database Persistence | **Verified** | Phase 01 |
| **SEC-02** | Binary SQLite Test Databases Committed to Git | **Critical** | Git Repository / Build Artifacts | **Verified** | Phase 01 |
| **SEC-03** | Missing HTTP Security Headers & Content Security Policy | **High** | HTTP Delivery Layer | **Verified** | Phase 01 |
| **SEC-04** | Missing Email OTP Verification & Self-Service Password Reset | **High** | Authentication & Account Recovery | **Verified** | Phase 01 |
| **SEC-05** | Lack of Server-Side Single Active Session Preemption | **High** | Session Management | **Verified** | Phase 01 |
| **SEC-06** | Lack of Explicit CSRF Defense on Mutating REST APIs | **Medium** | API Layer (`apps/erp/src/app/api`) | **Verified** | Phase 01 |
| **SEC-07** | Unprotected KYC & Financial Attachment Ingestion | **Medium** | File Uploads & Document Storage | **Verified** | Phase 06 |
| **SEC-08** | Inherent Multi-Worker Concurrency Race in Room Overbooking | **Critical** | Room Assignment Service | **Verified** | Phase 01 |
| **SEC-09** | Lack of Fractional Minor Unit Currency (Paise) Precision | **Medium** | Financial Ledger & Invoicing | **Verified** | Phase 05 |
| **SEC-10** | Exposure of PII (Resident & Customer Contact Details) | **Medium** | Customer & Resident Data | **Verified** | Phase 02 |

---

## 3. Deep-Dive Findings & Remediation Specifications

### SEC-01: Ephemeral SQLite Storage on Cloud Hosts
- **Severity:** **Critical (P0)**
- **Evidence:** [`apps/erp/src/server/database/db.ts:17-47`](file:///c:/Users/Rishabh/Desktop/raviNarayana-Erp/apps/erp/src/server/database/db.ts#L17-L47). The database path defaults to `data/erp.db` on the local container filesystem.
- **Impact & Abuse Scenario:** In any modern containerized host (Render, Fly.io, Railway, AWS ECS), restarting the container, redeploying, or auto-scaling destroys the ephemeral filesystem. All resident agreements, financial ledgers, customer balances, and audit records vanish permanently.
- **Verification:** Verified via source inspection and build configuration.
- **Remediation:** Migrate persistence to a managed PostgreSQL cluster (Neon / Supabase / AWS RDS) accessed through connection pooling (PgBouncer).
- **Validation Test:** Restart the staging container and assert 100% data retention across all tables.

---

### SEC-02: Binary SQLite Test Databases Committed to Git
- **Severity:** **Critical (P0)**
- **Evidence:** Executing `git ls-files tests` shows:
  ```text
  tests/test_erp.db
  tests/test_erp.db-shm
  tests/test_erp.db-wal
  ```
- **Impact & Abuse Scenario:** Binary database files are permanently tracked in Git history. Anyone cloning the repository obtains internal database structures and potential historical test data. Build pipelines deploying Docker images bundle these database binaries into public image layers.
- **Verification:** Confirmed via Git index query.
- **Remediation:**
  1. Remove files from Git index: `git rm --cached tests/test_erp.db*`.
  2. Update root `.gitignore` from `/data/*.db` to `**/*.db*`.
  3. Reconfigure test harnesses to generate in-memory SQLite instances (`:memory:`) or temporary operating system files that are wiped upon test completion.
- **Validation Test:** Run `git ls-files | grep '\.db'` and verify 0 records returned.

---

### SEC-03: Missing HTTP Security Headers & Content Security Policy (CSP)
- **Severity:** **High (P1)**
- **Evidence:** Neither [`apps/erp/next.config.mjs`](file:///c:/Users/Rishabh/Desktop/raviNarayana-Erp/apps/erp/next.config.mjs) nor [`apps/website/next.config.mjs`](file:///c:/Users/Rishabh/Desktop/raviNarayana-Erp/apps/website/next.config.mjs) implement a `headers()` block.
- **Impact & Abuse Scenario:**
  - Clickjacking: Malicious actors can frame `erp.ravinarayan.in` inside an invisible iframe and trick authenticated staff into performing clicks (UI redress attack).
  - MIME-Confusion: Browsers may execute uploaded files as scripts if MIME-types are misinterpreted.
  - XSS Escalation: Absence of CSP allows injected scripts to execute without restriction.
- **Verification:** Inspected `next.config.mjs` files; confirmed zero security header directives.
- **Remediation:** Implement strict headers in Next.js configuration:
  ```javascript
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
          { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=()" },
          {
            key: "Content-Security-Policy",
            value: "default-src 'self'; script-src 'self' 'unsafe-eval' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; connect-src 'self' https:;",
          },
        ],
      },
    ];
  }
  ```
- **Validation Test:** Execute `curl -I https://erp.ravinarayan.in` and assert presence of all 6 security headers.

---

### SEC-04: Missing Email OTP Verification & Self-Service Password Reset
- **Severity:** **High (P1)**
- **Evidence:** [`apps/erp/src/app/api/auth/login/route.ts`](file:///c:/Users/Rishabh/Desktop/raviNarayana-Erp/apps/erp/src/app/api/auth/login/route.ts) issues session cookies immediately upon password verification without secondary 2FA / OTP verification. No forgot-password or password-reset routes exist in `apps/erp/src/app/api/auth/`.
- **Impact & Abuse Scenario:** If staff credentials are leaked or compromised via credential stuffing, attackers gain immediate administrative access to resident data and financial balances. If staff forget passwords, administrative manual DB intervention is currently required.
- **Verification:** Audited all authentication route handlers.
- **Remediation:**
  1. Add secondary login stage: Generate 6-digit numeric OTP with 10-minute validity and 3-attempt limit; dispatch via transactional email (Resend / AWS SES).
  2. Implement `POST /api/auth/forgot-password` generating a 256-bit cryptographically secure reset token (1-hour validity) with timing-safe email responses.
- **Validation Test:** Automated integration test asserting that login fails without valid OTP and that password reset token invalidates all prior sessions.

---

### SEC-05: Lack of Server-Side Single Active Session Preemption
- **Severity:** **High (P1)**
- **Evidence:** In [`apps/erp/src/server/authentication/auth.ts:265-298`](file:///c:/Users/Rishabh/Desktop/raviNarayana-Erp/apps/erp/src/server/authentication/auth.ts#L265-L298), `createSession` inserts a new row into `sessions` without revoking or deleting existing active sessions for that `staff_id`.
- **Impact & Abuse Scenario:** Multiple concurrent sessions can remain active simultaneously across various browsers, home PCs, and phones. If a session token is retained on an untrusted device, logging in on another device does not kick off the dormant session.
- **Verification:** Inspected `createSession()` implementation.
- **Remediation:** Enforce atomic preemption inside a transaction:
  ```typescript
  // Before inserting new session:
  db.prepare("DELETE FROM sessions WHERE staff_id = ?").run(staffId);
  ```
  When the preempted token attempts access, `validateSession` fails and returns HTTP 401 (`SESSION_PREEMPTED`).
- **Validation Test:** Sign in as User A on Device 1; sign in as User A on Device 2; assert Device 1's subsequent request returns HTTP 401.

---

### SEC-06: Lack of Explicit CSRF Defense on Mutating REST APIs
- **Severity:** **Medium (P2)**
- **Evidence:** All mutating route handlers (`POST /api/finance/transactions`, `POST /api/residents/check-in`, etc.) rely solely on `SameSite=lax` cookie protection.
- **Impact & Abuse Scenario:** Cross-origin POST requests in certain legacy browser WebViews or subdomain compromise scenarios could trigger state-changing mutations without user intent.
- **Verification:** Audited API route handlers for anti-CSRF token verification.
- **Remediation:** Enforce custom request header validation (`X-Requested-With: XMLHttpRequest` or `X-RN-CSRF: 1`) on all non-GET requests in Next.js middleware, rejecting mutations lacking the custom header.
- **Validation Test:** Submit cross-origin POST without custom header and verify request is blocked with HTTP 403.

---

### SEC-07: Unprotected KYC & Financial Attachment Ingestion
- **Severity:** **Medium (P2)**
- **Evidence:** No file upload routes or document storage services currently exist.
- **Impact & Abuse Scenario:** When attachment capabilities (tenant ID proofs, expense receipts) are introduced, storing files in public directories or accepting unvalidated file types exposes the server to remote code execution (RCE) via polyglot webshells or malware distribution.
- **Verification:** Inspected codebase; confirmed attachment handling is not yet implemented.
- **Remediation:**
  1. Store all files in private, authenticated S3 storage buckets with server-side encryption (SSE-S3).
  2. Validate file signatures (magic bytes) strictly against `image/jpeg`, `image/png`, `image/webp`, and `application/pdf`.
  3. Enforce 5 MB maximum file size.
  4. Serve attachments exclusively via short-lived signed URLs (TTL $\le 15$ minutes) following permission checks.
- **Validation Test:** Attempt uploading an executable or HTML file masquerading as a JPEG; assert server rejects with HTTP 400.

---

### SEC-08: Inherent Multi-Worker Concurrency Race in Room Overbooking
- **Severity:** **Critical (P0)**
- **Evidence:** [`apps/erp/src/server/residents/residentService.ts:285-293`](file:///c:/Users/Rishabh/Desktop/raviNarayana-Erp/apps/erp/src/server/residents/residentService.ts#L285-L293). SQLite's synchronous file locking masks concurrency bugs. In a multi-worker PostgreSQL cluster, concurrent check-in requests will both read `activeOccupancy < capacity` and execute concurrent inserts, resulting in overbooked beds.
- **Verification:** Confirmed absence of row-level lock or database-level exclusion constraint.
- **Remediation:** Introduce `SELECT id FROM rooms WHERE id = $1 FOR UPDATE` within the check-in transaction in PostgreSQL.
- **Validation Test:** Execute 5 concurrent check-in requests for a 1-bed room; assert exactly 1 succeeds and 4 fail with capacity exhaustion.

---

### SEC-09: Lack of Fractional Minor Unit Currency (Paise) Precision
- **Severity:** **Medium (P2)**
- **Evidence:** [`financial_transactions.amount`](file:///c:/Users/Rishabh/Desktop/raviNarayana-Erp/apps/erp/src/server/database/migrations.ts#L304) is stored as an integer representing whole INR rupees.
- **Impact & Abuse Scenario:** When calculating GST (e.g. 5% on tiffin, 12% on rooms), electric meter utility prorating, or late fee percentages, whole rupee rounding creates cumulative financial drift and reconciliation errors.
- **Verification:** Verified schema column types in `migrations.ts`.
- **Remediation:** Represent monetary figures in integer minor units (paise, 1 INR = 100 paise) or `NUMERIC(12, 2)` during the PostgreSQL schema design.
- **Validation Test:** Test GST calculation on ₹80 meal (5% = ₹4.00) and verify exact minor unit balance without floating-point distortion.

---

### SEC-10: Exposure of PII (Resident & Customer Contact Details)
- **Severity:** **Medium (P2)**
- **Evidence:** Phone numbers and emergency contacts are stored in plaintext in `residents` table.
- **Impact & Abuse Scenario:** A database read breach exposes personal phone numbers and emergency contacts of corporate and student residents.
- **Verification:** Verified database table structure.
- **Remediation:** Enforce strict RBAC on resident directory queries. Log every read access to resident PII in `audit_logs`. Implement database-level column encryption for sensitive emergency contact and KYC numbers if required by enterprise compliance.
- **Validation Test:** Assert that accounts lacking `residents.read` cannot query resident phone numbers.
