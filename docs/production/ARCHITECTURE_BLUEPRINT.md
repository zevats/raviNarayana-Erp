# Ravinarayan ERP & Website — Production Architecture Blueprint

**Target Systems:** Public Website (`ravinarayan.in`) & Management ERP (`erp.ravinarayan.in`)  
**Architecture Style:** Decoupled Modular Monolith with Shared Design Tokens  
**Production Data Layer:** Managed PostgreSQL Cluster with Connection Pooling  
**Target Runtimes:** Node.js LTS (v20.x / v22.x) on Containerized Cloud Infrastructure  

---

## 1. High-Level System Architecture

```text
                                Internet (Users & Clients)
                                            │
                                            ▼
                      Cloudflare Edge / Reverse Proxy (Strict SSL)
                                            │
                     ┌──────────────────────┴──────────────────────┐
                     │                                             │
             Host: ravinarayan.in                         Host: erp.ravinarayan.in
                     │                                             │
                     ▼                                             ▼
        ┌─────────────────────────┐                   ┌─────────────────────────┐
        │   Public Website App    │                   │     Management ERP      │
        │      (apps/website)     │                   │       (apps/erp)        │
        │                         │                   │                         │
        │ • Botanical Luxury UI   │                   │ • Next.js App Router    │
        │ • Next.js App Router    │                   │ • Server-Side RBAC      │
        │ • Three.js 3D Showcase  │                   │ • Async Service Layer   │
        │ • Static Room Catalog   │                   │ • Rate-Limiting Engine  │
        │ • Lead Contact Form     │                   │ • Audit Logging Engine  │
        └────────────┬────────────┘                   └────────────┬────────────┘
                     │                                             │
                     │                 Shared Design Tokens        │
                     └──────────────────────────┬──────────────────┘
                                                │
                                    ┌───────────▼───────────┐
                                    │    @ravinarayan/brand │
                                    │  (packages/brand)     │
                                    └───────────────────────┘
                                                │
                                                ▼ (ERP Only)
                                    ┌───────────────────────┐
                                    │  PgBouncer Connection │
                                    │        Pooler         │
                                    └───────────┬───────────┘
                                                │
                                                ▼
                                    ┌───────────────────────┐
                                    │   Managed PostgreSQL  │
                                    │   (Primary Database)  │
                                    │  • 15 Relational      │
                                    │    Tables             │
                                    │  • Row-Level Locks    │
                                    │  • Automated Backups  │
                                    └───────────────────────┘
```

---

## 2. Monorepo & Application Boundaries

### 2.1 Monorepo Composition
The repository is structured as an npm workspaces monorepo:
- `apps/website`: Standalone public-facing web application. Zero backend database dependencies.
- `apps/erp`: Standalone internal operations ERP. Houses business services, authentication, and database access.
- `packages/brand`: Shared TypeScript token library providing unified colors, typography scales, spacing, radii, and shadows to both applications.
- `packages/config`: Shared configuration templates (TypeScript, ESLint, PostCSS).

### 2.2 Strict Routing & Security Isolation
1. **Domain-Level Partitioning:**
   - Public Website is served exclusively from `https://ravinarayan.in`.
   - Management ERP is served exclusively from `https://erp.ravinarayan.in`.
2. **Zero Internal Route Cross-Talk:**
   - `apps/website` contains zero `/erp` or `/api/erp` route definitions. Any attempt to access `/erp` on the marketing website returns HTTP 404.
   - `apps/erp` serves administrative routes only (`/login`, `/dashboard`, `/rooms`, `/residents`, `/finance`, `/kitchen`, `/delivery`). Requests to the ERP root (`/`) redirect unauthenticated visitors to `/login` and authenticated staff to `/dashboard`.
3. **Cookie Scope Isolation:**
   - The session cookie `rn_erp_session` is configured with `Domain=erp.ravinarayan.in; Path=/; HttpOnly; Secure; SameSite=Lax`. It is never transmitted to or readable by `ravinarayan.in`.

---

## 3. Data Access Architecture: PostgreSQL Engine Evaluation

### 3.1 Technology Comparison

| Evaluation Criteria | Option A: Drizzle ORM *(Recommended)* | Option B: Prisma ORM | Option C: Native Driver (`postgres.js` / `pg`) |
| :--- | :--- | :--- | :--- |
| **Runtime Overhead** | Minimal. Zero-dependency TypeScript-to-SQL compiler. | Heavy. Requires external binary query engine (`prisma-query-engine`). | Lowest. Pure JavaScript driver. |
| **Serverless & Edge Suitability** | Outstanding. Instant cold starts (~5ms). | Poor. Engine binary extraction adds 300ms–1500ms cold-start latency. | Outstanding. Direct socket connections. |
| **Transaction & Locking Support** | First-class: `tx.select().for('update')`. | Supported, but interactive transactions hold connection pools. | Manual SQL string queries (`BEGIN`, `FOR UPDATE`). |
| **Type Safety & Schema Authoring** | 100% pure TypeScript schemas. Single language definition. | Proprietary DSL (`schema.prisma`) requiring code generation. | Manual interface declarations; prone to drift. |
| **Migration Tooling** | `drizzle-kit` generates standard, human-readable SQL files. | Powerful `prisma migrate`, but tightly coupled to Prisma engine. | Requires third-party runner (`node-pg-migrate` or `db-migrate`). |
| **Alignment with Existing Codebase** | High. Existing services use SQL-like structure with prepared statements. | Low. Forces radical rewrite to Prisma client object syntax. | High, but introduces high boilerplate for result mapping. |

