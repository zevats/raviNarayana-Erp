# Task 01B.66 — Mobile App Foundation & PWA Implementation Report

**Repository:** `zevats/raviNarayana-Erp`  
**Branch:** `master`  
**Status:** Implementation Complete & Production Build Verified  
**Date:** 2026-10-24T15:40:00+05:30  
**Lead Engineer:** Senior ERP Architect, Mobile PWA Specialist & Application Security Lead  

---

## 1. Executive Summary & Architectural Direction

Task 01B.66 delivers the mobile application foundation for the Ravi Narayana PG & Tiffin ERP by implementing an installable, role-aware Progressive Web App (PWA) directly within the existing Next.js 14 monorepo architecture. 

In strict alignment with the prompt's product direction:
- **Single Role-Aware Monolith:** Rather than building disparate apps or bifurcating the backend, a single responsive Next.js application serves both desktop management and mobile field operations. Server-authoritative session evaluation governs navigation views, routing, and privilege boundaries.
- **PWA-First Distribution:** Deployed as a standards-compliant installable PWA with Web App Manifest, scoped Service Worker, offline fallback shell, and branded app icons (`192x192`, `512x512`, `maskable 512x512`, and `180x180 apple-touch-icon`). Android TWA or native packaging remains an optional distribution wrapper that requires zero changes to the underlying business engine.
- **Strict Zero-Cache Security Boundary:** Under explicit security mandates, **no authenticated API data (`/api/*`), resident identities, financial transactions, daily closing records, or private KYC documents are ever written to browser `CacheStorage`**. The Service Worker caches strictly the static presentation shell (`/offline`, compiled CSS/JS chunks, and brand assets).
- **Driver Workflow as Priority One:** Delivery personnel (`DELIVERY_PERSON`) are automatically routed to `/delivery` upon authentication and are provided a focused, thumb-friendly mobile bottom navigation bar (`Stops`, `Offline Sync`, `Sign Out`).
- **Resilient Offline Queueing & Conflict Handling:** When mobile connectivity drops during doorstep deliveries, delivery completions (with CASH/UPI collection) and exception reports are safely enqueued in client-side durable `localStorage` with cryptographic idempotency keys. Upon reconnection, actions are replayed in batch against `/api/delivery/sync` with server-side conflict detection.

---

## 2. PWA Assets, Web App Manifest & Service Worker Architecture

