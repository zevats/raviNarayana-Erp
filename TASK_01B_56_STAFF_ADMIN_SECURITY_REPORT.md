# Task 01B.56 — Staff Administration, Role Management & Account Recovery
## Phase 1 — Comprehensive Inspection & Gap Analysis Report

**Repository:** `zevats/raviNarayana-Erp`  
**Branch:** `master`  
**Execution Date:** 2026-10-23  
**Status:** `PHASE 1 INSPECTION COMPLETED`

---

## 1. Architectural Inspection & Existing Foundation

Before designing or modifying any application code, an exhaustive inspection of the existing codebase was conducted across schemas, services, authentication flows, session handling, RBAC permissions, audit logging, and UI routing.

### A. Current Identity & Account Schema
- **`staff_users` table:**
  - Fields: `id`, `username`, `email`, `full_name`, `password_hash`, `role`, `is_active`, `created_at`, `updated_at`, `last_login_at`.
  - Indexes: Case-insensitive unique indexes on `lower(username)` and `lower(email)`, index on `role`, index on `is_active`.
  - Passwords: 12 bcrypt salt rounds, minimum 12 characters.
- **`sessions` table:**
  - Fields: `id`, `token_hash` (SHA-256 digest at rest, 64-hex chars), `staff_id` (FK to `staff_users`), `expires_at`, `created_at`, `ip_address`, `user_agent`.
  - Sessions are strictly hashed at rest; raw bearer cookies are never stored.
- **`password_resets` table (SQLite Migration V9 / Drizzle Schema L526-L542):**
  - Fields: `id`, `staff_id`, `token_hash` (SHA-256 of 256-bit cryptographically secure token), `expires_at`, `used_at`, `created_at`.
  - Single-use, 1-hour expiry, unique index on `token_hash`.
- **`audit_logs` table:**
  - Fields: `id`, `actor_id`, `actor_username`, `action`, `target_type`, `target_id`, `metadata` (sanitized with secret stripping), `ip_address`, `created_at`.
- **`login_attempts` & `session_preemptions`:**
  - Multi-tier brute-force rate limiting (IP-based, account+IP, and distributed velocity).
  - Single active session register with atomic preemptions logged in `session_preemptions`.

### B. Current RBAC & Permissions Architecture
- Defined in `apps/erp/src/server/authorization/permissions.ts`:
  - 5 Canonical Roles: `SUPER_ADMIN`, `OPERATIONS_MANAGER`, `ACCOUNTANT`, `KITCHEN_OPERATIONS`, `DELIVERY_PERSON`.
  - Staff Permissions:
    - `staff.read`: Possessed by `SUPER_ADMIN` and `OPERATIONS_MANAGER`.
    - `staff.create`: Possessed only by `SUPER_ADMIN`.
    - `staff.update`: Possessed only by `SUPER_ADMIN`.
    - `staff.deactivate`: Possessed only by `SUPER_ADMIN`.
    - `staff.assign_role`: Possessed only by `SUPER_ADMIN`.
- Server-side assertion: `requirePermission(actor, permission, context)` fails closed, records security audit event on failure, and throws `AuthorizationError(403)`.
- Request resolution: `resolveUserFromRequest` validates session via `validateSessionDetailed`, which queries `JOIN staff_users u ON s.staff_id = u.id WHERE u.is_active = 1`.

### C. Current Backend Staff Service (`staffService.ts`)
- `listStaffUsers(actor)`: Lists staff users (requires `staff.read`).
- `getStaffUserById(actor, targetId)`: Retrieves single staff user (requires `staff.read` or self).
- `createStaffUser(actor, input)`: Provisions account with bcrypt hash (requires `staff.create` and `staff.assign_role`).
- `updateStaffRole(actor, targetId, newRole)`: Changes role (requires `staff.assign_role`, protects sole super-admin).
- `setStaffActiveStatus(actor, targetId, isActive)`: Activates/deactivates account (requires `staff.deactivate`, protects sole super-admin, deletes active sessions from `sessions` table).
- `resetStaffPassword(actor, targetId, newPassword)`: Direct password reset by administrator (requires `staff.update`, wipes sessions).
- `updateStaffProfile(actor, targetId, input)`: Updates full name or email (requires `staff.update` or self).

---

