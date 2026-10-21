import { getAsyncDb, AsyncDb } from "@/server/database/db";
import { StaffUser } from "@/types";

export class StaffRepository {
  static async findById(id: string, asyncDb?: AsyncDb): Promise<StaffUser | null> {
    const db = asyncDb ?? getAsyncDb();
    const row = await db.queryOne<any>(`
      SELECT id, username, email, full_name as "fullName", role, is_active as "isActive",
             created_at as "createdAt", updated_at as "updatedAt", last_login_at as "lastLoginAt"
      FROM staff_users
      WHERE id = ?
    `, [id]);

    if (!row) return null;
    return {
      ...row,
      isActive: Boolean(row.isActive),
    };
  }

  static async findByIdentifierWithPassword(
    identifier: string,
    asyncDb?: AsyncDb
  ): Promise<(StaffUser & { password_hash: string }) | null> {
    const db = asyncDb ?? getAsyncDb();
    const clean = identifier.trim().toLowerCase();
    const row = await db.queryOne<any>(`
      SELECT id, username, email, full_name as "fullName", password_hash, role, is_active as "isActive",
             created_at as "createdAt", updated_at as "updatedAt", last_login_at as "lastLoginAt"
      FROM staff_users
      WHERE (LOWER(username) = ? OR LOWER(email) = ?) AND is_active = 1
    `, [clean, clean]);

    if (!row) return null;
    return {
      ...row,
      isActive: Boolean(row.isActive),
    };
  }
}
