# Ravinarayan ERP — Comprehensive Security Audit & Threat Model

**Audit Date:** October 16, 2026  
**Auditor:** Antigravity Engineering  
**Scope:** Complete Codebase (`apps/erp`, `apps/website`, `packages/brand`, `data/`, `tests/`)  
**Standard:** OWASP Top 10 (2021) & CIS Application Security Benchmarks  

---

## 1. Authentication & Session Security

### 1.1 Password Storage & Cryptographic Hygiene
- **Algorithm:** `bcryptjs` with 12 salt rounds (`bcrypt.hash(password, 12)`).
- **Verification:** Evaluated in [`apps/erp/src/server/authentication/auth.ts:20-22`](file:///c:/Users/Rishabh/Desktop/raviNarayana-Erp/apps/erp/src/server/authentication/auth.ts#L20-L22).
- **Constant-Time Verification Defense:** When an invalid or nonexistent username is provided, the login handler executes a dummy hash comparison against a static constant hash (`DUMMY_PASSWORD_HASH = "$2a$12$6Kl.3MNW1HtR0bJWduKAGe9PTiL9Pkz6DV.yfthDSGUppMXhV2Agy"`) in [`apps/erp/src/app/api/auth/login/route.ts:49`](file:///c:/Users/Rishabh/Desktop/raviNarayana-Erp/apps/erp/src/app/api/auth/login/route.ts#L49). This equalizes response latencies and mitigates user enumeration attacks.

### 1.2 Session Lifecycle & Hashing at Rest
- **Token Entropy:** 32 cryptographically secure random bytes generated via OS CSPRNG (`crypto.randomBytes(32).toString("hex")` = 256 bits of entropy).
- **Storage at Rest:** **Raw session tokens are never persisted in the database.** Only the SHA-256 digest (`token_hash = sha256(rawToken)`) is stored in `sessions` table ([`auth.ts:274`](file:///c:/Users/Rishabh/Desktop/raviNarayana-Erp/apps/erp/src/server/authentication/auth.ts#L274)). A read compromise or database snapshot leak does not grant attackers active sessions.
- **Cookie Security Attributes:**
  - `Name`: `rn_erp_session`
  - `HttpOnly`: `true` (Mitigates XSS token theft)
  - `Secure`: `true` in production (`process.env.NODE_ENV === "production"`)
  - `SameSite`: `lax` (Mitigates cross-site request forgery)
  - `Path`: `/`
  - `TTL`: 7 days.
- **Revocation Trigger Points:**
  1. `POST /api/auth/logout`: Immediately deletes token hash from `sessions` and sets cookie `Max-Age=0`.
  2. Account Deactivation (`is_active = 0`): Destroys all active sessions (`DELETE FROM sessions WHERE staff_id = ?`) in [`staffService.ts`](file:///c:/Users/Rishabh/Desktop/raviNarayana-Erp/apps/erp/src/server/staff/staffService.ts).
  3. Administrative Password Reset: Automatically purges all active sessions for the target user.
  4. Real-time Inactive Check: `validateSession` joins `staff_users` and asserts `u.is_active = 1`. Inactive accounts cannot use existing valid tokens.

### 1.3 Multi-Layer Rate Limiting & Anti-Lockout
To prevent brute-force attacks while protecting the sole property owner from distributed Denial-of-Service lockout, a 3-layer defense is implemented in [`auth.ts:37-99`](file:///c:/Users/Rishabh/Desktop/raviNarayana-Erp/apps/erp/src/server/authentication/auth.ts#L37-L99):
1. **Layer 1 (IP Limit):** Max 20 failed attempts / 15 minutes per IP across all accounts. Blocks aggressive single-IP botnets.
2. **Layer 2 (Account + IP Pair):** Max 5 failed attempts / 15 minutes for a specific account from a single IP.
3. **Layer 3 (Distributed Velocity Protection):** Evaluates total failed attempts across all IPs targeting an account. Threshold: 10 failures / 15 min. When exceeded, introduces artificial progressive timing delays (1000ms delay) into the response pipeline rather than locking out the account. The real administrator with the correct password is never locked out.
4. **Atomic Attempt Reservation:** `checkRateLimitAndRecord` evaluates limits and reserves an initial failure attempt (`success = 0`) inside a SQLite transaction before bcrypt verification begins. This prevents burst concurrency bypasses.

---

## 2. Authorization & RBAC Audit

### 2.1 Server-Side RBAC Enforcement
- **Centralized Model:** Defined in [`permissions.ts`](file:///c:/Users/Rishabh/Desktop/raviNarayana-Erp/apps/erp/src/server/authorization/permissions.ts) and [`authorize.ts`](file:///c:/Users/Rishabh/Desktop/raviNarayana-Erp/apps/erp/src/server/authorization/authorize.ts).
- **5 Discrete Operational Roles:**
  - `SUPER_ADMIN`: Complete administrative, staff management, financial, and operational authority.
  - `OPERATIONS_MANAGER`: Room management, resident check-ins/outs, kitchen meal plans, delivery dispatches, audit log inspection. No staff provisioning or raw database management.
  - `ACCOUNTANT`: Rent collections, billing, security deposits, expense logging, financial reports, audit logs.
  - `KITCHEN_OPERATIONS`: Daily meal counts, preparation confirmations, kitchen adjustments.
  - `DELIVERY_PERSON`: View and update assigned delivery tasks only. Strictly zero access to financial or resident personal records.

### 2.2 Invariant & Least-Privilege Policies
1. **Fail-Closed Default:** Unrecognized roles or missing permissions immediately return `false` in `hasPermission()`.
2. **Sole Super-Admin Safety Rule:** Deactivating or demoting a `SUPER_ADMIN` is strictly rejected if active Super Admin count is $\le 1$ ([`staffService.ts:74`](file:///c:/Users/Rishabh/Desktop/raviNarayana-Erp/apps/erp/src/server/staff/staffService.ts#L74)).
3. **Delivery Staff Ownership Isolation:** A `DELIVERY_PERSON` can only dispatch, complete, or report exceptions on delivery tasks explicitly assigned to their `staff_id` ([`deliveryService.ts:168`](file:///c:/Users/Rishabh/Desktop/raviNarayana-Erp/apps/erp/src/server/delivery/deliveryService.ts#L168)). Attempting to inspect or alter another courier's task returns HTTP 403.
4. **Finance Separation:** Couriers have zero read or write permissions to financial records (`hasPermission("DELIVERY_PERSON", "finance.read") === false`).

---

## 3. Vulnerability Register & Threat Analysis

### SEC-01: Tracked Binary SQLite Database in Git
- **Severity:** **P0 (Critical)**
- **OWASP Category:** A01:2021 - Broken Access Control / A05:2021 - Security Misconfiguration
- **Evidence:** Running `git ls-files tests` shows:
  ```text
  tests/test_erp.db
  tests/test_erp.db-shm
  tests/test_erp.db-wal
  ```
- **Impact:** Binary database files are committed into version control. Any repository clone contains these files. Build pipelines deploying Docker images or container bundles risk publishing test database files into production images.
- **Remediation:**
  1. Remove files from Git index: `git rm --cached tests/test_erp.db*`.
  2. Update root `.gitignore` from `/data/*.db` to `**/*.db*`.
  3. Reconfigure automated tests to spin up ephemeral SQLite instances in memory (`:memory:`) or temporary operating system directories.
- **Verification:** Run `git ls-files | grep '\.db'` and verify zero output.

### SEC-02: Missing HTTP Security Headers & Content Security Policy (CSP)
- **Severity:** **P1 (High)**
- **OWASP Category:** A05:2021 - Security Misconfiguration
- **Evidence:** Neither [`apps/erp/next.config.mjs`](file:///c:/Users/Rishabh/Desktop/raviNarayana-Erp/apps/erp/next.config.mjs) nor [`apps/website/next.config.mjs`](file:///c:/Users/Rishabh/Desktop/raviNarayana-Erp/apps/website/next.config.mjs) contain a `headers()` configuration block.
- **Impact:** Responses lack:
  - `Content-Security-Policy` (allows arbitrary script execution if an XSS vulnerability occurs).
  - `X-Frame-Options: DENY` (allows clickjacking via malicious iframe embedding).
  - `X-Content-Type-Options: nosniff` (allows MIME-confusion attacks).
  - `Strict-Transport-Security` (allows SSL-stripping man-in-the-middle attacks).
- **Remediation:** Configure `headers()` in `next.config.mjs`:
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
        ],
      },
    ];
  }
  ```
- **Verification:** Execute `curl -I https://erp.ravinarayan.in` and verify all headers are present.

### SEC-03: Absence of Explicit CSRF Defense on Mutating REST APIs
- **Severity:** **P2 (Medium)**
- **OWASP Category:** A01:2021 - Broken Access Control
- **Evidence:** Mutating API endpoints (`/api/residents/check-in`, `/api/finance/transactions`, `/api/delivery/tasks/[id]/dispatch`) rely exclusively on `SameSite=lax` cookie protection.
- **Impact:** While modern browsers omit `SameSite=lax` cookies on cross-origin POST requests, browser edge-cases (e.g. top-level GET navigation following window openers, older mobile WebViews, or same-site subdomain attacks from compromised marketing subdomains) can execute state changes.
- **Remediation:** Add a custom header validation (e.g. checking for `X-Requested-With: XMLHttpRequest` or `X-RN-CSRF: 1`) or introduce cryptographic double-submit anti-CSRF tokens for all mutating Next.js API routes.
- **Verification:** Attempt cross-origin fetch from an untrusted origin and confirm request is blocked with HTTP 403.

### SEC-04: Formula Injection Defense in CSV Exports
- **Severity:** **P2 (Resolved / Verified)**
- **OWASP Category:** A03:2021 - Injection (CSV / Formula Injection)
- **Evidence:** [`apps/erp/src/app/api/reports/executive/route.ts:8-13`](file:///c:/Users/Rishabh/Desktop/raviNarayana-Erp/apps/erp/src/app/api/reports/executive/route.ts#L8-L13) and [`apps/erp/src/modules/finance/utils/exportCsv.ts`](file:///c:/Users/Rishabh/Desktop/raviNarayana-Erp/apps/erp/src/modules/finance/utils/exportCsv.ts):
  ```typescript
  function sanitizeCsvCell(value: string | number): string {
    const str = String(value ?? "");
    const safe = /^[=+\-@\t\r]/.test(str) ? `'${str}` : str;
    return `"${safe.replace(/"/g, '""')}"`;
  }
  ```
- **Status:** **Secure & Verified**. Cells starting with formula characters (`=`, `+`, `-`, `@`, `\t`, `\r`) are automatically escaped with a leading single quote, disarming Microsoft Excel and Google Sheets formula execution.

---

## 4. Audit Logging & Credential Sanitization

### 4.1 Tamper-Evident Audit Logging
- **Table:** `audit_logs`
- **Fields:** `id`, `actor_id`, `actor_username`, `action`, `target_type`, `target_id`, `metadata`, `ip_address`, `created_at`.
- **Automatic Credential Sanitization:** [`apps/erp/src/server/audit/audit.ts:11-28`](file:///c:/Users/Rishabh/Desktop/raviNarayana-Erp/apps/erp/src/server/audit/audit.ts#L11-L28).
  Keys matching `/password|token|hash|secret|cookie|credit|auth/i` are automatically replaced with `"[REDACTED]"` before persisting to SQLite/PostgreSQL.
- **Audit Event Coverage:**
  - `auth.login`, `auth.forbidden`, `staff.created`, `staff.role_assigned`, `staff.deactivated`, `staff.password_reset`.
  - `resident.registered`, `resident.checked_in`, `resident.checked_out`.
  - `finance.rent_charge_recorded`, `finance.rent_payment_recorded`, `finance.deposit_recorded`, `finance.expense_recorded`, `finance.transaction_reversed`.
  - `kitchen.plan_created`, `kitchen.plan_confirmed`, `kitchen.plan_completed`, `kitchen.adjustment_logged`.
  - `delivery.tasks_generated`, `delivery.task_assigned`, `delivery.task_dispatched`, `delivery.task_delivered`, `delivery.task_exception`, `delivery.task_retried`.
