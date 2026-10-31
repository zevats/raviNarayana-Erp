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
  if (currentVersion < 9) {
    applyMigrationV9(db);
  }
  if (currentVersion < 10) {
    applyMigrationV10(db);
  }
  if (currentVersion < 11) {
    applyMigrationV11(db);
  }
  if (currentVersion < 12) {
    applyMigrationV12(db);
  }
  if (currentVersion < 13) {
    applyMigrationV13(db);
  }
  if (currentVersion < 14) {
    applyMigrationV14(db);
  }
  if (currentVersion < 15) {
    applyMigrationV15(db);
  }
  if (currentVersion < 16) {
    applyMigrationV16(db);
  }
  if (currentVersion < 17) {
    applyMigrationV17(db);
  }
  if (currentVersion < 18) {
    applyMigrationV18(db);
  }
  if (currentVersion < 19) {
    applyMigrationV19(db);
  }
  if (currentVersion < 20) {
    applyMigrationV20(db);
  }
  if (currentVersion < 21) {
    applyMigrationV21(db);
  }
  if (currentVersion < 22) {
    applyMigrationV22(db);
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

/**
 * Migration V9: Phase 1 Security Hardening
 * 1. Create auth_challenges table for 6-digit Email OTP login (10-minute expiry, max 3 attempts).
 * 2. Create password_resets table for 256-bit token password recovery (1-hour expiry, single-use).
 * 3. Advance user_version to 9.
 */
function applyMigrationV9(db: Database.Database): void {
  const tx = db.transaction(() => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS auth_challenges (
        id TEXT PRIMARY KEY,
        staff_id TEXT NOT NULL REFERENCES staff_users(id) ON DELETE CASCADE,
        otp_hash TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_auth_challenges_staff ON auth_challenges(staff_id);
      CREATE INDEX IF NOT EXISTS idx_auth_challenges_expires ON auth_challenges(expires_at);

      CREATE TABLE IF NOT EXISTS password_resets (
        id TEXT PRIMARY KEY,
        staff_id TEXT NOT NULL REFERENCES staff_users(id) ON DELETE CASCADE,
        token_hash TEXT UNIQUE NOT NULL,
        expires_at TEXT NOT NULL,
        used_at TEXT,
        created_at TEXT NOT NULL
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_password_resets_token ON password_resets(token_hash);
      CREATE INDEX IF NOT EXISTS idx_password_resets_staff ON password_resets(staff_id);
      CREATE INDEX IF NOT EXISTS idx_password_resets_expires ON password_resets(expires_at);
    `);

    db.pragma("user_version = 9");
  });

  tx();
}

/**
 * Migration V10: Persistent Session Preemption Register
 * 1. Create session_preemptions table to persist preempted session token hashes across process restarts.
 * 2. Advance user_version to 10.
 */
function applyMigrationV10(db: Database.Database): void {
  const tx = db.transaction(() => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS session_preemptions (
        id TEXT PRIMARY KEY,
        token_hash TEXT UNIQUE NOT NULL,
        staff_id TEXT NOT NULL REFERENCES staff_users(id) ON DELETE CASCADE,
        preempted_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_session_preemptions_token ON session_preemptions(token_hash);
      CREATE INDEX IF NOT EXISTS idx_session_preemptions_staff ON session_preemptions(staff_id);
      CREATE INDEX IF NOT EXISTS idx_session_preemptions_expires ON session_preemptions(expires_at);
    `);

    db.pragma("user_version = 10");
  });

  tx();
}

/**
 * Migration V11: Resident Invoicing & Billing Engine, Phase 1
 * 1. Alter financial_transactions to add invoice_id TEXT column.
 * 2. Create invoice_counters table for sequential gapless invoice numbers.
 * 3. Create invoices table.
 * 4. Create invoice_items table.
 * 5. Create invoice_payment_allocations table.
 * 6. Advance user_version to 11.
 */
function applyMigrationV11(db: Database.Database): void {
  const tx = db.transaction(() => {
    // 1. Alter financial_transactions table if column doesn't exist
    const columns = db.prepare("PRAGMA table_info(financial_transactions)").all() as Array<{ name: string }>;
    const hasInvoiceId = columns.some((c) => c.name === "invoice_id");
    if (!hasInvoiceId) {
      db.exec("ALTER TABLE financial_transactions ADD COLUMN invoice_id TEXT;");
    }
    db.exec("CREATE INDEX IF NOT EXISTS idx_fin_tx_invoice ON financial_transactions(invoice_id);");

    // 2. Invoice counters table
    db.exec(`
      CREATE TABLE IF NOT EXISTS invoice_counters (
        year INTEGER PRIMARY KEY,
        last_number INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL
      );
    `);

    // 3. Invoices table
    db.exec(`
      CREATE TABLE IF NOT EXISTS invoices (
        id TEXT PRIMARY KEY,
        invoice_number TEXT UNIQUE,
        invoice_type TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'DRAFT',
        resident_id TEXT NOT NULL REFERENCES residents(id) ON DELETE RESTRICT,
        stay_id TEXT REFERENCES resident_stays(id) ON DELETE RESTRICT,
        issue_date TEXT NOT NULL,
        due_date TEXT NOT NULL,
        billing_period TEXT NOT NULL,
        subtotal INTEGER NOT NULL DEFAULT 0,
        cgst_amount INTEGER NOT NULL DEFAULT 0,
        sgst_amount INTEGER NOT NULL DEFAULT 0,
        igst_amount INTEGER NOT NULL DEFAULT 0,
        total_tax INTEGER NOT NULL DEFAULT 0,
        total_amount INTEGER NOT NULL DEFAULT 0,
        amount_paid INTEGER NOT NULL DEFAULT 0,
        balance_due INTEGER NOT NULL DEFAULT 0,
        company_name TEXT NOT NULL,
        company_address TEXT NOT NULL,
        company_gstin TEXT,
        company_state_code TEXT NOT NULL DEFAULT '06',
        recipient_name TEXT NOT NULL,
        recipient_phone TEXT NOT NULL,
        recipient_email TEXT,
        recipient_address TEXT,
        recipient_gstin TEXT,
        recipient_state_code TEXT NOT NULL DEFAULT '06',
        rent_charge_id TEXT REFERENCES financial_transactions(id) ON DELETE SET NULL,
        notes TEXT,
        cancelled_at TEXT,
        cancellation_reason TEXT,
        created_by TEXT NOT NULL REFERENCES staff_users(id),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_number ON invoices(invoice_number);
      CREATE INDEX IF NOT EXISTS idx_invoices_resident ON invoices(resident_id);
      CREATE INDEX IF NOT EXISTS idx_invoices_stay ON invoices(stay_id);
      CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status);
      CREATE INDEX IF NOT EXISTS idx_invoices_issue_date ON invoices(issue_date);
      CREATE INDEX IF NOT EXISTS idx_invoices_billing_period ON invoices(billing_period);
    `);

    // 4. Invoice items table
    db.exec(`
      CREATE TABLE IF NOT EXISTS invoice_items (
        id TEXT PRIMARY KEY,
        invoice_id TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
        description TEXT NOT NULL,
        sac_hsn_code TEXT,
        quantity INTEGER NOT NULL DEFAULT 1,
        unit_price INTEGER NOT NULL,
        amount INTEGER NOT NULL,
        tax_rate INTEGER NOT NULL DEFAULT 0,
        cgst_rate INTEGER NOT NULL DEFAULT 0,
        sgst_rate INTEGER NOT NULL DEFAULT 0,
        igst_rate INTEGER NOT NULL DEFAULT 0,
        cgst_amount INTEGER NOT NULL DEFAULT 0,
        sgst_amount INTEGER NOT NULL DEFAULT 0,
        igst_amount INTEGER NOT NULL DEFAULT 0,
        total_item_amount INTEGER NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_invoice_items_invoice ON invoice_items(invoice_id);
    `);

    // 5. Invoice payment allocations table
    db.exec(`
      CREATE TABLE IF NOT EXISTS invoice_payment_allocations (
        id TEXT PRIMARY KEY,
        invoice_id TEXT NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT,
        payment_transaction_id TEXT NOT NULL REFERENCES financial_transactions(id) ON DELETE RESTRICT,
        amount INTEGER NOT NULL,
        allocated_at TEXT NOT NULL,
        allocated_by TEXT NOT NULL REFERENCES staff_users(id),
        notes TEXT,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_inv_alloc_invoice ON invoice_payment_allocations(invoice_id);
      CREATE INDEX IF NOT EXISTS idx_inv_alloc_payment ON invoice_payment_allocations(payment_transaction_id);
    `);

    db.pragma("user_version = 11");
  });

  tx();
}

/**
 * Migration V12: Tiffin Customer Directory & Pricing Catalog (Task 01B.43)
 * 1. Create tiffin_customers table with phone index, status index, name index.
 * 2. Create tiffin_products table with unique code index, category index, status index.
 * 3. Advance user_version to 12.
 */
function applyMigrationV12(db: Database.Database): void {
  const tx = db.transaction(() => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS tiffin_customers (
        id TEXT PRIMARY KEY,
        full_name TEXT NOT NULL,
        phone TEXT NOT NULL,
        alternate_phone TEXT,
        delivery_address TEXT NOT NULL,
        landmark TEXT,
        delivery_instructions TEXT,
        customer_type TEXT NOT NULL DEFAULT 'INDIVIDUAL',
        dietary_preference TEXT NOT NULL DEFAULT 'VEG',
        status TEXT NOT NULL DEFAULT 'ACTIVE',
        notes TEXT,
        created_by TEXT NOT NULL REFERENCES staff_users(id),
        updated_by TEXT REFERENCES staff_users(id),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_tiffin_cust_phone ON tiffin_customers(phone);
      CREATE INDEX IF NOT EXISTS idx_tiffin_cust_status ON tiffin_customers(status);
      CREATE INDEX IF NOT EXISTS idx_tiffin_cust_name ON tiffin_customers(full_name);

      CREATE TABLE IF NOT EXISTS tiffin_products (
        id TEXT PRIMARY KEY,
        code TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        category TEXT NOT NULL,
        billing_unit TEXT NOT NULL,
        price INTEGER NOT NULL,
        currency TEXT NOT NULL DEFAULT 'INR',
        status TEXT NOT NULL DEFAULT 'ACTIVE',
        created_by TEXT NOT NULL REFERENCES staff_users(id),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_tiffin_prod_code ON tiffin_products(code);
      CREATE INDEX IF NOT EXISTS idx_tiffin_prod_category ON tiffin_products(category);
      CREATE INDEX IF NOT EXISTS idx_tiffin_prod_status ON tiffin_products(status);
    `);

    db.pragma("user_version = 12");
  });

  tx();
}

/**
 * Migration V13: Tiffin Subscription Management & Service Scheduling (Task 01B.44)
 * 1. Create tiffin_subscriptions table with indices on customer_id, product_id, status, start_date.
 * 2. Advance user_version to 13.
 */
function applyMigrationV13(db: Database.Database): void {
  const tx = db.transaction(() => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS tiffin_subscriptions (
        id TEXT PRIMARY KEY,
        customer_id TEXT NOT NULL REFERENCES tiffin_customers(id) ON DELETE RESTRICT,
        product_id TEXT NOT NULL REFERENCES tiffin_products(id) ON DELETE RESTRICT,
        status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'PAUSED', 'CANCELLED', 'COMPLETED')),
        start_date TEXT NOT NULL,
        end_date TEXT,
        price INTEGER NOT NULL CHECK (price >= 0),
        currency TEXT NOT NULL DEFAULT 'INR',
        meal_types TEXT NOT NULL DEFAULT 'BOTH' CHECK (meal_types IN ('LUNCH', 'DINNER', 'BOTH', 'BREAKFAST')),
        service_days TEXT NOT NULL DEFAULT 'ALL_DAYS' CHECK (service_days IN ('ALL_DAYS', 'MON_SAT', 'MON_FRI')),
        quantity_per_meal INTEGER NOT NULL DEFAULT 1 CHECK (quantity_per_meal >= 1),
        pause_start_date TEXT,
        pause_resume_date TEXT,
        pause_reason TEXT,
        cancelled_at TEXT,
        cancellation_reason TEXT,
        cancelled_by TEXT REFERENCES staff_users(id),
        delivery_address TEXT NOT NULL,
        delivery_instructions TEXT,
        notes TEXT,
        created_by TEXT NOT NULL REFERENCES staff_users(id),
        updated_by TEXT REFERENCES staff_users(id),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_tiffin_sub_customer ON tiffin_subscriptions(customer_id);
      CREATE INDEX IF NOT EXISTS idx_tiffin_sub_product ON tiffin_subscriptions(product_id);
      CREATE INDEX IF NOT EXISTS idx_tiffin_sub_status ON tiffin_subscriptions(status);
      CREATE INDEX IF NOT EXISTS idx_tiffin_sub_start_date ON tiffin_subscriptions(start_date);
    `);

    db.pragma("user_version = 13");
  });

  tx();
}

/**
 * Migration V14: Kitchen Demand & Production Tracking (Task 01B.45)
 * 1. Add planned_tiffin_count, dispatched_count, leftover_count, waste_count, reconciled_by, reconciled_at to daily_meal_plans.
 * 2. Add subscription_id to delivery_tasks.
 * 3. Create index idx_del_tasks_sub on delivery_tasks(subscription_id).
 * 4. Advance user_version to 14.
 */
function applyMigrationV14(db: Database.Database): void {
  const tx = db.transaction(() => {
    // 1. Add columns to daily_meal_plans if not present
    const planCols = (db.prepare("PRAGMA table_info(daily_meal_plans)").all() as any[]).map(c => c.name);
    if (!planCols.includes("planned_tiffin_count")) {
      db.exec("ALTER TABLE daily_meal_plans ADD COLUMN planned_tiffin_count INTEGER NOT NULL DEFAULT 0 CHECK (planned_tiffin_count >= 0);");
    }
    if (!planCols.includes("dispatched_count")) {
      db.exec("ALTER TABLE daily_meal_plans ADD COLUMN dispatched_count INTEGER DEFAULT 0 CHECK (dispatched_count IS NULL OR dispatched_count >= 0);");
    }
    if (!planCols.includes("leftover_count")) {
      db.exec("ALTER TABLE daily_meal_plans ADD COLUMN leftover_count INTEGER DEFAULT 0 CHECK (leftover_count IS NULL OR leftover_count >= 0);");
    }
    if (!planCols.includes("waste_count")) {
      db.exec("ALTER TABLE daily_meal_plans ADD COLUMN waste_count INTEGER DEFAULT 0 CHECK (waste_count IS NULL OR waste_count >= 0);");
    }
    if (!planCols.includes("reconciled_by")) {
      db.exec("ALTER TABLE daily_meal_plans ADD COLUMN reconciled_by TEXT REFERENCES staff_users(id);");
    }
    if (!planCols.includes("reconciled_at")) {
      db.exec("ALTER TABLE daily_meal_plans ADD COLUMN reconciled_at TEXT;");
    }

    // 2. Add subscription_id to delivery_tasks if not present
    const delCols = (db.prepare("PRAGMA table_info(delivery_tasks)").all() as any[]).map(c => c.name);
    if (!delCols.includes("subscription_id")) {
      db.exec("ALTER TABLE delivery_tasks ADD COLUMN subscription_id TEXT REFERENCES tiffin_subscriptions(id) ON DELETE SET NULL;");
      db.exec("CREATE INDEX IF NOT EXISTS idx_del_tasks_sub ON delivery_tasks(subscription_id);");
    }

    db.pragma("user_version = 14");
  });

  tx();
}

function applyMigrationV15(db: Database.Database): void {
  const tx = db.transaction(() => {
    // 1. Invoices table: make resident_id nullable, add customer_id, subscription_id, invoice_category
    const invCols = (db.prepare("PRAGMA table_info(invoices)").all() as any[]).map(c => c.name);
    if (!invCols.includes("customer_id")) {
      db.exec(`
        CREATE TABLE invoices_v15 (
          id TEXT PRIMARY KEY,
          invoice_number TEXT UNIQUE,
          invoice_type TEXT NOT NULL,
          invoice_category TEXT NOT NULL DEFAULT 'RESIDENT',
          status TEXT NOT NULL DEFAULT 'DRAFT',
          resident_id TEXT REFERENCES residents(id) ON DELETE RESTRICT,
          customer_id TEXT REFERENCES tiffin_customers(id) ON DELETE RESTRICT,
          subscription_id TEXT REFERENCES tiffin_subscriptions(id) ON DELETE SET NULL,
          stay_id TEXT REFERENCES resident_stays(id) ON DELETE RESTRICT,
          issue_date TEXT NOT NULL,
          due_date TEXT NOT NULL,
          billing_period TEXT NOT NULL,
          subtotal INTEGER NOT NULL DEFAULT 0,
          cgst_amount INTEGER NOT NULL DEFAULT 0,
          sgst_amount INTEGER NOT NULL DEFAULT 0,
          igst_amount INTEGER NOT NULL DEFAULT 0,
          total_tax INTEGER NOT NULL DEFAULT 0,
          total_amount INTEGER NOT NULL DEFAULT 0,
          amount_paid INTEGER NOT NULL DEFAULT 0,
          balance_due INTEGER NOT NULL DEFAULT 0,
          company_name TEXT NOT NULL,
          company_address TEXT NOT NULL,
          company_gstin TEXT,
          company_state_code TEXT NOT NULL DEFAULT '06',
          recipient_name TEXT NOT NULL,
          recipient_phone TEXT NOT NULL,
          recipient_email TEXT,
          recipient_address TEXT,
          recipient_gstin TEXT,
          recipient_state_code TEXT NOT NULL DEFAULT '06',
          rent_charge_id TEXT REFERENCES financial_transactions(id) ON DELETE SET NULL,
          notes TEXT,
          cancelled_at TEXT,
          cancellation_reason TEXT,
          created_by TEXT NOT NULL REFERENCES staff_users(id),
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          CHECK (invoice_type IN ('REGULAR_BILL', 'GST_TAX_INVOICE')),
          CHECK (invoice_category IN ('RESIDENT', 'TIFFIN')),
          CHECK (status IN ('DRAFT', 'ISSUED', 'PARTIALLY_PAID', 'PAID', 'CANCELLED')),
          CHECK (subtotal >= 0),
          CHECK (cgst_amount >= 0),
          CHECK (sgst_amount >= 0),
          CHECK (igst_amount >= 0),
          CHECK (total_tax >= 0),
          CHECK (total_amount >= 0),
          CHECK (amount_paid >= 0),
          CHECK (balance_due >= 0)
        );
        INSERT INTO invoices_v15 (
          id, invoice_number, invoice_type, invoice_category, status,
          resident_id, customer_id, subscription_id, stay_id, issue_date,
          due_date, billing_period, subtotal, cgst_amount, sgst_amount,
          igst_amount, total_tax, total_amount, amount_paid, balance_due,
          company_name, company_address, company_gstin, company_state_code,
          recipient_name, recipient_phone, recipient_email, recipient_address,
          recipient_gstin, recipient_state_code, rent_charge_id, notes,
          cancelled_at, cancellation_reason, created_by, created_at, updated_at
        ) SELECT
          id, invoice_number, invoice_type, 'RESIDENT', status,
          resident_id, NULL, NULL, stay_id, issue_date,
          due_date, billing_period, subtotal, cgst_amount, sgst_amount,
          igst_amount, total_tax, total_amount, amount_paid, balance_due,
          company_name, company_address, company_gstin, company_state_code,
          recipient_name, recipient_phone, recipient_email, recipient_address,
          recipient_gstin, recipient_state_code, rent_charge_id, notes,
          cancelled_at, cancellation_reason, created_by, created_at, updated_at
        FROM invoices;
        DROP TABLE invoices;
        ALTER TABLE invoices_v15 RENAME TO invoices;
        CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_number ON invoices(invoice_number);
        CREATE INDEX IF NOT EXISTS idx_invoices_resident ON invoices(resident_id);
        CREATE INDEX IF NOT EXISTS idx_invoices_customer ON invoices(customer_id);
        CREATE INDEX IF NOT EXISTS idx_invoices_sub ON invoices(subscription_id);
        CREATE INDEX IF NOT EXISTS idx_invoices_category ON invoices(invoice_category);
        CREATE INDEX IF NOT EXISTS idx_invoices_stay ON invoices(stay_id);
        CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status);
        CREATE INDEX IF NOT EXISTS idx_invoices_issue_date ON invoices(issue_date);
        CREATE INDEX IF NOT EXISTS idx_invoices_billing_period ON invoices(billing_period);
      `);
    }

    // 2. Delivery tasks: add invoice_id, invoice_item_id, billed_at
    const delCols = (db.prepare("PRAGMA table_info(delivery_tasks)").all() as any[]).map(c => c.name);
    if (!delCols.includes("invoice_id")) {
      db.exec("ALTER TABLE delivery_tasks ADD COLUMN invoice_id TEXT REFERENCES invoices(id) ON DELETE SET NULL;");
      db.exec("CREATE INDEX IF NOT EXISTS idx_del_tasks_inv ON delivery_tasks(invoice_id);");
    }
    if (!delCols.includes("invoice_item_id")) {
      db.exec("ALTER TABLE delivery_tasks ADD COLUMN invoice_item_id TEXT REFERENCES invoice_items(id) ON DELETE SET NULL;");
    }
    if (!delCols.includes("billed_at")) {
      db.exec("ALTER TABLE delivery_tasks ADD COLUMN billed_at TEXT;");
    }

    // 3. Invoice items: add subscription_id, service_start_date, service_end_date
    const itemCols = (db.prepare("PRAGMA table_info(invoice_items)").all() as any[]).map(c => c.name);
    if (!itemCols.includes("subscription_id")) {
      db.exec("ALTER TABLE invoice_items ADD COLUMN subscription_id TEXT REFERENCES tiffin_subscriptions(id) ON DELETE SET NULL;");
    }
    if (!itemCols.includes("service_start_date")) {
      db.exec("ALTER TABLE invoice_items ADD COLUMN service_start_date TEXT;");
    }
    if (!itemCols.includes("service_end_date")) {
      db.exec("ALTER TABLE invoice_items ADD COLUMN service_end_date TEXT;");
    }

    // 4. Financial transactions: add customer_id and expand check constraint
    const txCols = (db.prepare("PRAGMA table_info(financial_transactions)").all() as any[]).map(c => c.name);
    if (!txCols.includes("customer_id")) {
      db.exec(`
        CREATE TABLE financial_transactions_v15 (
          id TEXT PRIMARY KEY,
          transaction_type TEXT NOT NULL CHECK (transaction_type IN ('RENT_CHARGE', 'RENT_PAYMENT', 'SECURITY_DEPOSIT', 'EXPENSE', 'REVERSAL', 'TIFFIN_CHARGE', 'TIFFIN_PAYMENT')),
          amount INTEGER NOT NULL CHECK (amount > 0),
          transaction_date TEXT NOT NULL,
          payment_method TEXT CHECK (payment_method IN ('CASH', 'UPI', 'BANK_TRANSFER', 'CHEQUE', 'OTHER') OR payment_method IS NULL),
          reference_number TEXT,
          resident_id TEXT REFERENCES residents(id) ON DELETE RESTRICT,
          customer_id TEXT REFERENCES tiffin_customers(id) ON DELETE RESTRICT,
          stay_id TEXT REFERENCES resident_stays(id) ON DELETE RESTRICT,
          category TEXT NOT NULL,
          description TEXT,
          billing_period TEXT,
          payee_vendor TEXT,
          idempotency_key TEXT UNIQUE,
          status TEXT NOT NULL DEFAULT 'POSTED' CHECK (status IN ('POSTED', 'REVERSED')),
          reversal_of_id TEXT REFERENCES financial_transactions(id) ON DELETE RESTRICT,
          invoice_id TEXT,
          created_by TEXT NOT NULL REFERENCES staff_users(id),
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        INSERT INTO financial_transactions_v15 (
          id, transaction_type, amount, transaction_date, payment_method,
          reference_number, resident_id, customer_id, stay_id, category,
          description, billing_period, payee_vendor, idempotency_key, status,
          reversal_of_id, invoice_id, created_by, created_at, updated_at
        ) SELECT
          id, transaction_type, amount, transaction_date, payment_method,
          reference_number, resident_id, NULL, stay_id, category,
          description, billing_period, payee_vendor, idempotency_key, status,
          reversal_of_id, invoice_id, created_by, created_at, updated_at
        FROM financial_transactions;
        DROP TABLE financial_transactions;
        ALTER TABLE financial_transactions_v15 RENAME TO financial_transactions;
        CREATE INDEX IF NOT EXISTS idx_fin_tx_type ON financial_transactions(transaction_type);
        CREATE INDEX IF NOT EXISTS idx_fin_tx_date ON financial_transactions(transaction_date);
        CREATE INDEX IF NOT EXISTS idx_fin_tx_resident ON financial_transactions(resident_id);
        CREATE INDEX IF NOT EXISTS idx_fin_tx_customer ON financial_transactions(customer_id);
        CREATE INDEX IF NOT EXISTS idx_fin_tx_stay ON financial_transactions(stay_id);
        CREATE INDEX IF NOT EXISTS idx_fin_tx_category ON financial_transactions(category);
        CREATE INDEX IF NOT EXISTS idx_fin_tx_status ON financial_transactions(status);
        CREATE INDEX IF NOT EXISTS idx_fin_tx_invoice ON financial_transactions(invoice_id);
        CREATE UNIQUE INDEX IF NOT EXISTS idx_fin_tx_idempotency ON financial_transactions(idempotency_key);
      `);
    }

    db.pragma("user_version = 15");
  });

  tx();
}

function applyMigrationV16(db: Database.Database): void {
  const tx = db.transaction(() => {
    // 1. Kitchen Raw Materials
    db.exec(`
      CREATE TABLE IF NOT EXISTS kitchen_raw_materials (
        id TEXT PRIMARY KEY,
        code TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        description TEXT,
        category TEXT NOT NULL CHECK (category IN ('GRAINS', 'PULSES', 'VEGETABLES', 'DAIRY', 'SPICES', 'OILS', 'PACKAGING', 'OTHER')),
        base_unit TEXT NOT NULL CHECK (base_unit IN ('G', 'ML', 'PCS')),
        current_stock INTEGER NOT NULL DEFAULT 0,
        reorder_threshold INTEGER NOT NULL DEFAULT 0 CHECK (reorder_threshold >= 0),
        is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
        created_by TEXT NOT NULL REFERENCES staff_users(id),
        updated_by TEXT REFERENCES staff_users(id),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_krm_code ON kitchen_raw_materials(code);
      CREATE INDEX IF NOT EXISTS idx_krm_category ON kitchen_raw_materials(category);
      CREATE INDEX IF NOT EXISTS idx_krm_active ON kitchen_raw_materials(is_active);
    `);

    // 2. Kitchen Recipes
    db.exec(`
      CREATE TABLE IF NOT EXISTS kitchen_recipes (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        meal_type TEXT CHECK (meal_type IS NULL OR meal_type IN ('BREAKFAST', 'LUNCH', 'DINNER')),
        product_id TEXT REFERENCES tiffin_products(id) ON DELETE SET NULL,
        yield_servings INTEGER NOT NULL DEFAULT 1 CHECK (yield_servings >= 1),
        version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
        is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
        created_by TEXT NOT NULL REFERENCES staff_users(id),
        updated_by TEXT REFERENCES staff_users(id),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_kr_meal_type ON kitchen_recipes(meal_type);
      CREATE INDEX IF NOT EXISTS idx_kr_product ON kitchen_recipes(product_id);
      CREATE INDEX IF NOT EXISTS idx_kr_active ON kitchen_recipes(is_active);
    `);

    // 3. Kitchen Recipe Ingredients
    db.exec(`
      CREATE TABLE IF NOT EXISTS kitchen_recipe_ingredients (
        id TEXT PRIMARY KEY,
        recipe_id TEXT NOT NULL REFERENCES kitchen_recipes(id) ON DELETE CASCADE,
        recipe_version INTEGER NOT NULL DEFAULT 1,
        material_id TEXT NOT NULL REFERENCES kitchen_raw_materials(id) ON DELETE RESTRICT,
        quantity_base INTEGER NOT NULL CHECK (quantity_base > 0),
        display_unit TEXT NOT NULL,
        display_quantity INTEGER NOT NULL,
        loss_percent INTEGER NOT NULL DEFAULT 0 CHECK (loss_percent >= 0 AND loss_percent <= 100),
        notes TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_kri_recipe ON kitchen_recipe_ingredients(recipe_id);
      CREATE INDEX IF NOT EXISTS idx_kri_material ON kitchen_recipe_ingredients(material_id);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_kri_recipe_ver_mat ON kitchen_recipe_ingredients(recipe_id, recipe_version, material_id);
    `);

    // 4. Kitchen Stock Movements
    db.exec(`
      CREATE TABLE IF NOT EXISTS kitchen_stock_movements (
        id TEXT PRIMARY KEY,
        material_id TEXT NOT NULL REFERENCES kitchen_raw_materials(id) ON DELETE RESTRICT,
        movement_type TEXT NOT NULL CHECK (movement_type IN ('OPENING_BALANCE', 'RECEIPT', 'ADJUSTMENT_ADD', 'ADJUSTMENT_SUB', 'PRODUCTION_CONSUMPTION', 'PRODUCTION_REVERSAL', 'WASTE')),
        quantity_base INTEGER NOT NULL,
        unit TEXT NOT NULL,
        source_type TEXT NOT NULL CHECK (source_type IN ('MANUAL', 'PRODUCTION_PLAN', 'WASTE_REPORT')),
        source_id TEXT,
        reason TEXT NOT NULL,
        actor_id TEXT NOT NULL REFERENCES staff_users(id),
        actor_name TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_ksm_material ON kitchen_stock_movements(material_id);
      CREATE INDEX IF NOT EXISTS idx_ksm_type ON kitchen_stock_movements(movement_type);
      CREATE INDEX IF NOT EXISTS idx_ksm_source ON kitchen_stock_movements(source_type, source_id);
      CREATE INDEX IF NOT EXISTS idx_ksm_created ON kitchen_stock_movements(created_at);
    `);

    // 5. Kitchen Production Consumptions
    db.exec(`
      CREATE TABLE IF NOT EXISTS kitchen_production_consumptions (
        id TEXT PRIMARY KEY,
        plan_id TEXT NOT NULL REFERENCES daily_meal_plans(id) ON DELETE RESTRICT,
        meal_type TEXT NOT NULL,
        service_date TEXT NOT NULL,
        recipe_id TEXT NOT NULL REFERENCES kitchen_recipes(id) ON DELETE RESTRICT,
        recipe_version INTEGER NOT NULL DEFAULT 1,
        produced_servings INTEGER NOT NULL CHECK (produced_servings > 0),
        status TEXT NOT NULL DEFAULT 'POSTED' CHECK (status IN ('POSTED', 'REVERSED')),
        notes TEXT,
        posted_by TEXT NOT NULL REFERENCES staff_users(id),
        posted_at TEXT NOT NULL,
        reversed_by TEXT REFERENCES staff_users(id),
        reversed_at TEXT,
        reversal_reason TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_kpc_plan ON kitchen_production_consumptions(plan_id);
      CREATE INDEX IF NOT EXISTS idx_kpc_date ON kitchen_production_consumptions(service_date);
      CREATE INDEX IF NOT EXISTS idx_kpc_status ON kitchen_production_consumptions(status);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_kpc_plan_posted ON kitchen_production_consumptions(plan_id, status);
    `);

    db.pragma("user_version = 16");
  });

  tx();
}

/**
 * Migration V17 (Task 01B.52):
 * 1. Allow DEPOSIT_REFUND in financial_transactions transaction_type CHECK constraint.
 * 2. Create resident_settlements table with unique constraint on stay_id.
 * 3. Advance user_version to 17.
 */
function applyMigrationV17(db: Database.Database): void {
  const tx = db.transaction(() => {
    // 1. Recreate financial_transactions to include DEPOSIT_REFUND
    const finTableExists = db.prepare(`
      SELECT count(*) as count FROM sqlite_master WHERE type='table' AND name='financial_transactions'
    `).get() as { count: number };

    if (finTableExists.count > 0) {
      db.exec(`
        CREATE TABLE financial_transactions_v17 (
          id TEXT PRIMARY KEY,
          transaction_type TEXT NOT NULL CHECK (transaction_type IN ('RENT_CHARGE', 'RENT_PAYMENT', 'SECURITY_DEPOSIT', 'EXPENSE', 'REVERSAL', 'TIFFIN_CHARGE', 'TIFFIN_PAYMENT', 'DEPOSIT_REFUND')),
          amount INTEGER NOT NULL CHECK (amount > 0),
          transaction_date TEXT NOT NULL,
          payment_method TEXT CHECK (payment_method IN ('CASH', 'UPI', 'BANK_TRANSFER', 'CHEQUE', 'OTHER') OR payment_method IS NULL),
          reference_number TEXT,
          resident_id TEXT REFERENCES residents(id) ON DELETE RESTRICT,
          customer_id TEXT REFERENCES tiffin_customers(id) ON DELETE RESTRICT,
          stay_id TEXT REFERENCES resident_stays(id) ON DELETE RESTRICT,
          category TEXT NOT NULL,
          description TEXT,
          billing_period TEXT,
          payee_vendor TEXT,
          idempotency_key TEXT UNIQUE,
          status TEXT NOT NULL DEFAULT 'POSTED' CHECK (status IN ('POSTED', 'REVERSED')),
          reversal_of_id TEXT REFERENCES financial_transactions(id) ON DELETE RESTRICT,
          invoice_id TEXT,
          created_by TEXT NOT NULL REFERENCES staff_users(id),
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        INSERT INTO financial_transactions_v17 (
          id, transaction_type, amount, transaction_date, payment_method,
          reference_number, resident_id, customer_id, stay_id, category,
          description, billing_period, payee_vendor, idempotency_key, status,
          reversal_of_id, invoice_id, created_by, created_at, updated_at
        ) SELECT
          id, transaction_type, amount, transaction_date, payment_method,
          reference_number, resident_id, customer_id, stay_id, category,
          description, billing_period, payee_vendor, idempotency_key, status,
          reversal_of_id, invoice_id, created_by, created_at, updated_at
        FROM financial_transactions;
        DROP TABLE financial_transactions;
        ALTER TABLE financial_transactions_v17 RENAME TO financial_transactions;
        CREATE INDEX IF NOT EXISTS idx_fin_tx_type ON financial_transactions(transaction_type);
        CREATE INDEX IF NOT EXISTS idx_fin_tx_date ON financial_transactions(transaction_date);
        CREATE INDEX IF NOT EXISTS idx_fin_tx_resident ON financial_transactions(resident_id);
        CREATE INDEX IF NOT EXISTS idx_fin_tx_customer ON financial_transactions(customer_id);
        CREATE INDEX IF NOT EXISTS idx_fin_tx_stay ON financial_transactions(stay_id);
        CREATE INDEX IF NOT EXISTS idx_fin_tx_category ON financial_transactions(category);
        CREATE INDEX IF NOT EXISTS idx_fin_tx_status ON financial_transactions(status);
        CREATE INDEX IF NOT EXISTS idx_fin_tx_invoice ON financial_transactions(invoice_id);
        CREATE UNIQUE INDEX IF NOT EXISTS idx_fin_tx_idempotency ON financial_transactions(idempotency_key);
      `);
    }

    // 2. Create resident_settlements table
    db.exec(`
      CREATE TABLE IF NOT EXISTS resident_settlements (
        id TEXT PRIMARY KEY,
        resident_id TEXT NOT NULL REFERENCES residents(id) ON DELETE RESTRICT,
        stay_id TEXT NOT NULL UNIQUE REFERENCES resident_stays(id) ON DELETE RESTRICT,
        room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE RESTRICT,
        checkout_date TEXT NOT NULL,
        outstanding_rent_amount INTEGER NOT NULL DEFAULT 0 CHECK (outstanding_rent_amount >= 0),
        deposit_held_amount INTEGER NOT NULL DEFAULT 0 CHECK (deposit_held_amount >= 0),
        deductions_amount INTEGER NOT NULL DEFAULT 0 CHECK (deductions_amount >= 0),
        deductions_breakdown TEXT,
        deposit_applied_amount INTEGER NOT NULL DEFAULT 0 CHECK (deposit_applied_amount >= 0),
        refund_amount INTEGER NOT NULL DEFAULT 0 CHECK (refund_amount >= 0),
        refund_payment_method TEXT CHECK (refund_payment_method IN ('CASH', 'UPI', 'BANK_TRANSFER', 'CHEQUE', 'OTHER') OR refund_payment_method IS NULL),
        refund_transaction_id TEXT REFERENCES financial_transactions(id) ON DELETE SET NULL,
        remaining_payable_amount INTEGER NOT NULL DEFAULT 0 CHECK (remaining_payable_amount >= 0),
        payment_transaction_id TEXT REFERENCES financial_transactions(id) ON DELETE SET NULL,
        settlement_status TEXT NOT NULL DEFAULT 'SETTLED' CHECK (settlement_status IN ('SETTLED', 'PENDING_PAYMENT')),
        notes TEXT,
        settled_by TEXT NOT NULL REFERENCES staff_users(id),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_resident_settlements_resident ON resident_settlements(resident_id);
      CREATE INDEX IF NOT EXISTS idx_resident_settlements_status ON resident_settlements(settlement_status);
      CREATE INDEX IF NOT EXISTS idx_resident_settlements_checkout_date ON resident_settlements(checkout_date);
    `);

    db.pragma("user_version = 17");
  });

  tx();
}

/**
 * Migration V18:
 * 1. Create daily_cashbook_closings table for multi-channel closing and reconciliation.
 * 2. Advance user_version to 18.
 */
function applyMigrationV18(db: Database.Database): void {
  const tx = db.transaction(() => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS daily_cashbook_closings (
        id TEXT PRIMARY KEY,
        closing_date TEXT NOT NULL,
        division TEXT NOT NULL DEFAULT 'COMBINED',
        opening_balance INTEGER NOT NULL DEFAULT 0,
        opening_cash_balance INTEGER NOT NULL DEFAULT 0,
        cash_inflow INTEGER NOT NULL DEFAULT 0,
        upi_inflow INTEGER NOT NULL DEFAULT 0,
        bank_transfer_inflow INTEGER NOT NULL DEFAULT 0,
        cheque_inflow INTEGER NOT NULL DEFAULT 0,
        other_inflow INTEGER NOT NULL DEFAULT 0,
        cash_outflow INTEGER NOT NULL DEFAULT 0,
        upi_outflow INTEGER NOT NULL DEFAULT 0,
        bank_transfer_outflow INTEGER NOT NULL DEFAULT 0,
        cheque_outflow INTEGER NOT NULL DEFAULT 0,
        other_outflow INTEGER NOT NULL DEFAULT 0,
        total_inflow INTEGER NOT NULL DEFAULT 0,
        total_outflow INTEGER NOT NULL DEFAULT 0,
        expected_closing_balance INTEGER NOT NULL DEFAULT 0,
        expected_cash_balance INTEGER NOT NULL DEFAULT 0,
        actual_cash_counted INTEGER,
        actual_bank_verified INTEGER,
        actual_total_balance INTEGER,
        cash_discrepancy INTEGER NOT NULL DEFAULT 0,
        total_discrepancy INTEGER NOT NULL DEFAULT 0,
        discrepancy_reason TEXT,
        status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'FINALIZED', 'REOPENED')),
        prepared_by TEXT NOT NULL REFERENCES staff_users(id),
        finalized_by TEXT REFERENCES staff_users(id),
        finalized_at TEXT,
        reopened_by TEXT REFERENCES staff_users(id),
        reopened_at TEXT,
        reopen_reason TEXT,
        notes TEXT,
        snapshot_data TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (closing_date, division)
      );

      CREATE INDEX IF NOT EXISTS idx_closing_date ON daily_cashbook_closings(closing_date);
      CREATE INDEX IF NOT EXISTS idx_closing_status ON daily_cashbook_closings(status);
      CREATE INDEX IF NOT EXISTS idx_closing_division ON daily_cashbook_closings(division);
    `);

    db.pragma("user_version = 18");
  });

  tx();
}

/**
 * Migration V19:
 * 1. Create document_attachments table for secure KYC & financial receipt management.
 * 2. Advance user_version to 19.
 */
function applyMigrationV19(db: Database.Database): void {
  const tx = db.transaction(() => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS document_attachments (
        id TEXT PRIMARY KEY,
        category TEXT NOT NULL CHECK (category IN ('RESIDENT_KYC', 'RESIDENT_ADDRESS_PROOF', 'RENT_RECEIPT', 'SECURITY_DEPOSIT_RECEIPT', 'CHECKOUT_SETTLEMENT_RECEIPT', 'EXPENSE_RECEIPT', 'OPERATIONAL_ATTACHMENT')),
        resident_id TEXT REFERENCES residents(id) ON DELETE RESTRICT,
        stay_id TEXT REFERENCES resident_stays(id) ON DELETE SET NULL,
        transaction_id TEXT REFERENCES financial_transactions(id) ON DELETE SET NULL,
        invoice_id TEXT REFERENCES invoices(id) ON DELETE SET NULL,
        settlement_id TEXT REFERENCES resident_settlements(id) ON DELETE SET NULL,
        display_filename TEXT NOT NULL,
        mime_type TEXT NOT NULL,
        file_size INTEGER NOT NULL CHECK (file_size > 0 AND file_size <= 5242880),
        file_hash TEXT NOT NULL,
        storage_path TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'SUPERSEDED', 'ARCHIVED')),
        superseded_by TEXT REFERENCES document_attachments(id),
        notes TEXT,
        uploaded_by TEXT NOT NULL REFERENCES staff_users(id),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_docs_category ON document_attachments(category);
      CREATE INDEX IF NOT EXISTS idx_docs_resident ON document_attachments(resident_id);
      CREATE INDEX IF NOT EXISTS idx_docs_stay ON document_attachments(stay_id);
      CREATE INDEX IF NOT EXISTS idx_docs_tx ON document_attachments(transaction_id);
      CREATE INDEX IF NOT EXISTS idx_docs_invoice ON document_attachments(invoice_id);
      CREATE INDEX IF NOT EXISTS idx_docs_settlement ON document_attachments(settlement_id);
      CREATE INDEX IF NOT EXISTS idx_docs_status ON document_attachments(status);
    `);

    db.pragma("user_version = 19");
  });

  tx();
}