### 2.1 Brand Icon Assets
High-resolution, vector-crisp PNG icons were generated following the authentic Ravi Narayana brand identity (Deep Botanical Forest Evergreen `#1A2E20` background, Warm Brass `#B58A57` luxury borders, and White typography):
- [`apps/erp/public/icons/icon-192.png`](file:///c:/Users/Rishabh/Desktop/raviNarayana-Erp/apps/erp/public/icons/icon-192.png): 192x192 PNG for standard Android home screen shortcuts.
- [`apps/erp/public/icons/icon-512.png`](file:///c:/Users/Rishabh/Desktop/raviNarayana-Erp/apps/erp/public/icons/icon-512.png): 512x512 PNG for high-DPI splash screens and install dialogs.
- [`apps/erp/public/icons/maskable-icon-512.png`](file:///c:/Users/Rishabh/Desktop/raviNarayana-Erp/apps/erp/public/icons/maskable-icon-512.png): 512x512 PNG with 20% safe-zone padding for adaptive Android icons (squircle, round, teardrop).
- [`apps/erp/public/icons/apple-touch-icon.png`](file:///c:/Users/Rishabh/Desktop/raviNarayana-Erp/apps/erp/public/icons/apple-touch-icon.png): 180x180 PNG tailored for iOS Safari home screen bookmarks.

### 2.2 Web App Manifest Specifications
Standardized manifest files were created in both static and App Router metadata route formats:
- Static Manifests: [`apps/erp/public/manifest.webmanifest`](file:///c:/Users/Rishabh/Desktop/raviNarayana-Erp/apps/erp/public/manifest.webmanifest) and [`apps/erp/public/manifest.json`](file:///c:/Users/Rishabh/Desktop/raviNarayana-Erp/apps/erp/public/manifest.json).
- Next.js 14 Metadata Route: [`apps/erp/src/app/manifest.ts`](file:///c:/Users/Rishabh/Desktop/raviNarayana-Erp/apps/erp/src/app/manifest.ts).

Key Manifest Attributes:
```json
{
  "name": "Ravi Narayana PG & Tiffin ERP",
  "short_name": "RN ERP",
  "start_url": "/",
  "scope": "/",
  "display": "standalone",
  "orientation": "portrait-primary",
  "background_color": "#FAF8F5",
  "theme_color": "#1A2E20",
  "shortcuts": [
    {
      "name": "Driver Stops",
      "short_name": "Deliveries",
      "description": "View today's assigned meal delivery run",
      "url": "/delivery"
    }
  ]
}
```

### 2.3 Scoped Service Worker Security Boundary ([`apps/erp/public/sw.js`](file:///c:/Users/Rishabh/Desktop/raviNarayana-Erp/apps/erp/public/sw.js))
The Service Worker enforces an uncompromising isolation policy between static presentation shell and live operational data:
1. **Mutation Bypass:** All non-GET requests (`POST`, `PUT`, `DELETE`, `PATCH`) bypass the Service Worker immediately without inspection.
2. **Forbidden Sensitive URLs:** Any request starting with or containing `/api/`, `/storage/`, `/documents/`, `/auth/`, `/kyc/`, or `/closing/` is strictly passed through to the live network. If the device is offline, these requests fail with browser network errors, allowing application-level error handlers and offline queues to manage persistence safely.
3. **Static Shell Pre-caching:** Pre-caches `/offline`, `/logo.png`, `/icons/*`, and the webmanifest during the `install` phase.
4. **Stale-While-Revalidate for Bundles:** Static compiled Next.js assets (`/_next/static/*`, `/icons/*`, and fonts) are served from cache for instant startup and revalidated in the background.
5. **Navigation Fallback:** Navigational requests (`request.mode === 'navigate'`) attempt network fetch first; if the network is down, they gracefully serve the pre-cached `/offline` shell.

### 2.4 PWA Registration & Install Experience ([`PwaRegistrar.tsx`](file:///c:/Users/Rishabh/Desktop/raviNarayana-Erp/apps/erp/src/components/pwa/PwaRegistrar.tsx))
Mounted globally in [`apps/erp/src/app/layout.tsx`](file:///c:/Users/Rishabh/Desktop/raviNarayana-Erp/apps/erp/src/app/layout.tsx):
- Safely registers `/sw.js` with `{ scope: "/" }` on window load.
- Intercepts `beforeinstallprompt` to present a non-intrusive, dismissible "Install Mobile App" banner for drivers and managers.
- Detects `standalone` display mode and hides installation banners when already installed.
- Listens to `window.online` and `window.offline` to render subtle toast notices when connectivity changes.

---

## 3. Role-Aware Navigation & Mobile Shell Implementation

### 3.1 Server-Authoritative Landing & Redirection
To ensure field delivery personnel never encounter management-only dashboards or empty layouts:
- In [`apps/erp/src/app/page.tsx`](file:///c:/Users/Rishabh/Desktop/raviNarayana-Erp/apps/erp/src/app/page.tsx): Users with role `DELIVERY_PERSON` are automatically redirected to `/delivery`, while other roles proceed to `/dashboard`.
- In [`apps/erp/src/app/(management)/dashboard/page.tsx`](file:///c:/Users/Rishabh/Desktop/raviNarayana-Erp/apps/erp/src/app/(management)/dashboard/page.tsx): If a delivery person navigates directly to `/dashboard`, the server component validates session credentials and redirects immediately to `/delivery`.

### 3.2 Mobile Header & Real-Time Sync Indicators ([`ErpShell.tsx`](file:///c:/Users/Rishabh/Desktop/raviNarayana-Erp/apps/erp/src/components/layout/ErpShell.tsx))
- The mobile top header is padded with `pt-safe` to avoid status bar and notch overlap.
- Displays the authentic brand logo, live date, and an interactive **Offline Status Badge** displaying live connectivity (`Online` vs `Offline`) and the count of pending offline actions (`Queue: N`).

### 3.3 Touch-Optimized Mobile Bottom Navigation Bar ([`ErpShell.tsx`](file:///c:/Users/Rishabh/Desktop/raviNarayana-Erp/apps/erp/src/components/layout/ErpShell.tsx))
Positioned fixed at the bottom with `pb-safe` and high z-index (`z-40`), the bottom bar renders role-tailored interfaces:
1. **For `DELIVERY_PERSON`:**
   - **Stops (`/delivery`):** Direct one-tap access to today's assigned stops and customer delivery cards.
   - **Offline Sync (`/offline`):** Direct navigation to the offline console, displaying a prominent amber notification badge if un-synced items are pending in local custody.
   - **Sign Out:** One-tap authenticated session termination calling `/api/auth/logout` with safe session clearing.
2. **For Management Roles (`SUPER_ADMIN`, `OPERATIONS_MANAGER`, `ACCOUNTANT`, `KITCHEN_STAFF`):**
   - Renders 4 primary sections (`Dashboard`, `Residents`, `Kitchen`, `Finance`).
   - "More" button that smoothly toggles the slide-out navigation drawer for remaining management routes (`Staff`, `Tiffin`, `Rooms`).

### 3.4 Responsive Viewport & Touch Ergonomics
- Updated [`apps/erp/src/app/layout.tsx`](file:///c:/Users/Rishabh/Desktop/raviNarayana-Erp/apps/erp/src/app/layout.tsx) with Next.js 14 `viewport` export:
  ```typescript
  export const viewport: Viewport = {
    width: "device-width",
    initialScale: 1,
    maximumScale: 5,
    userScalable: true,
    viewportFit: "cover",
    themeColor: "#1A2E20",
  };
  ```
- Added utility classes in [`apps/erp/src/styles/globals.css`](file:///c:/Users/Rishabh/Desktop/raviNarayana-Erp/apps/erp/src/styles/globals.css):
  - `.pb-safe`: `padding-bottom: env(safe-area-inset-bottom, 0px)`
  - `.pt-safe`: `padding-top: env(safe-area-inset-top, 0px)`
  - `.min-h-screen-safe`: dynamic viewport calculation (`100dvh`)
  - `touch-action: manipulation` and `overscroll-behavior-y: contain` to prevent rubber-banding on iOS Safari and eliminate 300ms double-tap delays.
  - Interactive touch targets maintained at $\ge 48\text{px}$ minimum height.

---

## 4. Driver Field Workflow & Offline Resilience

### 4.1 Driver Stops Execution View ([`apps/erp/src/app/(management)/delivery/page.tsx`](file:///c:/Users/Rishabh/Desktop/raviNarayana-Erp/apps/erp/src/app/(management)/delivery/page.tsx))
Delivery personnel are presented with high-contrast, card-based stop items:
- Customer name, room number/floor (for residents), full street address, and phone number with one-tap `tel:` calling.
- Dietary preferences and spice tags (`REGULAR`, `JAIN`, `LOW_SPICE`).
- Payment collection badge (`PAID`, `DOORSTEP_COLLECTION`, `CASH`, `UPI`).

### 4.2 Offline Queueing for Deliveries & Exceptions
In [`apps/erp/src/app/(management)/delivery/page.tsx`](file:///c:/Users/Rishabh/Desktop/raviNarayana-Erp/apps/erp/src/app/(management)/delivery/page.tsx):
- `handleCompleteDelivery`: If the network request fails and `!navigator.onLine`, the action is enqueued locally via `enqueueDeliveryAction("COMPLETE_DELIVERY", taskId, payload)`. The UI displays an immediate confirmation: `Network issue. Saved offline for [Recipient].`.
- `handleReportException`: If reporting an exception while offline, `enqueueDeliveryAction("REPORT_EXCEPTION", taskId, payload)` stores the exception type and reason locally, guaranteeing the driver can proceed to the next stop without disruption.

### 4.3 Offline Queue Engine ([`apps/erp/src/modules/delivery/offlineQueue.ts`](file:///c:/Users/Rishabh/Desktop/raviNarayana-Erp/apps/erp/src/modules/delivery/offlineQueue.ts))
- Storage Key: `erp_delivery_offline_queue_v1` in `localStorage`.
- Idempotency Key Format: `offline_${taskId}_${timestamp}_${randomSuffix}`.
- Supported Actions: `COMPLETE_DELIVERY`, `REPORT_EXCEPTION`, `RECORD_COLLECTION`.
- Synchronization (`processOfflineQueue`): Dispatches all pending items to `/api/delivery/sync`. Handles per-item results:
  - `SYNCED` / `IDEMPOTENT_IGNORED`: Purged from local queue.
  - `CONFLICT`: Tagged with server reason (e.g. reassignment to another driver or already delivered) so the driver can inspect the conflict.
  - `FAILED`: Preserved with incremented `retryCount` for future retry.

### 4.4 Offline Fallback Console ([`apps/erp/src/app/offline/page.tsx`](file:///c:/Users/Rishabh/Desktop/raviNarayana-Erp/apps/erp/src/app/offline/page.tsx))
Accessible at `/offline` and displayed automatically when disconnected:
- Status banner with offline alert icon.
- Delivery Driver Protection Notice: Informs drivers that all recorded actions remain completely secure in device memory.
- Real-time queued actions count (`Pending Queued Actions: N`).
- "Sync Now" button: Triggers `processOfflineQueue()` immediately upon reconnecting.
- "Retry Connection" button: Reloads the active page.

---

## 5. Verification & Regression Testing

### 5.1 Dedicated Task 01B.66 Test Suite (`tests/task01b_66_mobile_pwa.test.ts`)
An automated test suite was constructed and executed using isolated ephemeral databases and filesystem validation:
- **Test Suite 1: PWA Manifest & App Metadata Invariants (18 tests)**
  - Verified presence and valid JSON structure of `manifest.webmanifest` and `manifest.json`.
  - Verified `manifest.ts` export consistency.
  - Verified PNG signature (`0x89504E470D0A1A0A`) and IHDR dimensions across `icon-192.png` (192x192), `icon-512.png` (512x512), `maskable-icon-512.png` (512x512), and `apple-touch-icon.png` (180x180).
- **Test Suite 2: Service Worker Security & Caching Isolation (11 tests)**
  - Verified explicit bypass of `/api/*`, `/storage/*`, `/documents/*`, `/auth/*`, `/kyc/*`, `/closing/*`.
  - Verified strict bypass of all non-GET methods.
  - Verified static shell pre-caching (`/offline`, brand icons, logo).
  - Verified navigational fallback to pre-cached `/offline`.
- **Test Suite 3: Offline Fallback Page & PWA Registrar Invariants (10 tests)**
  - Verified offline page integration with `getOfflineQueue` and `processOfflineQueue`.
  - Verified driver local protection notice and Sync Now trigger.
  - Verified `PwaRegistrar` registration of `/sw.js` and `beforeinstallprompt` interception.
  - Verified `globals.css` utilities (`pb-safe`, `pt-safe`, `touch-action: manipulation`).
- **Test Suite 4: Role-Aware Navigation & Bottom Bar Invariants (5 tests)**
  - Verified delivery person isolation in `ErpShell.tsx`.
  - Verified mobile bottom bar stops and offline sync links.
  - Verified role-aware redirects from root `/` and `/dashboard` to `/delivery`.
- **Test Suite 5: Offline Queue Operations & Idempotency Key Semantics (6 tests)**
  - Verified versioned localStorage key and UUID-based idempotency key generation.
  - Verified offline enqueueing for both `COMPLETE_DELIVERY` and `REPORT_EXCEPTION`.
- **Test Suite 6: Database Integration & Offline Action Synchronization (27 tests)**
  - Verified synchronization of queued `COMPLETE_DELIVERY` updating task status to `DELIVERED` and recording collected cash.
  - Verified idempotent replay returning `IDEMPOTENT_IGNORED` without duplicating collections.
  - Verified queued `REPORT_EXCEPTION` transitioning task to `EXCEPTION`.
  - Verified conflict detection on attempting exception on already delivered task (`CONFLICT`).
  - Verified ownership conflict rejection when driver attempts to sync tasks reassigned to another driver (`CONFLICT`).
- **Test Suite 7: Primary Database Immutability Guard (2 tests)**
  - Verified `data/erp.db` file size and modification timestamp remained completely untouched.

**Result:** `npm run test:task66` &rarr; **79 PASSED, 0 FAILED (100%)**.

### 5.2 Monorepo Regression Verification
- `npm run test:delivery`: **171 PASSED, 0 FAILED (100%)**
- `npm run test:task58`: **84 PASSED, 0 FAILED (100%)**
- `npx tsc -p apps/erp/tsconfig.json --noEmit`: **0 diagnostic errors (100% type-safe)**
- `npm run build:erp`: **Successful Next.js 14 production build (exit code 0)**

### 5.3 Physical Device Testing Disclosure
In strict adherence to engineering honesty principles:
- **Physical Device Execution:** **NOT TESTED on physical mobile hardware** in this workstation session.
- **Emulated & Automated Verification:** Fully verified through automated headless test suites, Next.js production builds, SVG/Canvas PNG raster verification, and standard browser viewport emulation. Physical field testing on Android Chrome and iOS Safari should be conducted during the controlled pilot walkthrough.

---

## 6. Primary Database & Safety Boundaries

Throughout the entire planning, implementation, and test execution phases of Task 01B.66:
1. Primary Database File: `data/erp.db`
   - File Size: `1,388,544 bytes`
   - Last Modification: `21-10-2026 08:03:43 UTC` (13:33:43 IST)
   - Status: **Strictly untouched and pristine**. Zero queries, zero writes, zero locks.
2. Rehearsal Neon Database: `ravi-narayana-erp-phase01b-test` was never connected to.
3. Git Integrity: Zero commits, zero pushes, zero rebases, zero stashes, zero discards. All uncommitted work from Tasks 01B.37 through 01B.65 preserved intact.

---

## 7. Deliverables Checklist

| Deliverable | File Path | Status |
| :--- | :--- | :---: |
| Web App Manifest | [`apps/erp/public/manifest.webmanifest`](file:///c:/Users/Rishabh/Desktop/raviNarayana-Erp/apps/erp/public/manifest.webmanifest) | Complete |
| Web App Manifest JSON | [`apps/erp/public/manifest.json`](file:///c:/Users/Rishabh/Desktop/raviNarayana-Erp/apps/erp/public/manifest.json) | Complete |
| Next.js App Router Manifest | [`apps/erp/src/app/manifest.ts`](file:///c:/Users/Rishabh/Desktop/raviNarayana-Erp/apps/erp/src/app/manifest.ts) | Complete |
| 192x192 Brand Icon | [`apps/erp/public/icons/icon-192.png`](file:///c:/Users/Rishabh/Desktop/raviNarayana-Erp/apps/erp/public/icons/icon-192.png) | Complete |
| 512x512 Brand Icon | [`apps/erp/public/icons/icon-512.png`](file:///c:/Users/Rishabh/Desktop/raviNarayana-Erp/apps/erp/public/icons/icon-512.png) | Complete |
| 512x512 Maskable Icon | [`apps/erp/public/icons/maskable-icon-512.png`](file:///c:/Users/Rishabh/Desktop/raviNarayana-Erp/apps/erp/public/icons/maskable-icon-512.png) | Complete |
| 180x180 Apple Touch Icon | [`apps/erp/public/icons/apple-touch-icon.png`](file:///c:/Users/Rishabh/Desktop/raviNarayana-Erp/apps/erp/public/icons/apple-touch-icon.png) | Complete |
| Scoped Service Worker | [`apps/erp/public/sw.js`](file:///c:/Users/Rishabh/Desktop/raviNarayana-Erp/apps/erp/public/sw.js) | Complete |
| Offline Fallback View | [`apps/erp/src/app/offline/page.tsx`](file:///c:/Users/Rishabh/Desktop/raviNarayana-Erp/apps/erp/src/app/offline/page.tsx) | Complete |
| PWA Registrar Component | [`apps/erp/src/components/pwa/PwaRegistrar.tsx`](file:///c:/Users/Rishabh/Desktop/raviNarayana-Erp/apps/erp/src/components/pwa/PwaRegistrar.tsx) | Complete |
| Mobile Navigation Shell | [`apps/erp/src/components/layout/ErpShell.tsx`](file:///c:/Users/Rishabh/Desktop/raviNarayana-Erp/apps/erp/src/components/layout/ErpShell.tsx) | Complete |
| Role-Aware Root Routing | [`apps/erp/src/app/page.tsx`](file:///c:/Users/Rishabh/Desktop/raviNarayana-Erp/apps/erp/src/app/page.tsx) | Complete |
| Role-Aware Dashboard Routing | [`apps/erp/src/app/(management)/dashboard/page.tsx`](file:///c:/Users/Rishabh/Desktop/raviNarayana-Erp/apps/erp/src/app/(management)/dashboard/page.tsx) | Complete |
| Offline Exception Handling | [`apps/erp/src/app/(management)/delivery/page.tsx`](file:///c:/Users/Rishabh/Desktop/raviNarayana-Erp/apps/erp/src/app/(management)/delivery/page.tsx) | Complete |
| Touch & Safe-Area Styles | [`apps/erp/src/styles/globals.css`](file:///c:/Users/Rishabh/Desktop/raviNarayana-Erp/apps/erp/src/styles/globals.css) | Complete |
| Root Layout & Viewport | [`apps/erp/src/app/layout.tsx`](file:///c:/Users/Rishabh/Desktop/raviNarayana-Erp/apps/erp/src/app/layout.tsx) | Complete |
| Automated PWA Test Suite | [`tests/task01b_66_mobile_pwa.test.ts`](file:///c:/Users/Rishabh/Desktop/raviNarayana-Erp/tests/task01b_66_mobile_pwa.test.ts) | Complete (79/79 Passed) |
