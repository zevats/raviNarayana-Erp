# Ravinarayan ERP & Website Architecture

## 1. High-Level Monorepo Overview

The Ravinarayan repository is organized as a clean npm monorepo separating the public customer-facing website from the internal management ERP:

```text
raviNarayana-Erp/
├── apps/
│   ├── website/                  # Public website (@ravinarayan/website)
│   │   ├── public/               # Public imagery, room photography, logo
│   │   ├── src/
│   │   │   ├── app/              # Next.js App Router (/, /about, /rooms, /tiffin-service, /contact)
│   │   │   ├── components/       # Botanical luxury showcase components
│   │   │   ├── data/             # Static room data and site configuration
│   │   │   └── utils/            # Motion and easing utilities
│   │   ├── package.json          # Runs independently on port 3000
│   │   ├── next.config.mjs
│   │   ├── tailwind.config.ts    # Powered by @ravinarayan/brand
│   │   └── tsconfig.json
│   │
│   └── erp/                      # Operations ERP (@ravinarayan/erp)
│       ├── public/               # ERP brand assets (logo crest)
│       ├── src/
│       │   ├── app/              # Next.js App Router (/login, /dashboard, /api/auth/*)
│       │   ├── modules/          # Feature-based business modules (auth, staff, rooms, delivery, etc.)
│       │   ├── server/           # Server-only database, auth, session infrastructure
│       │   ├── components/       # Layout, form, and shell components
│       │   ├── types/            # Domain interfaces and role definitions
│       │   └── styles/           # ERP global CSS with authentic brand tokens
│       ├── package.json          # Runs independently on port 3001
│       ├── next.config.mjs
│       ├── tailwind.config.ts    # Powered by @ravinarayan/brand
│       └── tsconfig.json
│
├── packages/
│   └── brand/                    # Shared brand tokens (single source of truth)
│       ├── index.ts              # Exports brandTokens, brandColors, brandFonts
│       └── package.json          # @ravinarayan/brand workspace package
│
├── data/                         # Persistent SQLite storage
│   ├── erp.db                    # Active WAL database (git-ignored)
│   ├── erp.db-wal
│   └── erp.db-shm
│
├── tests/                        # Automated security & hardening test suite
│   ├── auth_hardening.test.ts
│   ├── register_paths.js
│   └── tsconfig.json
│
├── docs/                         # System documentation
│   ├── architecture.md
│   ├── module-map.md
│   └── deployment.md
│
├── package.json                  # Monorepo root workspace orchestration
├── .gitignore                    # Workspaces-aware ignore rules
└── .env.example                  # Validated environment configuration template
```

---

## 2. Shared Brand Tokens (`@ravinarayan/brand`)

Design tokens are authored once in `packages/brand/index.ts` and consumed directly by both applications:
- **`brandTokens`**: Complete structured tree containing color palettes, typography, spacing, surface treatments, status tokens, radii, and shadows.
- **`brandColors`**: Tailwind-compatible color object exporting Forest Evergreen (`#5D7656`, `#263B2D`, `#1A2E20`), Sage neutrals (`#8E9F89`, `#A8B9A1`, `#DCE5D7`), Warm Brass (`#B58A57`, `#C89F6B`), and Ivory/Canvas surfaces (`#FAF8F5`, `#FBF9F3`, `#F4F0E5`).
- **`brandFonts`**: Serif (`Cormorant Garamond`, `Playfair Display`) and Sans-serif (`Plus Jakarta Sans`) definitions.

Both `apps/website/tailwind.config.ts` and `apps/erp/tailwind.config.ts` import `{ brandColors, brandFonts } from "@ravinarayan/brand"` directly, ensuring true single-source-of-truth ownership.

---

## 3. Canonical Routing & URL Isolation

### Public Website
- Deployed at `ravinarayan.in` (local: `http://localhost:3000`).
- Serves: `/`, `/about`, `/rooms`, `/tiffin-service`, `/contact`, `/robots.txt`, `/sitemap.xml`.
- **Absolute Isolation**: Zero `/erp/*` or `/api/erp/*` routes exist in the website app tree. Requests to `/erp` return `404 Not Found`.

### Operations ERP
- Deployed at `erp.ravinarayan.in` (local: `http://localhost:3001`).
- Serves canonical routes without path prefixes:
  - `/login`: Staff authentication portal.
  - `/dashboard`: Operations management shell.
  - `/api/auth/login`: Session creation endpoint.
  - `/api/auth/logout`: Session revocation endpoint.
  - `/api/auth/me`: Active session inspection endpoint.
  - `/`: Server-side redirector to `/dashboard` (if authenticated) or `/login` (if unauthenticated).

---

## 4. Hardened Authentication & Session Lifecycle