/**
 * Migration V20:
 * 1. Add collection fields to delivery_tasks (collection_status, collected_amount, collected_payment_method, collection_transaction_id, collection_idempotency_key, handover_id).
 * 2. Create driver_cash_handovers table for formal driver cash custody settlements.
 * 3. Advance user_version to 20.
 */
function applyMigrationV20(db: Database.Database): void {
  const tx = db.transaction(() => {
    // 1. Check existing columns on delivery_tasks
    const columns = db.prepare("PRAGMA table_info(delivery_tasks)").all() as Array<{ name: string }>;
    const colNames = new Set(columns.map((c) => c.name));

    if (!colNames.has("collection_status")) {
      db.exec("ALTER TABLE delivery_tasks ADD COLUMN collection_status TEXT NOT NULL DEFAULT 'NONE' CHECK (collection_status IN ('NONE', 'COLLECTED', 'HANDED_OVER'))");
    }
    if (!colNames.has("collected_amount")) {
      db.exec("ALTER TABLE delivery_tasks ADD COLUMN collected_amount INTEGER NOT NULL DEFAULT 0 CHECK (collected_amount >= 0)");
    }
    if (!colNames.has("collected_payment_method")) {
      db.exec("ALTER TABLE delivery_tasks ADD COLUMN collected_payment_method TEXT CHECK (collected_payment_method IS NULL OR collected_payment_method IN ('CASH', 'UPI', 'BANK_TRANSFER', 'CHEQUE', 'OTHER'))");
    }
    if (!colNames.has("collection_transaction_id")) {
      db.exec("ALTER TABLE delivery_tasks ADD COLUMN collection_transaction_id TEXT REFERENCES financial_transactions(id) ON DELETE SET NULL");
    }
    if (!colNames.has("collection_idempotency_key")) {
      db.exec("ALTER TABLE delivery_tasks ADD COLUMN collection_idempotency_key TEXT");
    }
    if (!colNames.has("handover_id")) {
      db.exec("ALTER TABLE delivery_tasks ADD COLUMN handover_id TEXT REFERENCES driver_cash_handovers(id) ON DELETE SET NULL");
    }

    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_del_tasks_collection_status ON delivery_tasks(collection_status);
      CREATE INDEX IF NOT EXISTS idx_del_tasks_handover ON delivery_tasks(handover_id);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_del_tasks_coll_idempotency ON delivery_tasks(collection_idempotency_key);

      CREATE TABLE IF NOT EXISTS driver_cash_handovers (
        id TEXT PRIMARY KEY,
        driver_id TEXT NOT NULL REFERENCES staff_users(id) ON DELETE RESTRICT,
        shift_date TEXT NOT NULL,
        declared_cash INTEGER NOT NULL DEFAULT 0 CHECK (declared_cash >= 0),
        accepted_cash INTEGER NOT NULL DEFAULT 0 CHECK (accepted_cash >= 0),
        variance INTEGER NOT NULL DEFAULT 0,
        variance_reason TEXT,
        status TEXT NOT NULL DEFAULT 'DECLARED' CHECK (status IN ('DECLARED', 'ACCEPTED', 'DISCREPANCY_FLAGGED')),
        transaction_id TEXT REFERENCES financial_transactions(id) ON DELETE SET NULL,
        accepted_by TEXT REFERENCES staff_users(id) ON DELETE SET NULL,
        accepted_at TEXT,
        notes TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_dch_driver ON driver_cash_handovers(driver_id);
      CREATE INDEX IF NOT EXISTS idx_dch_shift_date ON driver_cash_handovers(shift_date);
      CREATE INDEX IF NOT EXISTS idx_dch_status ON driver_cash_handovers(status);
      CREATE INDEX IF NOT EXISTS idx_dch_tx ON driver_cash_handovers(transaction_id);
    `);

    db.pragma("user_version = 20");
  });

  tx();
}

/**
 * Migration V21 (mirrors PostgreSQL migration 0012_orders):
 * 1. Create orders and order_items (first-class order storage, ISSUE-008 / ISSUE-024).
 * 2. Advance user_version to 21.
 */
function applyMigrationV21(db: Database.Database): void {
  const tx = db.transaction(() => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS orders (
        id TEXT PRIMARY KEY NOT NULL,
        order_type TEXT NOT NULL CHECK (order_type IN ('DELIVERY', 'DINE_IN')),
        status TEXT NOT NULL DEFAULT 'CONFIRMED' CHECK (status IN ('CONFIRMED', 'COMPLETED', 'CANCELLED')),
        service_date TEXT NOT NULL,
        meal_type TEXT NOT NULL CHECK (meal_type IN ('BREAKFAST', 'LUNCH', 'DINNER')),
        customer_id TEXT REFERENCES tiffin_customers(id) ON DELETE RESTRICT,
        customer_name TEXT NOT NULL,
        customer_phone TEXT,
        delivery_address TEXT,
        delivery_task_id TEXT UNIQUE REFERENCES delivery_tasks(id) ON DELETE RESTRICT,
        financial_transaction_id TEXT UNIQUE REFERENCES financial_transactions(id) ON DELETE RESTRICT,
        total_quantity INTEGER NOT NULL CHECK (total_quantity > 0),
        total_amount INTEGER NOT NULL CHECK (total_amount >= 0),
        payment_method TEXT CHECK (payment_method IS NULL OR payment_method IN ('CASH', 'UPI', 'BANK_TRANSFER', 'CHEQUE', 'OTHER')),
        notes TEXT,
        idempotency_key TEXT UNIQUE,
        source TEXT NOT NULL DEFAULT 'APP' CHECK (source IN ('APP', 'LEGACY_BACKFILL')),
        created_by TEXT REFERENCES staff_users(id),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        CHECK (
          (order_type = 'DELIVERY' AND delivery_task_id IS NOT NULL AND financial_transaction_id IS NULL)
          OR (order_type = 'DINE_IN' AND financial_transaction_id IS NOT NULL AND delivery_task_id IS NULL)
        )
      );

      CREATE TABLE IF NOT EXISTS order_items (
        id TEXT PRIMARY KEY NOT NULL,
        order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
        line_no INTEGER NOT NULL,
        product_id TEXT REFERENCES tiffin_products(id) ON DELETE SET NULL,
        product_name TEXT NOT NULL,
        quantity INTEGER NOT NULL CHECK (quantity > 0),
        unit_price INTEGER NOT NULL CHECK (unit_price >= 0),
        line_total INTEGER NOT NULL,
        delivered_quantity INTEGER CHECK (delivered_quantity IS NULL OR (delivered_quantity >= 0 AND delivered_quantity <= quantity)),
        undelivered_reason TEXT,
        created_at TEXT NOT NULL,
        UNIQUE (order_id, line_no),
        CHECK (line_total = quantity * unit_price)
      );

      CREATE INDEX IF NOT EXISTS idx_orders_service_date ON orders(service_date);
      CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders(customer_id);
      CREATE INDEX IF NOT EXISTS idx_orders_customer_phone ON orders(customer_phone);
      CREATE INDEX IF NOT EXISTS idx_orders_type_date ON orders(order_type, service_date);
      CREATE INDEX IF NOT EXISTS idx_order_items_product ON order_items(product_id);
    `);

    db.pragma("user_version = 21");
  });

  tx();
}

