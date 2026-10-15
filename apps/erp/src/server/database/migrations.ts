import Database from "better-sqlite3";
import crypto from "crypto";

export function runMigrations(db: Database.Database): void {
  const currentVersionRow = db.pragma("user_version", { simple: true }) as number;
  const currentVersion = typeof currentVersionRow === "number" ? currentVersionRow : 0;

  if (currentVersion < 1) {
    applyMigrationV1(db);
  }
  if (currentVersion < 2) {
    applyMigrationV2(db);
  }
  if (currentVersion < 3) {
    applyMigrationV3(db);
  }
  if (currentVersion < 4) {
    applyMigrationV4(db);
  }
  if (currentVersion < 5) {
    applyMigrationV5(db);
  }
  if (currentVersion < 6) {
    applyMigrationV6(db);
  }
  if (currentVersion < 7) {
    applyMigrationV7(db);
  }
  if (currentVersion < 8) {
    applyMigrationV8(db);
  }
}

/**
 * Migration V1:
 * 1. Ensure staff_users exists with all required columns.
 * 2. Hash session tokens at rest (token_hash) instead of storing plaintext session_token.
 * 3. Layered rate-limiting support: add ip_address to login_attempts.
 * 4. Create optimized indexes for expiration, token lookup, and IP rate limiting.
 */
function applyMigrationV1(db: Database.Database): void {
  const tx = db.transaction(() => {
    // 1. Base staff_users table
    db.exec(`
      CREATE TABLE IF NOT EXISTS staff_users (
        id TEXT PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        email TEXT UNIQUE NOT NULL,
        full_name TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL,
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_login_at TEXT
      );
    `);

    // 2. Sessions table check & migration
    const sessionsTableExists = db.prepare(`
      SELECT count(*) as count FROM sqlite_master WHERE type='table' AND name='sessions'
    `).get() as { count: number };

    if (sessionsTableExists.count === 0) {
      db.exec(`
        CREATE TABLE sessions (
          id TEXT PRIMARY KEY,
          token_hash TEXT UNIQUE NOT NULL,
          staff_id TEXT NOT NULL,
          expires_at TEXT NOT NULL,
          created_at TEXT NOT NULL,
          ip_address TEXT,
          user_agent TEXT,
          FOREIGN KEY (staff_id) REFERENCES staff_users(id) ON DELETE CASCADE
        );
      `);
    } else {
      // Check column names in existing sessions table
      const columns = db.prepare("PRAGMA table_info(sessions)").all() as Array<{ name: string }>;
      const columnNames = columns.map(c => c.name);

      if (!columnNames.includes("token_hash")) {
        // Old sessions table has session_token. Migrate existing records to token_hash.
        db.exec(`
          CREATE TABLE sessions_new (
            id TEXT PRIMARY KEY,
            token_hash TEXT UNIQUE NOT NULL,
            staff_id TEXT NOT NULL,
            expires_at TEXT NOT NULL,
            created_at TEXT NOT NULL,
            ip_address TEXT,
            user_agent TEXT,
            FOREIGN KEY (staff_id) REFERENCES staff_users(id) ON DELETE CASCADE
          );
        `);

        // Migrate records by SHA-256 hashing each session_token
        const oldSessions = db.prepare("SELECT * FROM sessions").all() as Array<{
          id: string;
          session_token: string;
          staff_id: string;
          expires_at: string;
          created_at: string;
          ip_address?: string;
          user_agent?: string;
        }>;

        const insertStmt = db.prepare(`
          INSERT INTO sessions_new (id, token_hash, staff_id, expires_at, created_at, ip_address, user_agent)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `);

        for (const sess of oldSessions) {
          const hash = crypto.createHash("sha256").update(sess.session_token).digest("hex");
          insertStmt.run(
            sess.id,
            hash,
            sess.staff_id,
            sess.expires_at,
            sess.created_at,
            sess.ip_address || null,
            sess.user_agent || null
          );
        }

        db.exec("DROP TABLE sessions;");
        db.exec("ALTER TABLE sessions_new RENAME TO sessions;");
      }
    }

    // Ensure sessions indexes exist
    db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_token_hash ON sessions(token_hash);
      CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
    `);

    // 3. Login attempts check & migration
    const loginAttemptsExists = db.prepare(`
      SELECT count(*) as count FROM sqlite_master WHERE type='table' AND name='login_attempts'
    `).get() as { count: number };

    if (loginAttemptsExists.count === 0) {
      db.exec(`
        CREATE TABLE login_attempts (
          id TEXT PRIMARY KEY,
          identifier TEXT NOT NULL,
          ip_address TEXT NOT NULL,
          attempted_at TEXT NOT NULL,
          success INTEGER NOT NULL
        );
      `);
    } else {
      const columns = db.prepare("PRAGMA table_info(login_attempts)").all() as Array<{ name: string }>;
      const columnNames = columns.map(c => c.name);

      if (!columnNames.includes("ip_address")) {
        db.exec("ALTER TABLE login_attempts ADD COLUMN ip_address TEXT NOT NULL DEFAULT 'unknown';");
      }
    }

    // Ensure login_attempts indexes exist
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_login_attempts_ip ON login_attempts(ip_address, attempted_at);
      CREATE INDEX IF NOT EXISTS idx_login_attempts_ident_ip ON login_attempts(identifier, ip_address, attempted_at);
      CREATE INDEX IF NOT EXISTS idx_login_attempts_ident ON login_attempts(identifier, attempted_at);
    `);

    // Advance schema version
    db.pragma("user_version = 1");
  });

  tx();
}

