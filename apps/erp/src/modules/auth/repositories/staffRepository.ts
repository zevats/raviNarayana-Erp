import { getDb } from "@/server/database/db";
import { StaffUser } from "@/types";

export class StaffRepository {
  static findById(id: string): StaffUser | null {
    const db = getDb();
    const row = db.prepare(`
      SELECT id, username, email, full_name as fullName, role, is_active as isActive,
             created_at as createdAt, updated_at as updatedAt, last_login_at as lastLoginAt
      FROM staff_users
      WHERE id = ?
    `).get(id) as StaffUser | undefined;

    return row || null;
  }

  static findByIdentifierWithPassword(identifier: string): (StaffUser & { password_hash: string }) | null {
    const db = getDb();
    const clean = identifier.trim().toLowerCase();
    const row = db.prepare(`
      SELECT id, username, email, full_name as fullName, password_hash, role, is_active as isActive,
             created_at as createdAt, updated_at as updatedAt, last_login_at as lastLoginAt
      FROM staff_users
      WHERE (LOWER(username) = ? OR LOWER(email) = ?) AND is_active = 1
    `).get(clean, clean) as (StaffUser & { password_hash: string }) | undefined;

    return row || null;
  }
}