### 3.2 Architectural Recommendation: **Drizzle ORM**
We recommend **Drizzle ORM** with the `postgres` driver (or `@neondatabase/serverless` if deploying to serverless edge functions).

**Rationale:**
1. **Lightweight & High Performance:** Drizzle compiles directly to raw SQL without intermediate binary translation or memory-heavy query plans.
2. **First-Class Transaction Semantics:** Seamlessly supports row-level locking (`FOR UPDATE`) required to solve room capacity race conditions.
3. **Pure TypeScript Schemas:** Replaces SQLite `better-sqlite3` statements with typed schema objects without introducing an alien DSL.
4. **Transparent SQL Migrations:** Generates plain `.sql` migration scripts that can be inspected, audited, and executed via standard CI/CD pipelines.

---

## 4. Concurrency Control, Transactions & MVCC

In PostgreSQL, Multi-Version Concurrency Control (MVCC) allows concurrent transactions to read and write without global table locks. However, unconstrained concurrent writes create race conditions in physical inventory and financial balances.

### 4.1 Room Overbooking Defense (Row-Level Locking)
In the current SQLite implementation, checking bed availability and inserting an active stay occurs inside a file-level write lock. In PostgreSQL, this requires explicit row-level locking:

```typescript
// Proposed Drizzle Concurrency Guard in residentService.ts
export async function assignResidentToRoom(
  actor: AuthenticatedUser,
  input: CheckInInput
): Promise<ResidentStayRecord> {
  return await db.transaction(async (tx) => {
    // 1. Lock the room row to serialize concurrent assignments to this specific room
    const [room] = await tx
      .select()
      .from(rooms)
      .where(eq(rooms.id, input.roomId))
      .for("update"); // Row-level write lock

    if (!room || !room.isActive) {
      throw new Error(`Room is unavailable for check-in.`);
    }

    // 2. Count active stays under the locked room record
    const [{ count: activeOccupants }] = await tx
      .select({ count: count() })
      .from(residentStays)
      .where(and(
        eq(residentStays.roomId, input.roomId),
        eq(residentStays.status, "ACTIVE")
      ));

    if (activeOccupants >= room.capacity) {
      throw new Error(`Room ${room.roomNumber} is at full capacity (${activeOccupants}/${room.capacity} occupied).`);
    }

    // 3. Safe insert: impossible for a concurrent transaction to overbook
    const [stay] = await tx
      .insert(residentStays)
      .values({ ... })
      .returning();

    return stay;
  });
}
```

### 4.2 Financial Atomicity & Double-Entry Invariants
1. **Idempotency Keys:** Every mutation endpoint (`recordRentPayment`, `recordRentCharge`, `recordExpense`, `recordSecurityDeposit`) enforces a `UNIQUE` constraint on `idempotency_key`. Retried network requests return the original posted record without re-executing credit/debit operations.
2. **Reversals:** Original transactions are never deleted or modified in place (except setting `status = 'REVERSED'`). An opposite-signed `REVERSAL` record is inserted with a mandatory foreign key `reversal_of_id REFERENCES financial_transactions(id)`.
3. **Cashbook Totals Derived from Immutable Ledger:** Period revenue, collections, liabilities, and disbursements are calculated deterministically from posted transaction rows. No mutable cached balance rows exist that could desynchronize from the ledger.

---

## 5. Connection Pooling & Production Scaling

### 5.1 The Connection Limit Challenge
Next.js serverless functions or container autoscaling can spin up dozens of concurrent instances. Each instance creating multiple direct database connections will rapidly exhaust PostgreSQL's max connection limit (typically 50–100 on standard managed tiers).

### 5.2 PgBouncer Architecture
Deploy a connection pooler (**PgBouncer**) in **Transaction Mode**:
- Applications connect to PgBouncer on port `6543` (pooled port).
- PgBouncer multiplexes hundreds of application client connections over a compact pool of 10–20 actual database connections.
- Migration scripts and DDL statements connect directly to port `5432` (session mode) to support schema locks and advisory locks.

```text
Next.js Instance 1 ──┐
Next.js Instance 2 ──┼──> PgBouncer (Port 6543) ──> PostgreSQL Server (15 Conns)
Next.js Instance 3 ──┘   (Transaction Pooler)
```

---

## 6. Mobile Application Strategy & Blueprint

### 6.1 Requirements Evaluation
The primary mobile users of Ravinarayan ERP are:
1. **On-Property Staff:** Front desk and maintenance staff checking in residents, inspecting room inventory, and logging daily kitchen totals on mobile phones.
2. **Tiffin Delivery Couriers:** Couriers traveling on two-wheelers across Jhajjar, Yakubpur, and Reliance MET City to deliver hot meals to corporate residents and external customers.
3. **Future Residents:** Checking monthly rent balance, viewing statements, and toggling daily meal preferences.

