# Ravinarayan ERP — Durable Engineering Work Log

This log provides a persistent, chronological audit trail of all engineering activities, inspections, decisions, and commit histories across all development phases.

---

## Log Entry 001 — Task 00: Comprehensive Repository Audit, Product Specification & Engineering Documentation

- **Date:** 16 October 2026
- **Task Identifier:** `TASK-00` (Phase 00: Architecture, Requirements & Security Baseline)
- **Author:** Antigravity Engineering (Senior Staff AI Architect)
- **Scope & Rationale:** Establish an authoritative, verified documentation baseline for the entire Ravinarayan PG & Tiffin ERP codebase. Understand the existing repository structure, database schemas, API routes, security controls, and tests without modifying working application code, changing schemas, or performing destructive actions.

### 1. Files Inspected
- **Monorepo & Manifests:** `package.json`, `apps/erp/package.json`, `apps/website/package.json`, `packages/brand/package.json`, `packages/brand/index.ts`, `packages/config/`.
- **Database & Persistence:** `apps/erp/src/server/database/db.ts`, `apps/erp/src/server/database/migrations.ts`, `apps/erp/src/server/database/env.ts`, `apps/erp/src/server/database/cleanup.ts`, `apps/erp/src/server/database/seedSyntheticData.ts`.
- **Authentication & RBAC:** `apps/erp/src/server/authentication/auth.ts`, `apps/erp/src/server/authentication/ip.ts`, `apps/erp/src/server/authorization/permissions.ts`, `apps/erp/src/server/authorization/authorize.ts`, `apps/erp/src/server/audit/audit.ts`.
- **Business Services:** `apps/erp/src/server/rooms/roomService.ts`, `apps/erp/src/server/residents/residentService.ts`, `apps/erp/src/server/finance/financeService.ts`, `apps/erp/src/server/kitchen/kitchenService.ts`, `apps/erp/src/server/delivery/deliveryService.ts`, `apps/erp/src/server/staff/staffService.ts`, `apps/erp/src/server/notifications/notificationService.ts`.
- **API Routes (All 30 Routes):** Audited `apps/erp/src/app/api/auth/*`, `delivery/*`, `finance/*`, `kitchen/*`, `notifications/*`, `reports/*`, `residents/*`, `rooms/*`.
- **User Interface & Shell:** `apps/erp/src/app/(management)/*`, `apps/erp/src/components/layout/ErpShell.tsx`, `apps/erp/src/modules/finance/*`, `apps/website/src/app/*`, `apps/website/src/data/*`.
- **Automated Test Suites:** `tests/auth_hardening.test.ts`, `tests/rbac_staff_foundation.test.ts`, `tests/rooms_residents.test.ts`, `tests/finance.test.ts`, `tests/kitchen.test.ts`, `tests/delivery.test.ts`, `tests/integration_audit.test.ts`.

### 2. Files Created or Updated
- `docs/PROJECT_REQUIREMENTS.md` (Created canonical PRD covering vision, account allocation, auth/OTP, tiffin directory, products/pricing, ordering/kitchen flow, delivery courier flow, owner-supplied 22-room layout, resident lifecycle, billing/GST, cashbook views, attachments, LPG/ingredient tracking, operational closing, deferred items, open decisions).
- `docs/ARCHITECTURE_AND_DECISIONS.md` (Created architectural audit, technology stack versions, current vs target Mermaid diagrams, data flows, technical debt, ADR log ADR-01 through ADR-06, and implementation progress).
- `docs/SECURITY_AUDIT.md` (Created comprehensive threat model, OWASP Top 10 evaluation, vulnerabilities SEC-01 through SEC-10, credential sanitization, rate limiting, and verification criteria).
- `docs/IMPLEMENTATION_ROADMAP.md` (Created phased implementation plan from Phase 00 through Phase 08 with acceptance criteria and definition of done).
- `docs/WORK_LOG.md` (Created this authoritative durable work log).
- `docs/DATA_DICTIONARY.md` (Created verified database schema, table structures, column types, constraints, and relationships).
- `docs/PRODUCTION_RUNBOOK.md` (Created production deployment runbook, environment variables, PgBouncer setup, automated backups, health check specifications, and disaster recovery drill).
- `docs/TEST_STRATEGY.md` (Created role-based, workflow, concurrency, security, and regression test plan).