## 2. Existing vs. Missing Gap Matrix

| Component / Capability | Status in Repository | Source Evidence | Severity & Gap Detail |
| :--- | :---: | :--- | :--- |
| **Backend Staff Service Methods** | **Complete & Verified** | [`staffService.ts:1-451`](file:///apps/erp/src/server/staff/staffService.ts) | Core functions exist and are covered by `tests/rbac_staff_foundation.test.ts` (120/120 passing). |
| **Staff HTTP API Routes (`/api/staff`)** | **MISSING** | [`apps/erp/src/app/api/`](file:///apps/erp/src/app/api) | **CRITICAL GAP.** No HTTP endpoints exist for staff listing, creation, role change, deactivation, or profile updates. Frontend has no API to interact with `staffService`. |
| **Staff Management Web UI (`/staff`)** | **MISSING** | [`apps/erp/src/app/(management)/`](file:///apps/erp/src/app/(management)) | **HIGH GAP.** No `/staff` management page exists. Super Admin and Operations Manager cannot view or manage staff in the browser. |
| **Sidebar Navigation Link** | **MISSING** | [`ErpShell.tsx:38-74`](file:///apps/erp/src/components/layout/ErpShell.tsx) | **HIGH GAP.** `Staff Administration` is completely omitted from `NAV_ITEMS`. |
| **Privilege Escalation Guard** | **PARTIALLY IMPLEMENTED** | [`staffService.ts:192-250`](file:///apps/erp/src/server/staff/staffService.ts#L192-L250) | **HIGH GAP.** `updateStaffRole` and `createStaffUser` check `staff.assign_role` but do not verify if `actor.role === 'SUPER_ADMIN'` before granting `SUPER_ADMIN`. Any future delegation of `staff.assign_role` could allow privilege escalation. |
| **Admin-Initiated Recovery Link** | **MISSING** | [`staffService.ts:327-375`](file:///apps/erp/src/server/staff/staffService.ts#L327-L375) | **MEDIUM GAP.** Only direct password reset (`resetStaffPassword`) exists, requiring the admin to know/set a password. Phase 3 mandates an admin-initiated recovery link dispatch so staff can securely set their own password without exposing plaintext credentials. |
| **Staff 360° Audit Trail Query** | **MISSING** | [`audit.ts:137-177`](file:///apps/erp/src/server/audit/audit.ts#L137-L177) | **MEDIUM GAP.** `getAuditLogsAsync` only filters by `actorId`. Events where `target_id = targetUserId` (e.g. `staff.created`, `staff.role_assigned`, `staff.deactivated`) cannot be retrieved for a specific staff account. |
| **Immediate Session Invalidation upon Deactivation** | **Complete & Verified** | [`staffService.ts:303-305`](file:///apps/erp/src/server/staff/staffService.ts#L303-L305), [`auth.ts:414`](file:///apps/erp/src/server/authentication/auth.ts#L414) | Atomic `DELETE FROM sessions WHERE staff_id = ?` executed on deactivation; `validateSessionDetailed` additionally checks `u.is_active = 1`. |
| **Preservation of Operational History** | **Complete & Verified** | Schema definitions & FK constraints | All operational tables (`financial_transactions`, `invoices`, `daily_meal_plans`, `delivery_tasks`) reference `staff_users(id)` with `ON DELETE RESTRICT` or preserve rows upon account deactivation. |
| **Self-Service Password Recovery Backend** | **Complete & Verified** | [`auth.ts:705-820`](file:///apps/erp/src/server/authentication/auth.ts#L705-L820) | 256-bit cryptographically secure token, 1-hour expiry, single-use `used_at`, session revocation on completion, timing-safe non-disclosure. |
| **Self-Service Password Recovery UI** | **Complete & Verified** | [`LoginForm.tsx:28-657`](file:///apps/erp/src/modules/auth/components/LoginForm.tsx) | Embedded inside `LoginForm.tsx` with dedicated steps: `FORGOT` (request link) and `RESET` (enter new password with token). |
| **Dedicated Recovery Page Routes (`/forgot-password`, `/reset-password`)** | **MISSING** | [`apps/erp/src/app/(auth)/`](file:///apps/erp/src/app/(auth)) | **LOW GAP.** Direct navigation to `/forgot-password` or `/reset-password` produces a 404 because recovery is only embedded on `/login`. |

---

## 3. Confirmed Scope of Work for Phase 2–5

### A. Backend Services Hardening (`apps/erp/src/server/staff/staffService.ts`)
1. **Privilege Escalation Prevention:**
   - In `updateStaffRole`: Reject any attempt by a non-`SUPER_ADMIN` to assign `SUPER_ADMIN`.
   - In `createStaffUser`: Reject any attempt by a non-`SUPER_ADMIN` to create a `SUPER_ADMIN`.
2. **Admin-Initiated Recovery Link Dispatch (`initiateStaffPasswordRecovery`):**
   - Dispatches a single-use 256-bit password recovery link to the staff member's registered email via the configured email adapter.
   - Requires `staff.update`.
   - Rejects deactivated accounts until reactivated.
   - Emits tamper-evident audit log `staff.recovery_initiated` without logging credentials.
3. **Staff 360° Audit History Query (`getStaffAuditHistory`):**
   - Retrieves audit events where `target_id = staffId OR actor_id = staffId`.
   - Requires `audit.read` or `staff.read` (or self-lookup).
4. **Enhanced Staff Filtering (`listStaffUsers`):**
   - Accept optional filter parameters: `role?: StaffRole`, `isActive?: boolean`, `search?: string`.

### B. HTTP API Routes (`apps/erp/src/app/api/staff/`)
1. `GET /api/staff`: List staff accounts with `role`, `status`, `search` filters. Requires `staff.read`.
2. `POST /api/staff`: Provision new staff account. Requires `staff.create` and `staff.assign_role`.
3. `GET /api/staff/[id]`: Retrieve single staff member details. Requires `staff.read` or self.
4. `PATCH /api/staff/[id]`: Update profile fields (`fullName`, `email`). Requires `staff.update` or self.
5. `PUT /api/staff/[id]/role`: Change role (`newRole`). Requires `staff.assign_role`.
6. `PUT /api/staff/[id]/status`: Activate or deactivate account (`isActive`). Requires `staff.deactivate`.
7. `POST /api/staff/[id]/recovery`: Dispatch password recovery email. Requires `staff.update`.
8. `POST /api/staff/[id]/reset-password`: Emergency direct reset by `SUPER_ADMIN`. Requires `staff.update`.
9. `GET /api/staff/[id]/history`: Retrieve recent audit history for account. Requires `staff.read` or self.

### C. Management Web UI (`apps/erp/src/app/(management)/staff/`)
1. **Route Segment:** `apps/erp/src/app/(management)/staff/page.tsx` (Protected RSC asserting `staff.read`).
2. **Sidebar Navigation:** Update `ErpShell.tsx` to conditionally display `Staff Administration` for users with `staff.read`.
3. **Interactive Components (`apps/erp/src/modules/staff/`):**
   - `StaffDirectoryView.tsx`: Search bar, Role filter dropdown, Status filter pills, Summary KPI cards (Total, Active, Deactivated, Super Admins).
   - `StaffTable.tsx`: Staff account listing with initials avatar, name, username, email, role badge, active status pill, last login, and action menu.
   - Modals:
     - `CreateStaffModal.tsx`: Account creation with username regex, email validation, role select, password strength check.
     - `EditStaffModal.tsx`: Edit full name and email.
     - `ChangeRoleModal.tsx`: Role transition with confirmation prompt and sole super-admin warning.
     - `DeactivateStaffModal.tsx`: Destructive confirmation with session wipe warning and sole super-admin block.
     - `StaffHistoryModal.tsx`: View 360° security and operational audit trail for that staff account.

### D. Recovery Page Wrappers (`apps/erp/src/app/(auth)/`)
- `apps/erp/src/app/(auth)/forgot-password/page.tsx`: Redirects cleanly to `/login`.
- `apps/erp/src/app/(auth)/reset-password/page.tsx`: Redirects cleanly to `/login?token=...`.

### E. Comprehensive Automated Test Suite (`tests/task01b_56_staff_admin.test.ts`)
- Suite 1: Staff Directory & Filtering (`listStaffUsers` with search, role, status filters).
- Suite 2: Account Creation & Validation (regex, uniqueness, bcrypt 12 rounds, audit logging).
- Suite 3: Privilege Escalation & Role Assignment Integrity (prevent non-admin granting `SUPER_ADMIN`).
- Suite 4: Sole Super-Admin Protection (prevent demoting or deactivating the last active `SUPER_ADMIN`).
- Suite 5: Deactivation & Immediate Session Invalidation (verify `sessions` deletion and fail-closed authentication).
- Suite 6: Admin-Initiated Recovery vs Direct Reset (token generation, email dispatch, secret non-disclosure).
- Suite 7: Self-Service Account Recovery (timing-safe non-disclosure, single-use, session invalidation).
- Suite 8: Operational History Preservation (verify transactions, invoices, and meal plans remain intact after staff deactivation).
- Suite 9: Server-Side RBAC Enforcement on All API Routes (verify 401 unauthenticated and 403 forbidden).
- Suite 10: PostgreSQL and SQLite compatibility check.
- Safety check: Verify `data/erp.db` is strictly untouched.

---

## 4. Non-Negotiable Safety & Immutability Rules
- Strict preservation of `data/erp.db` length and timestamp.
- No connections to `ravi-narayana-erp-phase01b-test`.
- Zero git commits, pushes, resets, rebases, or stashes.
- Preservation of all existing uncommitted changes from Tasks 01B.37 through 01B.55.


---

## 5. Phase 2–5 Implementation & Verification Summary

**Execution Status:** `COMPLETED AND VERIFIED`

### A. Artifacts Created & Modified
1. **Types (`apps/erp/src/types/index.ts`):** Added `StaffListFilter` and `StaffStats`.
2. **Backend Service (`apps/erp/src/server/staff/staffService.ts`):**
   - Privilege escalation defense: Non-super-admins cannot provision or grant `SUPER_ADMIN`.
   - Sole super-admin guard: Rejects demotion or deactivation if active `SUPER_ADMIN` count $\le 1$.
   - Admin-initiated password recovery: Dispatches single-use 256-bit email link via `initiateStaffPasswordRecovery`.
   - Direct password reset: Restricted strictly to `SUPER_ADMIN`.
   - 360° audit history query: `getStaffAuditHistory` matches `target_id = ? OR actor_id = ?`.
   - Multi-field filtering and real-time aggregate stats: `listStaffUsers` and `getStaffStats`.
3. **HTTP API Routes (`apps/erp/src/app/api/staff/`):**
   - `GET /api/staff`
   - `POST /api/staff`
   - `GET /api/staff/[id]`
   - `PATCH /api/staff/[id]`
   - `PUT /api/staff/[id]/role`
   - `PUT /api/staff/[id]/status`
   - `POST /api/staff/[id]/recovery`
   - `POST /api/staff/[id]/reset-password`
   - `GET /api/staff/[id]/history`
4. **Management Web UI:**
   - `apps/erp/src/app/(management)/staff/page.tsx`
   - `apps/erp/src/modules/staff/components/StaffDirectoryView.tsx`
   - `apps/erp/src/modules/staff/components/StaffModals.tsx`
   - `apps/erp/src/components/layout/ErpShell.tsx` (navigation link conditionally exposed to `SUPER_ADMIN` and `OPERATIONS_MANAGER`)
5. **Auth Redirect Entrypoints:**
   - `apps/erp/src/app/(auth)/forgot-password/page.tsx`
   - `apps/erp/src/app/(auth)/reset-password/page.tsx`
6. **Automated Test Suite:**
   - `tests/task01b_56_staff_admin.test.ts`

### B. Test Verification Results
- **Targeted Suite (`npm run test:task56`):** **82 PASSED, 0 FAILED** (100% pass rate).
- **Full Monorepo Suite (`npm test`):** **19/19 TEST SUITES PASSED, 0 FAILED** (Over 1,720 tests).
- **Next.js Production Build:** Completed successfully with exit code 0.

### C. Immutability & Safety Statement
- Primary SQLite database `data/erp.db` (1,388,544 bytes, LastWriteTime: 21-10-2026 13:33:43) and `-wal`/`-shm` files remained strictly untouched throughout all test executions.
- Neon rehearsal database `ravi-narayana-erp-phase01b-test` was never connected to.
- All uncommitted work across Tasks 01B.37 through 01B.55 preserved with zero Git commits, pushes, resets, rebases, or discards.