### 6.2 Platform Architecture Comparison

| Dimension | Option A: Progressive Web App (PWA) *(Recommended)* | Option B: Native Mobile App (React Native / Flutter) |
| :--- | :--- | :--- |
| **Initial Cost & Effort** | **Minimal (1–2 weeks)**. Reuses 100% of existing Next.js App Router, Tailwind CSS, and brand tokens. | **High (8–12 weeks)**. Requires separate mobile codebase, navigation, state management, and API bridging. |
| **Distribution & Updates** | **Instant**. Deploys directly via web URL. Zero App Store or Google Play Store review delays. | **Delayed**. Requires Apple Developer Account (\$99/yr), Google Play Console (\$25), and 1–3 day app review cycles. |
| **Offline Capabilities** | Service Worker caches delivery manifests, routes, and resident contact numbers locally via IndexedDB. | Full native local SQLite/WatermelonDB storage. |
| **Camera & Hardware Access**| Modern HTML5 MediaDevices API supports QR code scanning for meal handovers. | Native camera SDKs. |
| **Push Notifications** | Web Push API (supported across modern Android Chrome and iOS 16.4+ Safari). | Native APNs (Apple) and FCM (Firebase Cloud Messaging). |
| **Maintenance Burden** | Single monorepo codebase. Bug fixes deploy immediately to all devices. | Multi-platform maintenance (iOS, Android, Web), SDK upgrade cycles, OS version breakage. |

### 6.3 Strategic Mobile Recommendation: **Phased PWA-First Rollout**
1. **Phase 1: Production PWA for Staff & Couriers (Launch Scope):**
   - Add Web App Manifest (`manifest.json`), service worker for static asset caching, and Apple Touch icons.
   - Design the Delivery Dashboard specifically for one-handed thumb interaction (completed in Phase 6).
   - Implement HTML5 QR scanner for instant delivery parcel handover proof.
2. **Phase 2: Resident Self-Service Portal (PWA):**
   - Lightweight, mobile-friendly resident dashboard for viewing rent receipts and meal opt-outs.
3. **Phase 3: Native App (Future Evaluation):**
   - Only build a native React Native application if background continuous GPS tracking or Bluetooth thermal receipt printing becomes an indispensable operational mandate.

---

## 7. Public Website vs Management ERP Architecture

### 7.1 Architecture Separation Matrix

| Dimension | Public Website (`apps/website`) | Management ERP (`apps/erp`) |
| :--- | :--- | :--- |
| **Audience** | Prospective residents, corporate guests, event planners. | Guesthouse owner, operations managers, accountants, kitchen staff, delivery drivers. |
| **Primary Goal** | Conversion, luxury showcase, room availability inquiries. | Operational execution, financial control, inventory management, meal fulfillment. |
| **Data Dependencies** | Static data catalogs (`roomsData.ts`, `siteConfig.ts`). | Live PostgreSQL relational database. |
| **Authentication** | Completely unauthenticated. Publicly indexed by search engines. | Strict session authentication (`rn_erp_session`), multi-layer rate limiting, RBAC. |
| **Rendering Strategy** | SSG (Static Site Generation) + ISR (Incremental Static Regeneration). | Dynamic SSR (Server-Side Rendering) with zero-cache mutating API routes. |
| **SEO & Indexing** | Open: `robots.txt` allows all crawling; generates dynamic `sitemap.xml`. | Closed: `X-Robots-Tag: noindex, nofollow` on all routes. Search indexing strictly blocked. |

---

## 8. Long-Term Architectural Roadmap (Phases 1–6)

```text
Phase 1: Foundation & PostgreSQL Migration
├── Managed PostgreSQL provisioning & Drizzle ORM schemas
├── Async service conversion with row-level locking
└── Git sanitization & security header enforcement

Phase 2: Operational Hardening & Production Tooling
├── Structured JSON logging with Winston / Pino
├── Sentry exception tracking & alerting
├── Uptime monitoring & health check probe (/api/health)
└── Automated database snapshot & recovery runbook

Phase 3: Mobile PWA & Courier Optimization
├── Web App Manifest & service worker offline cache
├── Camera-based QR code meal delivery proof
└── Low-bandwidth optimization for delivery routes

Phase 4: Finance & Resident Experience Enhancements
├── Fractional currency / GST minor unit migration
├── Automated PDF rent receipt and statement generation
├── Direct UPI dynamic payment QR generation on invoices
└── Self-service password reset via Resend transactional email

Phase 5: Resident Self-Service Portal
├── Resident authentication via phone OTP
├── Real-time rent ledger view & payment history
└── Resident-driven daily meal opt-out / dietary requests

Phase 6: Multi-Property Scaling (Enterprise Expansion)
├── Tenant isolation by property ID (supporting future branches)
├── Multi-property consolidated financial cashbook
└── Centralized commissary kitchen management
```