### 3. Commands & Non-Destructive Checks Run
- `git status`: Verified working tree cleanliness prior to starting and after document creation.
- `git log -n 5 --oneline`: Inspected recent commits and verified baseline commit hash.
- `git ls-files tests`: Discovered tracked binary SQLite databases (`tests/test_erp.db*`).
- Automated Full Test Suite (`npm test`): Successfully ran all 7 test suites, verifying **464 passing assertions and 0 failures**:
  - Delivery workflow & guards: 137 / 137 passed
  - Finance, ledger & reversals: 102 / 102 passed
  - Kitchen & meal plans: 62 / 62 passed
  - Rooms & residents: 60 / 60 passed
  - Security & rate limiting: 49 / 49 passed
  - RBAC permissions: 28 / 28 passed
  - Monorepo integration audit: 26 / 26 passed
- Headless Chrome CDP Viewport Verification: Confirmed 0px horizontal overflow across all 5 required breakpoints (1440px desktop, 1280px laptop, 1024px compact desktop, 768px tablet, 390px mobile).
- AST & Route Traversal: Verified authentication and role guards across all 30 REST route handlers.

### 4. Key Findings & Architecture Discrepancies
1. **Critical Persistent Storage Defect:** The application currently relies on local SQLite (`data/erp.db`) via synchronous native C++ bindings (`better-sqlite3`). Cloud containers discard ephemeral filesystems on redeploy/restart, causing total business data loss.
2. **Tracked Binary Database Files:** Binary files `tests/test_erp.db`, `tests/test_erp.db-shm`, and `tests/test_erp.db-wal` are tracked in Git.
3. **Room Inventory Divergence:** Existing synthetic demo seeds 30 rooms (`101`–`407`, 56 beds), whereas the owner's authoritative physical inventory contains 22 rooms (`OL1`–`OL5`, `001`–`008`, `101`–`108`, `M01`, 39 beds).
4. **Missing Production Security Headers:** Next.js configs lack `Content-Security-Policy`, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, and `Strict-Transport-Security`.
5. **Missing Email OTP & Single Active Session Preemption:** Authentication does not yet require 2FA OTP, nor does a new login invalidate existing sessions.

### 5. Open Questions Requiring Owner Confirmation
- Exact bed capacity of master suite `M01` (1 bed vs 2 beds).
- Monthly rent billing due dates and mid-month move-in prorating policy.
- Minimum notice period and credit adjustment policy for pausing monthly tiffin plans.
- Policy on absorbing returned/wasted delivery meals as operating loss vs billing customer.
- GST registration details, GSTIN, and tax rates.
- Whether owner accounts should be permitted simultaneous desktop/mobile logins.

### 6. Local Commit Information
- **Commit Action:** Staged only documentation files created in `docs/`.
- **Remote Push:** **NEVER PUSHED TO GITHUB / ZERO REMOTE MUTATIONS**.
- **Next Recommended Step:** Present Task 00 documentation to product manager and owner for review; proceed to **Phase 01: Production Foundation & Security** upon approval.

---

## Log Entry 002 — Task 01: Production Foundation, PostgreSQL Migration & Security Hardening

- **Date:** 17 October 2026
- **Task Identifier:** `TASK-01` (Phase 01: Production Foundation, PostgreSQL Migration & Security Hardening)
- **Author:** Antigravity Engineering (Senior Staff AI Architect)
- **Scope & Rationale:** Implement Phase 01 production foundation and security enhancements without regression of existing capabilities. Establish typed PostgreSQL persistence via Drizzle ORM, an asynchronous database layer (`getAsyncDb()`) supporting connection pooling (`DATABASE_URL` port 6543) and direct connection (`DIRECT_URL` port 5432), safe SQLite-to-PostgreSQL migration with financial aggregate checks, 2-step Email OTP login, secure self-service password recovery, single active session preemption returning HTTP 401 `SESSION_PREEMPTED`, CSRF protection, Next.js security headers, and an active `/api/health` diagnostic endpoint.