/**
 * Migration V2:
 * 1. Create audit_logs table for server-side tamper-evident audit logging.
 * 2. Add performance and constraint indexes for audit logs and staff queries.
 * 3. Advance user_version to 2.
 */
function applyMigrationV2(db: Database.Database): void {
  const tx = db.transaction(() => {
    // 1. Audit logs table
    db.exec(`
      CREATE TABLE IF NOT EXISTS audit_logs (
        id TEXT PRIMARY KEY,
        actor_id TEXT,
        actor_username TEXT,
        action TEXT NOT NULL,
        target_type TEXT NOT NULL,
        target_id TEXT,
        metadata TEXT,
        ip_address TEXT,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs(created_at);
      CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);
      CREATE INDEX IF NOT EXISTS idx_audit_logs_actor ON audit_logs(actor_id);
      CREATE INDEX IF NOT EXISTS idx_audit_logs_target ON audit_logs(target_type, target_id);

      CREATE INDEX IF NOT EXISTS idx_staff_users_role ON staff_users(role);
      CREATE INDEX IF NOT EXISTS idx_staff_users_active ON staff_users(is_active);
    `);

    // Advance schema version
    db.pragma("user_version = 2");
  });

  tx();
}

/**
 * Migration V3:
 * 1. Create rooms table (capacity > 0, base_rent_monthly >= 0).
 * 2. Create residents table (full_name, phone UNIQUE, email, status).
 * 3. Create resident_stays table (room assignment history, rent, security deposit).
 * 4. Enforce unique active stay per resident and optimize occupancy queries.
 * 5. Advance user_version to 3.
 */
function applyMigrationV3(db: Database.Database): void {
  const tx = db.transaction(() => {
    db.exec(`
      -- 1. Rooms table
      CREATE TABLE IF NOT EXISTS rooms (
        id TEXT PRIMARY KEY,
        room_number TEXT UNIQUE NOT NULL,
        floor INTEGER NOT NULL,
        type TEXT NOT NULL,
        capacity INTEGER NOT NULL CHECK (capacity > 0),
        base_rent_monthly INTEGER NOT NULL CHECK (base_rent_monthly >= 0),
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_rooms_number ON rooms(room_number);
      CREATE INDEX IF NOT EXISTS idx_rooms_floor ON rooms(floor);
      CREATE INDEX IF NOT EXISTS idx_rooms_active ON rooms(is_active);

      -- 2. Residents table
      CREATE TABLE IF NOT EXISTS residents (
        id TEXT PRIMARY KEY,
        full_name TEXT NOT NULL,
        phone TEXT UNIQUE NOT NULL,
        email TEXT,
        emergency_contact TEXT,
        notes TEXT,
        status TEXT NOT NULL DEFAULT 'ACTIVE',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_residents_phone ON residents(phone);
      CREATE INDEX IF NOT EXISTS idx_residents_status ON residents(status);

      -- 3. Resident Stays table (Room Assignments & Stay History)
      CREATE TABLE IF NOT EXISTS resident_stays (
        id TEXT PRIMARY KEY,
        resident_id TEXT NOT NULL REFERENCES residents(id) ON DELETE RESTRICT,
        room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE RESTRICT,
        check_in_date TEXT NOT NULL,
        check_out_date TEXT,
        monthly_rent INTEGER NOT NULL CHECK (monthly_rent >= 0),
        security_deposit INTEGER NOT NULL DEFAULT 0 CHECK (security_deposit >= 0),
        status TEXT NOT NULL DEFAULT 'ACTIVE',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_stays_resident_id ON resident_stays(resident_id);
      CREATE INDEX IF NOT EXISTS idx_stays_room_id ON resident_stays(room_id);
      CREATE INDEX IF NOT EXISTS idx_stays_status ON resident_stays(status);
      CREATE INDEX IF NOT EXISTS idx_stays_room_active ON resident_stays(room_id, status);

      -- Enforce at SQLite engine level: at most 1 ACTIVE stay per resident
      CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_active_resident_stay 
      ON resident_stays(resident_id) WHERE status = 'ACTIVE';
    `);

    // Advance schema version to 3
    db.pragma("user_version = 3");
  });

  tx();
}