### A. Session Token Security & Hashing at Rest
1. **Token Generation**: Upon successful authentication, the server generates 32 cryptographically random bytes (256 bits of entropy) from the OS CSPRNG (`crypto.randomBytes(32).toString("hex")`).
2. **Digest at Rest**: The raw token is **never stored in the database**. The database records only the one-way SHA-256 digest (`token_hash = sha256(rawToken)`). A database backup leak or read compromise does not expose plaintext session tokens.
3. **Cookie Attributes**:
   - `Name`: `rn_erp_session`
   - `HttpOnly`: `true` (Inaccessible to client-side JavaScript / XSS).
   - `Secure`: `true` in production (Transmitted strictly over HTTPS).
   - `SameSite`: `lax` (Mitigates cross-site request forgery).
   - `Path`: `/`
   - `Expires`: 7 days.
4. **Validation & Revocation**:
   - When a request is received, the cookie token is hashed with SHA-256 and matched against `sessions.token_hash`.
   - Logging out immediately executes `DELETE FROM sessions WHERE token_hash = ?` and clears the client cookie (`Max-Age=0`).

### B. Layered Rate Limiting & Anti-Lockout Architecture
To prevent credential stuffing and brute force without exposing administrators to distributed account lockout Denial-of-Service (DoS), rate limiting is enforced in 3 layers:

1. **Layer 1 — IP-Based Limit**:
   - Evaluates total failed attempts originating from a single client IP across all accounts within 15 minutes.
   - Threshold: **20 failed attempts / 15 min**.
   - Result: Blocks the aggressive IP from making further requests with HTTP 429.
2. **Layer 2 — Account + IP Pair Limit**:
   - Evaluates failed attempts targeting a specific account from a single client IP within 15 minutes.
   - Threshold: **5 failed attempts / 15 min**.
   - Result: Blocks that specific IP from attempting that account with HTTP 429.
3. **Layer 3 — Distributed Account Velocity Protection (No Global Lockout)**:
   - Evaluates total failed attempts across *all* IP addresses targeting a specific account within 15 minutes.
   - Threshold: **10 failed attempts / 15 min**.
   - Result: Injects progressive artificial timing delays (1000ms delay) into the response pipeline. Brute-force attacks become computationally unviable for distributed attackers, while the legitimate administrator with the correct password is **never locked out**.
4. **Failure Counter Reset**:
   - When authentication succeeds with the correct password, failed attempt records for that `(identifier, ip)` pair are immediately cleared from SQLite.

### C. Client IP Trust Boundaries (`TRUST_PROXY_HEADERS`)
- When running directly or in local development (`TRUST_PROXY_HEADERS=false`), forwarding headers (`X-Forwarded-For`, `CF-Connecting-IP`) are strictly ignored to prevent client spoofing. The IP defaults to `127.0.0.1`.
- When deployed behind a verified reverse proxy or Cloudflare (`TRUST_PROXY_HEADERS=true`), the edge-verified `CF-Connecting-IP` or first sanitized IPv4/IPv6 hop from `X-Forwarded-For` is extracted and validated against strict IP regex patterns.

---

## 5. Database Schema & Versioned Migrations

Database operations use `better-sqlite3` in Write-Ahead Logging (`WAL`) mode with foreign key enforcement (`PRAGMA foreign_keys = ON`).

### Versioned Migration Engine (`PRAGMA user_version`)
Schema migrations run automatically on database connection:

- **Version 0 &rarr; Version 1**:
  - `staff_users`: Schema created/verified. Existing users preserved.
  - `sessions`: Migrated to store `token_hash TEXT UNIQUE NOT NULL` instead of raw `session_token`.
  - `login_attempts`: Added `ip_address TEXT NOT NULL` column.
  - Indexes: Created `idx_sessions_token_hash`, `idx_sessions_expires`, `idx_login_attempts_ip`, `idx_login_attempts_ident_ip`.
  - Sets `PRAGMA user_version = 1`.

### Safe Database Cleanup
Bounded maintenance runs at server startup and throttled during authenticated traffic (at most once every 30 minutes):
1. **Expired Sessions**: `DELETE FROM sessions WHERE expires_at < ?` (Active sessions are strictly preserved).
2. **Stale Rate-Limit Logs**: `DELETE FROM login_attempts WHERE attempted_at < ?` (Pruned after 24 hours).

---

## 6. Staff Foundation & Role-Based Access Control (RBAC) Architecture (Phase 2A)

### A. Role-Permission Matrix
The ERP enforces a centralized, strict least-privilege permission model:

| Permission | Description | `SUPER_ADMIN` | `OPERATIONS_MANAGER` | `ACCOUNTANT` | `KITCHEN_OPERATIONS` | `DELIVERY_PERSON` |
| :--- | :--- | :---: | :---: | :---: | :---: | :---: |
| `staff.read` | View staff directory & roles | ✓ | ✓ | — | — | — |
| `staff.create` | Provision new staff accounts | ✓ | — | — | — | — |
| `staff.update` | Edit staff profiles & passwords | ✓ | — | — | — | — |
| `staff.deactivate`| Activate/deactivate accounts | ✓ | — | — | — | — |
| `staff.assign_role`| Assign or change staff roles | ✓ | — | — | — | — |
| `audit.read` | View tamper-evident audit logs | ✓ | ✓ | ✓ | — | — |
| `system.manage` | Administrative configuration | ✓ | — | — | — | — |
| `rooms.read` | View room inventory & status | ✓ | ✓ | — | — | — |
| `rooms.manage` | Manage room assignments & rates | ✓ | ✓ | — | — | — |
| `residents.read` | View resident stay profiles | ✓ | ✓ | ✓ | — | — |
| `residents.manage`| Check-in/out residents | ✓ | ✓ | — | — | — |
| `finance.read` | View payments & ledger receipts | ✓ | ✓ | ✓ | — | — |
| `finance.manage` | Record cashbook & rent receipts | ✓ | — | ✓ | — | — |
| `tiffin.read` | View daily meal orders & counts | ✓ | ✓ | — | ✓ | — |
| `tiffin.manage` | Modify tiffin delivery counts | ✓ | ✓ | — | — | — |
| `kitchen.read` | View kitchen packing lists | ✓ | ✓ | — | ✓ | — |
| `kitchen.manage` | Mark meal prep completed | ✓ | — | — | ✓ | — |
| `delivery.read` | View assigned delivery runs | ✓ | ✓ | — | — | ✓ |
| `delivery.update` | Update stop delivery status | ✓ | — | — | — | ✓ |

*Any unassigned, unrecognized, or null role/permission immediately fails closed with `false`.*

### B. Database Migration V2 (`user_version = 2`)
1. **`audit_logs` Table**:
   - `id TEXT PRIMARY KEY`: Prefixed UUID (`aud_...`).
   - `actor_id TEXT`, `actor_username TEXT`: Performing staff member (survives staff deletion).
   - `action TEXT NOT NULL`: Structured event verb (e.g. `staff.created`, `staff.role_assigned`, `staff.deactivated`, `staff.password_reset`, `auth.forbidden`).
   - `target_type TEXT NOT NULL`: Entity kind (`staff_user`, `permission`, `system`).
   - `target_id TEXT`: Affected target identifier.
   - `metadata TEXT`: JSON string of non-sensitive change details.
   - `ip_address TEXT`: Client IP address at event time.
   - `created_at TEXT NOT NULL`: ISO 8601 audit timestamp.
2. **Indexes**:
   - `idx_audit_logs_created`, `idx_audit_logs_action`, `idx_audit_logs_actor`, `idx_audit_logs_target`.
   - `idx_staff_users_role`, `idx_staff_users_active`.

### C. Server-Side Authorization Layer
- **`permissions.ts`**: Centralized definitions for `ALL_ROLES`, `ALL_PERMISSIONS`, `ROLE_PERMISSIONS`, and `hasPermission()`.
- **`authorize.ts`**: Server-only boundary helpers:
  - `resolveUserFromRequest(request)`: Validates session token against live DB session and active staff status.
  - `requireUser(request)`: Asserts valid session; throws `AuthorizationError(401)` on missing/expired credentials.
  - `requirePermission(user, permission, context)`: Asserts required permission; logs `auth.forbidden` audit event and throws `AuthorizationError(403)` on failure.
  - `unauthorizedResponse()`, `forbiddenResponse()`: Standardized HTTP 401 and 403 responses.

### D. Account Lifecycle & Security Invariant Policies
1. **Immediate Inactive Account Rejection**: Inactive staff accounts (`is_active = 0`) are excluded from `findStaffByIdentifier` and `validateSession`, blocking both login attempts and active session usage.
2. **Immediate Session Revocation on Deactivation**: Deactivating a staff account immediately deletes all associated records from `sessions WHERE staff_id = ?`.
3. **Immediate Session Revocation on Password Reset**: Administrative password reset immediately deletes all active sessions for that user to prevent compromised session persistence.
4. **Immediate Role Change Propagation**: Because `validateSession` queries live `staff_users.role` on each validation, role changes take effect immediately on the user's very next request.
5. **Sole Super-Administrator Safety Rule**: Demoting or deactivating a `SUPER_ADMIN` is strictly forbidden if `SELECT COUNT(*) FROM staff_users WHERE role = 'SUPER_ADMIN' AND is_active = 1` is $\le 1$.
6. **Immutable Audit Trail & Credential Sanitization**: `sanitizeAuditMetadata` automatically redacts keys matching `/password|token|hash|secret|credit/i` before writing to `audit_logs`. Raw passwords or password hashes are never stored in audit records.