### 1. Files Inspected
- Monorepo structure, engines declarations, root & application `package.json`, `tsconfig.json`.
- Database modules: `apps/erp/src/server/database/db.ts`, `migrations.ts`, `env.ts`.
- Authentication & security: `apps/erp/src/server/authentication/auth.ts`, `apps/erp/src/server/authorization/authorize.ts`, `apps/erp/src/app/api/auth/*`.
- Next.js configurations: `apps/erp/next.config.mjs`, `apps/website/next.config.mjs`.
- All 7 regression test suites and database seed scripts.

### 2. Files Created or Updated
- **PostgreSQL Schema & Migrations:**
  - `apps/erp/src/server/database/schema/index.ts`: Typed Drizzle ORM schema mapping 17 tables (all 15 existing + 2 Phase 01 security tables: `auth_challenges`, `password_resets`), preserving foreign keys, checks (`amount > 0` whole INR), functional unique indexes (`lower(room_number)`, `lower(username)`, `lower(email)`), and partial unique index (`idx_unique_active_resident_stay` for active stays).
  - `apps/erp/drizzle.config.ts`: Drizzle Kit configuration for schema generation.
  - `apps/erp/src/server/database/drizzle/0000_lying_giant_girl.sql`: Complete PostgreSQL initial DDL migration.
  - `apps/erp/src/server/database/migrations.ts`: Added SQLite Migration V9 establishing parity for Phase 01 security tables.
- **Database Client & Migration Pipeline:**
  - `apps/erp/src/server/database/client.ts`: Pooled PostgreSQL connection via `postgres` client, Drizzle instance, graceful process exit listeners, and `pingDatabase()` health diagnostic.
  - `apps/erp/src/server/database/db.ts`: Added `AsyncDb`, `getAsyncDb()`, and `convertPlaceholders()` translating `?` to `$1, $2, ...` outside string literals for PostgreSQL.
  - `apps/erp/src/server/database/migrateSqliteToPg.ts`: Standalone SQLite-to-PostgreSQL migration script with automatic timestamped backup, referential table order insertion, 100-row batching, record count verification, and whole INR checksum matching.
- **Transactional Notifications & Security:**
  - `apps/erp/src/server/notifications/emailAdapter.ts`: `EmailAdapter` interface, production `ResendEmailAdapter` using native fetch, and in-memory `MockEmailAdapter` for isolated testing.
  - `apps/erp/src/server/security/csrf.ts`: Same-origin and custom header (`X-RN-CSRF`) validation rejecting unauthorized cross-site mutations with HTTP 403.
  - `apps/erp/next.config.mjs` & `apps/website/next.config.mjs`: Added Content Security Policy (CSP), HSTS, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, and `Permissions-Policy`.
- **Authentication & Endpoints:**
  - `apps/erp/src/server/authentication/auth.ts`: Implemented `createOtpChallenge`, `verifyOtpChallenge`, `initiatePasswordReset`, `completePasswordReset`, single-session preemption in `createSession`, and `maskEmail`.
  - `apps/erp/src/server/authorization/authorize.ts`: Handled `isPreempted` session state returning `SESSION_PREEMPTED` and clearing auth cookies.
  - `apps/erp/src/app/api/auth/login/route.ts`: Refactored to 2-step authentication returning `{ status: "OTP_REQUIRED", challengeId, emailMasked }`.
  - `apps/erp/src/app/api/auth/otp/verify/route.ts`: Created dedicated OTP verification endpoint.
  - `apps/erp/src/app/api/auth/forgot-password/route.ts`: Timing-safe self-service recovery initiation.
  - `apps/erp/src/app/api/auth/reset-password/route.ts`: Single-use token password reset with session invalidation.
  - `apps/erp/src/app/api/auth/me/route.ts`: Returns HTTP 401 `SESSION_PREEMPTED` on preempted session tokens.
  - `apps/erp/src/app/api/auth/logout/route.ts`: CSRF-protected session revocation.
  - `apps/erp/src/app/api/health/route.ts`: Production health check testing DB connectivity and latency.
  - `apps/erp/src/modules/auth/components/LoginForm.tsx`: Multi-step UI for OTP input and password reset flow.