/**
 * Migration V22 (mirrors PostgreSQL migration 0013_custody_ledger):
 * 1. Create delivery_collections (one row per payment, attributed to the collecting staff member).
 * 2. Add declared_upi, accepted_upi, upi_transaction_id, declared_by to driver_cash_handovers.
 * 3. Copy existing task-level collections once (deterministic ids).
 * 4. Advance user_version to 22.
 */
function applyMigrationV22(db: Database.Database): void {
  const tx = db.transaction(() => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS delivery_collections (
        id TEXT PRIMARY KEY NOT NULL,
        delivery_task_id TEXT NOT NULL REFERENCES delivery_tasks(id) ON DELETE RESTRICT,
        order_id TEXT REFERENCES orders(id) ON DELETE SET NULL,
        collected_by TEXT NOT NULL REFERENCES staff_users(id) ON DELETE RESTRICT,
        amount INTEGER NOT NULL CHECK (amount > 0),
        payment_method TEXT NOT NULL CHECK (payment_method IN ('CASH', 'UPI', 'BANK_TRANSFER', 'CHEQUE', 'OTHER')),
        collected_at TEXT NOT NULL,
        handover_id TEXT REFERENCES driver_cash_handovers(id) ON DELETE RESTRICT,
        idempotency_key TEXT UNIQUE,
        source TEXT NOT NULL DEFAULT 'APP' CHECK (source IN ('APP', 'BACKFILL')),
        notes TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_dcol_collector_handover ON delivery_collections(collected_by, handover_id);
      CREATE INDEX IF NOT EXISTS idx_dcol_task ON delivery_collections(delivery_task_id);
      CREATE INDEX IF NOT EXISTS idx_dcol_handover ON delivery_collections(handover_id);
    `);
    const cols = (db.prepare("PRAGMA table_info(driver_cash_handovers)").all() as Array<{ name: string }>).map((c) => c.name);
    if (!cols.includes("declared_upi")) db.exec("ALTER TABLE driver_cash_handovers ADD COLUMN declared_upi INTEGER NOT NULL DEFAULT 0 CHECK (declared_upi >= 0)");
    if (!cols.includes("accepted_upi")) db.exec("ALTER TABLE driver_cash_handovers ADD COLUMN accepted_upi INTEGER NOT NULL DEFAULT 0 CHECK (accepted_upi >= 0)");
    if (!cols.includes("upi_transaction_id")) db.exec("ALTER TABLE driver_cash_handovers ADD COLUMN upi_transaction_id TEXT REFERENCES financial_transactions(id) ON DELETE SET NULL");
    if (!cols.includes("declared_by")) db.exec("ALTER TABLE driver_cash_handovers ADD COLUMN declared_by TEXT REFERENCES staff_users(id) ON DELETE SET NULL");
    db.exec(`
      INSERT OR IGNORE INTO delivery_collections (id, delivery_task_id, order_id, collected_by, amount, payment_method, collected_at, handover_id, idempotency_key, source, notes, created_at)
      SELECT 'dcol_bf_' || t.id, t.id, o.id, COALESCE(t.delivered_by, t.assigned_to), t.collected_amount,
             CASE WHEN t.collected_payment_method IN ('CASH', 'UPI', 'BANK_TRANSFER', 'CHEQUE', 'OTHER') THEN t.collected_payment_method ELSE 'CASH' END,
             COALESCE(t.delivered_at, t.updated_at),
             CASE WHEN t.collection_status = 'HANDED_OVER' AND EXISTS (SELECT 1 FROM driver_cash_handovers h WHERE h.id = t.handover_id) THEN t.handover_id ELSE NULL END,
             NULL, 'BACKFILL', 'Copied from the delivery task total (migration V22)', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM delivery_tasks t LEFT JOIN orders o ON o.delivery_task_id = t.id
      WHERE t.collected_amount > 0 AND COALESCE(t.delivered_by, t.assigned_to) IS NOT NULL
        AND EXISTS (SELECT 1 FROM staff_users s WHERE s.id = COALESCE(t.delivered_by, t.assigned_to));
    `);
    db.pragma("user_version = 22");
  });

  tx();
}

