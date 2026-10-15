# Ravinarayan ERP & Website Deployment Guide

This guide describes how `@ravinarayan/website` and `@ravinarayan/erp` are built, configured, and deployed independently in production.

---

## 1. Independent Deployment Architecture

```text
                        DNS: ravinarayan.in
                               │
                               ▼
                ┌────────────────────────────────┐
                │    Production Website Host     │
                │   (Origin: ravinarayan.in)     │
                │         apps/website           │
                └────────────────────────────────┘

                      DNS: erp.ravinarayan.in
                               │
                               ▼
                ┌────────────────────────────────┐
                │      Production ERP Host       │
                │ (Origin: erp.ravinarayan.in)   │
                │           apps/erp             │
                └────────────────────────────────┘
```

The two applications are completely isolated. Neither application requires knowledge of the other's internal routes.

---

## 2. Command Reference

From the monorepo root:

| Command | Action | Local Port / Target |
| :--- | :--- | :--- |
| `npm run dev:website` | Run public website in development mode | `http://localhost:3000` |
| `npm run dev:erp` | Run management ERP in development mode | `http://localhost:3001` |
| `npm run build:website` | Compile production build of website | `apps/website/.next` |
| `npm run build:erp` | Compile production build of ERP | `apps/erp/.next` |
| `npm run build` | Compile both applications sequentially | Both builds |
| `npm run start:website` | Run compiled website server in production | `http://localhost:3000` |
| `npm run start:erp` | Run compiled ERP server in production | `http://localhost:3001` |
| `npm test` | Run automated security & RBAC regression test suite | 162 automated assertions across 19 test suites |
| `npm run test:security` | Run Phase 1.5 auth & rate limit test suite | 48 assertions |
| `npm run test:rbac` | Run Phase 2A staff & RBAC test suite | 114 assertions |

---

## 3. Production Environment Configuration

When deploying `apps/erp` to production (`erp.ravinarayan.in`), configure the following environment variables:

```ini
# Core Environment
NODE_ENV=production

# Database Storage Path (Absolute path or relative to project root)
ERP_DATABASE_PATH=/var/data/erp.db

# Reverse Proxy Trust (Set to true when behind Cloudflare, Nginx, or Caddy)
TRUST_PROXY_HEADERS=true

# Initial Administrator Provisioning (Used ONLY on initial boot when DB is empty)
ERP_ADMIN_USERNAME=admin
ERP_ADMIN_EMAIL=admin@ravinarayan.in
ERP_ADMIN_PASSWORD=<strong-random-password-min-12-chars>
ERP_ADMIN_NAME="Ravinarayan Super Admin"

# Domain & URL Configuration
NEXT_PUBLIC_APP_URL=https://ravinarayan.in
NEXT_PUBLIC_ERP_DOMAIN=erp.ravinarayan.in
```

### Production Environment Assertions
The application enforces strict validation on startup:
1. **Missing Password Rejection**: If `NODE_ENV=production` and `staff_users` table is empty, startup will **fail safely with a fatal error** if `ERP_ADMIN_PASSWORD` is not set.
2. **Demo Password Prohibition**: If `ERP_ADMIN_PASSWORD` is set to the demonstration password `"Ravinarayan@2026"`, production startup will abort.
3. **Minimum Length Policy**: `ERP_ADMIN_PASSWORD` must be at least 12 characters.

---

### Reverse Proxy & Header Sanitization (Anti-Spoofing)

To protect the ERP rate limiter from IP spoofing, forwarding headers (`CF-Connecting-IP`, `X-Forwarded-For`, `X-Real-IP`) are strictly ignored unless `TRUST_PROXY_HEADERS=true` is set.

When deploying behind an edge proxy or reverse proxy, configure your edge server to sanitize untrusted client headers before proxying to the Next.js process:

#### Nginx Configuration Example
```nginx
server {
    server_name erp.ravinarayan.in;

    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;

        # Overwrite client-provided headers with the authentic peer IP
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

#### Cloudflare Setup
When routing through Cloudflare:
1. Ensure Full/Strict SSL is enabled.
2. The ERP will automatically prefer `cf-connecting-ip` (validated and injected by Cloudflare edge) when `TRUST_PROXY_HEADERS=true`.

---

## 4. Initial Provisioning & Password Rotation

### First-Time Boot Seeding
1. When `data/erp.db` is initialized for the first time, `seedInitialAdmin()` inspects `SELECT COUNT(*) FROM staff_users`.
2. If count is `0`, it validates the environment variables, hashes `ERP_ADMIN_PASSWORD` with `bcrypt` (12 salt rounds), and inserts the Super Administrator record (`usr_super_admin_01`).
3. Once created, subsequent startups detect `count > 0` and **never re-seed or overwrite** existing staff records, even if environment variables are changed.

### Administrator Password Rotation Procedure
To rotate the administrator password on an existing operational database:
1. Log in to the ERP as Super Admin at `https://erp.ravinarayan.in/login`.
2. Navigate to the forthcoming Phase 2 Staff Management settings, or execute an authorized administrative CLI script:
   ```bash
   node -e "const bcrypt = require('bcryptjs'); const db = require('better-sqlite3')('/var/data/erp.db'); const newHash = bcrypt.hashSync(process.argv[1], 12); db.prepare('UPDATE staff_users SET password_hash = ?, updated_at = ? WHERE username = ?').run(newHash, new Date().toISOString(), 'admin');" "NewSecurePassword123#"
   ```
3. Invalidate active sessions if a compromised credential is suspected:
   ```bash
   node -e "const db = require('better-sqlite3')('/var/data/erp.db'); db.prepare('DELETE FROM sessions WHERE staff_id = (SELECT id FROM staff_users WHERE username = ?))').run('admin');"
   ```

---

## 5. Database Backup & Disaster Recovery

### WAL Mode Considerations
SQLite in Write-Ahead Logging (`WAL`) mode maintains three files during active operation:
- `erp.db` (Primary database file)
- `erp.db-wal` (Write-ahead log containing uncheckpointed transactions)
- `erp.db-shm` (Shared-memory index)

### Creating Safe Live Backups
To create an atomic, crash-consistent backup while the server is actively serving traffic:

1. **Option A: SQLite Online Backup (Recommended)**:
   ```bash
   sqlite3 /var/data/erp.db ".backup /var/backups/erp.db.$(date +%Y%m%d%H%M%S)"
   ```
2. **Option B: Node.js / Better-SQLite3 Backup API**:
   ```javascript
   const db = require("better-sqlite3")("/var/data/erp.db");
   await db.backup(`/var/backups/erp.db.${Date.now()}`);
   ```
3. **Option C: Filesystem Copy**:
   Always copy both `erp.db` AND `erp.db-wal` if copying raw files directly.

### Retention & Pruning Policy
- **Active Sessions**: Automatically cleaned up after 7 days TTL (or pruned immediately upon expiry by background cleanup).
- **Login Attempts**: Automatically pruned after 24 hours retention.
- **Audit Logs (Phase 7)**: Preserved permanently in tamper-evident log records.