- **Tests & Git Index Cleanup:**
  - `tests/postgresql_phase01.test.ts`: 62 automated Phase 01 assertions covering Drizzle schema, OTP lifecycle, recovery, session preemption, CSRF, security headers, health check, and migration dry-run.
  - Untracked `tests/test_erp.db*` from Git cache and updated `.gitignore`.
  - `package.json`: Added `test:phase01` script and updated Node.js engines.
  - `.env.example`: Added PostgreSQL, Resend, and ERP base URL configuration templates.

### 3. Automated Verification Results
- **Phase 01 Test Suite (`npm run test:phase01`):** **62 PASSED, 0 FAILED, 2 BLOCKED** (blocked items: live PostgreSQL data migration and live row lock verification, explicitly blocked on host credentials).
- **Existing Regression Test Suites (`npm test`):** **640 PASSED, 0 FAILED across all 7 suites**:
  - Security & rate limiting (`tests/auth_hardening.test.ts`): 49 / 49 passed
  - RBAC & staff lifecycle (`tests/rbac_staff_foundation.test.ts`): 114 / 114 passed
  - Rooms & residents (`tests/rooms_residents.test.ts`): 60 / 60 passed
  - Finance & cashbook (`tests/finance.test.ts`): 102 / 102 passed
  - Kitchen & daily meal plans (`tests/kitchen.test.ts`): 81 / 81 passed
  - Comprehensive integration audit (`tests/integration_audit.test.ts`): 97 / 97 passed
  - Delivery management (`tests/delivery.test.ts`): 137 / 137 passed
- **Application Production Builds:**
  - `npm run build:erp`: **Successfully built** Next.js 14.2.35 production bundle (0 errors, 11 static pages, 30 dynamic API routes).
  - `npm run build:website`: **Successfully built** Next.js 14.2.35 production bundle (0 errors, 10 static pages).

### 4. Commit Status
- **Local Git Repository:** Changes staged and committed locally on `master`.
- **Remote Push:** **NEVER PUSHED TO REMOTE REPOSITORY**. Strict local commit policy enforced.

---

## Log Entry 003 — Task 01A: Phase 01 Verification, Security Remediation & PostgreSQL Readiness

- **Date:** 17 October 2026
- **Task Identifier:** `TASK-01A` (Phase 01 Verification, Security Remediation & PostgreSQL Readiness)
- **Author:** Antigravity Engineering (Senior Staff AI Architect)
- **Starting Commit:** `32aec8a`
- **Scope & Rationale:** Independently verify Phase 01, fix all confirmed security defects, eliminate CSRF bypass vectors, configure safe CSP and HSTS headers, persist session preemption across server restarts, enforce fail-fast database configuration in production, implement conflict detection in the data migration pipeline, and enforce guarded rollback policies.

### 1. Files Inspected
- Monorepo root and ERP/Website configurations: `package.json`, `apps/erp/next.config.mjs`, `apps/website/next.config.mjs`, `apps/erp/src/middleware.ts`.
- Security & Authentication: `apps/erp/src/server/security/csrf.ts`, `apps/erp/src/server/authentication/auth.ts`, `apps/erp/src/server/authorization/authorize.ts`.
- Database Layer: `apps/erp/src/server/database/schema/index.ts`, `migrations.ts`, `db.ts`, `client.ts`, `env.ts`, `cleanup.ts`, `migrateSqliteToPg.ts`, Drizzle migration files.
- Documentation: `docs/PRODUCTION_RUNBOOK.md`, `docs/WORK_LOG.md`.
- Test Suites: `tests/postgresql_phase01.test.ts` and all 7 regression suites.

### 2. Remediations & Technical Fixes
1. **CSRF Validation & Mutation Protection (`apps/erp/src/server/security/csrf.ts`, `apps/erp/src/middleware.ts`):**
   - Eliminated vulnerability where a static client header (`X-RN-CSRF: 1`) could independently authorize cross-origin browser requests.
   - Added strict `sec-fetch-site === "cross-site"` rejection.
   - Mandated valid Origin / Referer validation against application base URLs for browser requests with ambient session cookies.
   - Cookie-authenticated mutating requests missing both Origin and Referer are strictly rejected.
   - Added automatic CSRF middleware validation across all mutating REST endpoints (`POST`, `PUT`, `PATCH`, `DELETE` under `/api/*`).