/**
 * Migration V4:
 * 1. Create financial_transactions table:
 *    - Normalized ledger for rent charges, payments, security deposits, expenses, and reversals.
 *    - Strict constraints: positive integer amount in INR, validated payment methods and categories.
 *    - Foreign keys to residents, resident_stays, and staff_users with ON DELETE RESTRICT.
 *    - Idempotency key UNIQUE constraint to prevent duplicate submissions.
 * 2. Optimized indexes for type, date, resident, stay, category, status, and idempotency.
 * 3. Advance user_version to 4.
 */
function applyMigrationV4(db: Database.Database): void {
  const tx = db.transaction(() => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS financial_transactions (
        id TEXT PRIMARY KEY,
        transaction_type TEXT NOT NULL CHECK (transaction_type IN ('RENT_CHARGE', 'RENT_PAYMENT', 'SECURITY_DEPOSIT', 'EXPENSE', 'REVERSAL')),
        amount INTEGER NOT NULL CHECK (amount > 0),
        transaction_date TEXT NOT NULL,
        payment_method TEXT CHECK (payment_method IN ('CASH', 'UPI', 'BANK_TRANSFER', 'CHEQUE', 'OTHER') OR payment_method IS NULL),
        reference_number TEXT,
        resident_id TEXT REFERENCES residents(id) ON DELETE RESTRICT,
        stay_id TEXT REFERENCES resident_stays(id) ON DELETE RESTRICT,
        category TEXT NOT NULL,
        description TEXT,
        billing_period TEXT,
        payee_vendor TEXT,
        idempotency_key TEXT UNIQUE,
        status TEXT NOT NULL DEFAULT 'POSTED' CHECK (status IN ('POSTED', 'REVERSED')),
        reversal_of_id TEXT REFERENCES financial_transactions(id) ON DELETE RESTRICT,
        created_by TEXT NOT NULL REFERENCES staff_users(id),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_fin_tx_type ON financial_transactions(transaction_type);
      CREATE INDEX IF NOT EXISTS idx_fin_tx_date ON financial_transactions(transaction_date);
      CREATE INDEX IF NOT EXISTS idx_fin_tx_resident ON financial_transactions(resident_id);
      CREATE INDEX IF NOT EXISTS idx_fin_tx_stay ON financial_transactions(stay_id);
      CREATE INDEX IF NOT EXISTS idx_fin_tx_category ON financial_transactions(category);
      CREATE INDEX IF NOT EXISTS idx_fin_tx_status ON financial_transactions(status);
      CREATE INDEX IF NOT EXISTS idx_fin_tx_idempotency ON financial_transactions(idempotency_key);
    `);

    // Advance schema version to 4
    db.pragma("user_version = 4");
  });

  tx();
}

/**
 * Migration V5:
 * 1. Create resident_meal_preferences table:
 *    - Per-resident default meal opt-in preferences (breakfast, lunch, dinner) and dietary preference.
 * 2. Create daily_meal_plans table:
 *    - Daily meal planning, resident count, guest count, final preparation count, lifecycle statuses.
 *    - Unique constraint on (service_date, meal_type) to prevent duplicate plans.
 * 3. Create resident_meal_records table:
 *    - Normalized attendance / meal count per eligible resident per meal.
 *    - Unique constraint on (resident_id, service_date, meal_type) to prevent double counting.
 * 4. Create meal_plan_adjustments table:
 *    - Append-only manual quantity adjustment history with mandatory reasons and staff attribution.
 * 5. Optimized indexes for date, status, resident, stay, and meal types.
 * 6. Advance user_version to 5.
 */
function applyMigrationV5(db: Database.Database): void {
  const tx = db.transaction(() => {
    db.exec(`
      -- 1. Resident Meal Preferences
      CREATE TABLE IF NOT EXISTS resident_meal_preferences (
        resident_id TEXT PRIMARY KEY REFERENCES residents(id) ON DELETE RESTRICT,
        breakfast_opt_in INTEGER NOT NULL DEFAULT 1 CHECK (breakfast_opt_in IN (0, 1)),
        lunch_opt_in INTEGER NOT NULL DEFAULT 1 CHECK (lunch_opt_in IN (0, 1)),
        dinner_opt_in INTEGER NOT NULL DEFAULT 1 CHECK (dinner_opt_in IN (0, 1)),
        dietary_preference TEXT NOT NULL DEFAULT 'VEG',
        notes TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      -- 2. Daily Meal Plans
      CREATE TABLE IF NOT EXISTS daily_meal_plans (
        id TEXT PRIMARY KEY,
        service_date TEXT NOT NULL,
        meal_type TEXT NOT NULL CHECK (meal_type IN ('BREAKFAST', 'LUNCH', 'DINNER')),
        planned_resident_count INTEGER NOT NULL DEFAULT 0 CHECK (planned_resident_count >= 0),
        guest_count INTEGER NOT NULL DEFAULT 0 CHECK (guest_count >= 0),
        final_preparation_count INTEGER NOT NULL DEFAULT 0 CHECK (final_preparation_count >= 0),
        status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'CONFIRMED', 'COMPLETED')),
        notes TEXT,
        created_by TEXT NOT NULL REFERENCES staff_users(id),
        confirmed_by TEXT REFERENCES staff_users(id),
        confirmed_at TEXT,
        completed_by TEXT REFERENCES staff_users(id),
        completed_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        CONSTRAINT uq_plan_date_meal UNIQUE (service_date, meal_type)
      );

      CREATE INDEX IF NOT EXISTS idx_meal_plans_date ON daily_meal_plans(service_date);
      CREATE INDEX IF NOT EXISTS idx_meal_plans_status ON daily_meal_plans(status);
      CREATE INDEX IF NOT EXISTS idx_meal_plans_date_meal ON daily_meal_plans(service_date, meal_type);

      -- 3. Resident Meal Attendance Records
      CREATE TABLE IF NOT EXISTS resident_meal_records (
        id TEXT PRIMARY KEY,
        plan_id TEXT NOT NULL REFERENCES daily_meal_plans(id) ON DELETE RESTRICT,
        resident_id TEXT NOT NULL REFERENCES residents(id) ON DELETE RESTRICT,
        stay_id TEXT NOT NULL REFERENCES resident_stays(id) ON DELETE RESTRICT,
        service_date TEXT NOT NULL,
        meal_type TEXT NOT NULL CHECK (meal_type IN ('BREAKFAST', 'LUNCH', 'DINNER')),
        status TEXT NOT NULL DEFAULT 'CONFIRMED' CHECK (status IN ('CONFIRMED', 'OPTED_OUT')),
        notes TEXT,
        created_by TEXT REFERENCES staff_users(id),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        CONSTRAINT uq_res_date_meal UNIQUE (resident_id, service_date, meal_type)
      );

      CREATE INDEX IF NOT EXISTS idx_res_meal_plan ON resident_meal_records(plan_id);
      CREATE INDEX IF NOT EXISTS idx_res_meal_resident ON resident_meal_records(resident_id);
      CREATE INDEX IF NOT EXISTS idx_res_meal_stay ON resident_meal_records(stay_id);
      CREATE INDEX IF NOT EXISTS idx_res_meal_date ON resident_meal_records(service_date);
      CREATE INDEX IF NOT EXISTS idx_res_meal_status ON resident_meal_records(status);

      -- 4. Meal Plan Adjustments (Append-only justified overrides)
      CREATE TABLE IF NOT EXISTS meal_plan_adjustments (
        id TEXT PRIMARY KEY,
        plan_id TEXT NOT NULL REFERENCES daily_meal_plans(id) ON DELETE RESTRICT,
        previous_resident_count INTEGER NOT NULL CHECK (previous_resident_count >= 0),
        new_resident_count INTEGER NOT NULL CHECK (new_resident_count >= 0),
        previous_guest_count INTEGER NOT NULL CHECK (previous_guest_count >= 0),
        new_guest_count INTEGER NOT NULL CHECK (new_guest_count >= 0),
        previous_total INTEGER NOT NULL CHECK (previous_total >= 0),
        new_total INTEGER NOT NULL CHECK (new_total >= 0),
        reason TEXT NOT NULL,
        created_by TEXT NOT NULL REFERENCES staff_users(id),
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_meal_adj_plan ON meal_plan_adjustments(plan_id);
      CREATE INDEX IF NOT EXISTS idx_meal_adj_date ON meal_plan_adjustments(created_at);
    `);

    // Advance schema version to 5
    db.pragma("user_version = 5");
  });

  tx();
}

/**
 * Migration V6: Phase 6 Tiffin Delivery & Handover
 * 1. Create delivery_tasks table:
 *    - Links directly to resident_meal_records(id) with UNIQUE constraint (no duplicate tasks).
 *    - References daily_meal_plans(id).
 *    - Preserves snapshot of resident identity (name) and room assignment (room number, floor) so later resident check-out or room changes do not rewrite historical delivery records.
 *    - Strict status state machine: PENDING, ASSIGNED, OUT_FOR_DELIVERY, DELIVERED, EXCEPTION.
 *    - Full timestamps and personnel attribution for assignment, dispatch, delivery, and exception.
 * 2. Create delivery_task_events table:
 *    - Append-only event history for transitions, reassignments, exceptions, and retries.
 * 3. Performance indexes for service_date, meal_type, status, assigned_to, and task_id.
 * 4. Advance user_version to 6.
 */
function applyMigrationV6(db: Database.Database): void {
  const tx = db.transaction(() => {
    db.exec(`
      -- 1. Delivery Tasks Table
      CREATE TABLE IF NOT EXISTS delivery_tasks (
        id TEXT PRIMARY KEY,
        meal_record_id TEXT NOT NULL UNIQUE REFERENCES resident_meal_records(id) ON DELETE RESTRICT,
        plan_id TEXT NOT NULL REFERENCES daily_meal_plans(id) ON DELETE RESTRICT,
        service_date TEXT NOT NULL,
        meal_type TEXT NOT NULL CHECK (meal_type IN ('BREAKFAST', 'LUNCH', 'DINNER')),
        resident_id TEXT NOT NULL REFERENCES residents(id) ON DELETE RESTRICT,
        resident_name TEXT NOT NULL,
        room_number TEXT NOT NULL,
        floor INTEGER NOT NULL,
        stay_id TEXT NOT NULL REFERENCES resident_stays(id) ON DELETE RESTRICT,
        status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'ASSIGNED', 'OUT_FOR_DELIVERY', 'DELIVERED', 'EXCEPTION')),
        assigned_to TEXT REFERENCES staff_users(id) ON DELETE SET NULL,
        assigned_to_name TEXT,
        assigned_by TEXT REFERENCES staff_users(id) ON DELETE SET NULL,
        assigned_at TEXT,
        dispatched_at TEXT,
        dispatched_by TEXT REFERENCES staff_users(id) ON DELETE SET NULL,
        delivered_at TEXT,
        delivered_by TEXT REFERENCES staff_users(id) ON DELETE SET NULL,
        delivery_notes TEXT,
        recipient_name TEXT,
        exception_type TEXT CHECK (exception_type IS NULL OR exception_type IN ('RESIDENT_UNAVAILABLE', 'RESIDENT_DECLINED', 'LOCATION_UNCLEAR', 'MEAL_DAMAGED_OR_MISSING', 'OTHER')),
        exception_reason TEXT,
        exception_at TEXT,
        exception_by TEXT REFERENCES staff_users(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_del_tasks_date ON delivery_tasks(service_date);
      CREATE INDEX IF NOT EXISTS idx_del_tasks_date_meal ON delivery_tasks(service_date, meal_type);
      CREATE INDEX IF NOT EXISTS idx_del_tasks_status ON delivery_tasks(status);
      CREATE INDEX IF NOT EXISTS idx_del_tasks_assigned_to ON delivery_tasks(assigned_to);
      CREATE INDEX IF NOT EXISTS idx_del_tasks_plan ON delivery_tasks(plan_id);
      CREATE INDEX IF NOT EXISTS idx_del_tasks_resident ON delivery_tasks(resident_id);

      -- 2. Delivery Task Events Table (Audit / Timeline History)
      CREATE TABLE IF NOT EXISTS delivery_task_events (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL REFERENCES delivery_tasks(id) ON DELETE RESTRICT,
        event_type TEXT NOT NULL CHECK (event_type IN ('CREATED', 'ASSIGNED', 'REASSIGNED', 'DISPATCHED', 'DELIVERED', 'EXCEPTION', 'RETRIED')),
        from_status TEXT,
        to_status TEXT NOT NULL,
        actor_id TEXT NOT NULL REFERENCES staff_users(id),
        actor_name TEXT NOT NULL,
        notes TEXT,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_del_events_task ON delivery_task_events(task_id);
      CREATE INDEX IF NOT EXISTS idx_del_events_created ON delivery_task_events(created_at);
    `);

    // Advance schema version to 6
    db.pragma("user_version = 6");
  });

  tx();
}

/**
 * Migration V7: Tiffin Citywide Fulfillment & Notification System
 * 1. Add actual_cooked_count to daily_meal_plans to track actual kitchen preparation.
 * 2. Extend delivery_tasks to support both 'RESIDENT' and 'EXTERNAL' citywide customer orders:
 *    - Allows nullable resident-specific fields for external city orders.
 *    - Adds order_type ('RESIDENT', 'EXTERNAL'), customer_name, customer_phone, delivery_address.
 * 3. Create staff_notification_reads table for tracking read/unread state across devices.
 * 4. Advance user_version to 7.
 */
function applyMigrationV7(db: Database.Database): void {
  // Disable FKs temporarily for table swap
  db.pragma("foreign_keys = OFF");

  const tx = db.transaction(() => {
    // 1. Add actual_cooked_count to daily_meal_plans if not present
    const planCols = (db.prepare("PRAGMA table_info(daily_meal_plans)").all() as any[]).map(c => c.name);
    if (!planCols.includes("actual_cooked_count")) {
      db.exec(`
        ALTER TABLE daily_meal_plans ADD COLUMN actual_cooked_count INTEGER CHECK (actual_cooked_count IS NULL OR actual_cooked_count >= 0);
      `);
      db.exec(`
        UPDATE daily_meal_plans 
        SET actual_cooked_count = final_preparation_count 
        WHERE status IN ('CONFIRMED', 'COMPLETED') AND actual_cooked_count IS NULL;
      `);
    }

    // 2. Extend delivery_tasks to support external city orders
    const delCols = (db.prepare("PRAGMA table_info(delivery_tasks)").all() as any[]).map(c => c.name);
    if (!delCols.includes("order_type")) {
      db.exec(`
        CREATE TABLE delivery_tasks_v7 (
          id TEXT PRIMARY KEY,
          order_type TEXT NOT NULL DEFAULT 'RESIDENT' CHECK (order_type IN ('RESIDENT', 'EXTERNAL')),
          meal_record_id TEXT UNIQUE REFERENCES resident_meal_records(id) ON DELETE RESTRICT,
          plan_id TEXT NOT NULL REFERENCES daily_meal_plans(id) ON DELETE RESTRICT,
          service_date TEXT NOT NULL,
          meal_type TEXT NOT NULL CHECK (meal_type IN ('BREAKFAST', 'LUNCH', 'DINNER')),
          resident_id TEXT REFERENCES residents(id) ON DELETE RESTRICT,
          resident_name TEXT,
          room_number TEXT,
          floor INTEGER,
          stay_id TEXT REFERENCES resident_stays(id) ON DELETE RESTRICT,
          customer_name TEXT,
          customer_phone TEXT,
          delivery_address TEXT,
          status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'ASSIGNED', 'OUT_FOR_DELIVERY', 'DELIVERED', 'EXCEPTION')),
          assigned_to TEXT REFERENCES staff_users(id) ON DELETE SET NULL,
          assigned_to_name TEXT,
          assigned_by TEXT REFERENCES staff_users(id) ON DELETE SET NULL,
          assigned_at TEXT,
          dispatched_at TEXT,
          dispatched_by TEXT REFERENCES staff_users(id) ON DELETE SET NULL,
          delivered_at TEXT,
          delivered_by TEXT REFERENCES staff_users(id) ON DELETE SET NULL,
          delivery_notes TEXT,
          recipient_name TEXT,
          exception_type TEXT CHECK (exception_type IS NULL OR exception_type IN ('RESIDENT_UNAVAILABLE', 'RESIDENT_DECLINED', 'LOCATION_UNCLEAR', 'MEAL_DAMAGED_OR_MISSING', 'OTHER')),
          exception_reason TEXT,
          exception_at TEXT,
          exception_by TEXT REFERENCES staff_users(id) ON DELETE SET NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        INSERT INTO delivery_tasks_v7 (
          id, order_type, meal_record_id, plan_id, service_date, meal_type,
          resident_id, resident_name, room_number, floor, stay_id,
          customer_name, status, assigned_to, assigned_to_name, assigned_by,
          assigned_at, dispatched_at, dispatched_by, delivered_at, delivered_by,
          delivery_notes, recipient_name, exception_type, exception_reason,
          exception_at, exception_by, created_at, updated_at
        )
        SELECT 
          id, 'RESIDENT', meal_record_id, plan_id, service_date, meal_type,
          resident_id, resident_name, room_number, floor, stay_id,
          resident_name, status, assigned_to, assigned_to_name, assigned_by,
          assigned_at, dispatched_at, dispatched_by, delivered_at, delivered_by,
          delivery_notes, recipient_name, exception_type, exception_reason,
          exception_at, exception_by, created_at, updated_at
        FROM delivery_tasks;

        DROP TABLE delivery_tasks;
        ALTER TABLE delivery_tasks_v7 RENAME TO delivery_tasks;

        CREATE INDEX IF NOT EXISTS idx_del_tasks_date ON delivery_tasks(service_date);
        CREATE INDEX IF NOT EXISTS idx_del_tasks_date_meal ON delivery_tasks(service_date, meal_type);
        CREATE INDEX IF NOT EXISTS idx_del_tasks_status ON delivery_tasks(status);
        CREATE INDEX IF NOT EXISTS idx_del_tasks_assigned_to ON delivery_tasks(assigned_to);
        CREATE INDEX IF NOT EXISTS idx_del_tasks_plan ON delivery_tasks(plan_id);
        CREATE INDEX IF NOT EXISTS idx_del_tasks_resident ON delivery_tasks(resident_id);
        CREATE INDEX IF NOT EXISTS idx_del_tasks_order_type ON delivery_tasks(order_type);
      `);
    }

    // 3. Staff Notification Reads
    db.exec(`
      CREATE TABLE IF NOT EXISTS staff_notification_reads (
        staff_id TEXT NOT NULL REFERENCES staff_users(id) ON DELETE CASCADE,
        notification_id TEXT NOT NULL,
        read_at TEXT NOT NULL,
        PRIMARY KEY (staff_id, notification_id)
      );

      CREATE INDEX IF NOT EXISTS idx_notif_reads_staff ON staff_notification_reads(staff_id);
    `);

    // Advance schema version to 7
    db.pragma("user_version = 7");
  });

  tx();
  db.pragma("foreign_keys = ON");
}

/**
 * Migration V8:
 * Enforces strict case-insensitive room number uniqueness at SQLite engine level.
 */
function applyMigrationV8(db: Database.Database): void {
  const tx = db.transaction(() => {
    db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_rooms_number_nocase ON rooms(room_number COLLATE NOCASE);
    `);

    db.pragma("user_version = 8");
  });

  tx();
}