2. **CSP & HSTS Security Headers (`apps/erp/next.config.mjs`, `apps/website/next.config.mjs`):**
   - Completely eliminated `'unsafe-eval'` from production `script-src` directives.
   - Documented the architectural necessity of `'unsafe-inline'` for Next.js App Router (14.2) bootstrap script hydration.
   - Replaced aggressive HSTS (`includeSubDomains; preload`) with conservative `max-age=31536000`, preventing irreversible browser domain pinning pending complete subdomain HTTPS validation.
3. **Persistent Single Active Session Preemption (`apps/erp/src/server/database/schema/index.ts`, `migrations.ts`, `drizzle/0001_faithful_gorgon.sql`, `auth.ts`, `cleanup.ts`):**
   - Replaced ephemeral in-memory `Map<string, PreemptedSession>` with persistent database table `session_preemptions`.
   - Added Drizzle schema, SQLite migration V10, and Drizzle migration `0001_faithful_gorgon.sql` for `session_preemptions`.
   - Preempted session records survive process restarts, multi-instance horizontal scaling, and container redeployments.
   - Added automatic cleanup of expired preemption records and challenge entries in `cleanup.ts`.
   - Standardized OTP challenge ID prefix to `chl_` across auth modules.
4. **Production Database Fallback Safeguards (`apps/erp/src/server/database/env.ts`, `db.ts`, `client.ts`):**
   - Implemented `validateProductionDatabaseEnvironment()` in `env.ts`.
   - Startup throws fatal errors in production when `DATABASE_URL` is missing, malformed, or unreachable.
   - Strictly prohibited silent fallback to local ephemeral SQLite (`data/erp.db`) in production environments.
   - `pingDatabase()` explicitly returns `ok: false, engine: "none"` when PostgreSQL is unconfigured in production.
5. **Topological Data Migration & Conflict Detection (`apps/erp/src/server/database/migrateSqliteToPg.ts`, `docs/PRODUCTION_RUNBOOK.md`):**
   - Included all 18 operational tables (topologically ordered to respect foreign keys).
   - Added pre-migration backup generation under `data/backups/erp_backup_<timestamp>.db`.
   - Replaced blind `ON CONFLICT DO NOTHING` with explicit conflict detection: compares existing target records against source rows, halts with a fatal conflict error on divergent data, and prevents silent record overwriting.
   - Added `rollbackPostgresMigration` requiring explicit `confirmDestructive: true` and disallowing execution in production unless `allowProduction: true` is explicitly passed.
   - Corrected `docs/PRODUCTION_RUNBOOK.md` to remove claims that unsetting `DATABASE_URL` is a safe rollback, mandating PostgreSQL PITR and WAL replay for production disaster recovery.

### 3. Verification Results
- **Phase 01 Test Suite (`npm run test:phase01`):** **84 PASSED, 0 FAILED, 2 BLOCKED** (blocked items: live PostgreSQL data migration execution and live row lock verification, explicitly blocked on host credentials).
- **Existing Regression Test Suites (`npm test`):** **640 PASSED, 0 FAILED across all 7 suites**:
  - Security & rate limiting (`tests/auth_hardening.test.ts`): 49 / 49 passed
  - RBAC & staff lifecycle (`tests/rbac_staff_foundation.test.ts`): 114 / 114 passed
  - Rooms & residents (`tests/rooms_residents.test.ts`): 60 / 60 passed
  - Finance & cashbook (`tests/finance.test.ts`): 102 / 102 passed
  - Kitchen & daily meal plans (`tests/kitchen.test.ts`): 81 / 81 passed
  - Comprehensive integration audit (`tests/integration_audit.test.ts`): 97 / 97 passed
  - Delivery management (`tests/delivery.test.ts`): 137 / 137 passed
- **Application Production Builds:**
  - `npm run build:erp`: **Successfully compiled** Next.js 14.2.35 production build.
  - `npm run build:website`: **Successfully compiled** Next.js 14.2.35 production build.

### 4. Git Commit Policy
- **Local Git Repository:** Changes committed locally on `master`.
- **Remote Push:** **NEVER PUSHED TO REMOTE REPOSITORY**. Strict local commit policy enforced.


