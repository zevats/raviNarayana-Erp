import crypto from "crypto";
import { getAsyncDb, AsyncDb } from "../database/db";
import { requirePermission } from "../authorization/authorize";
import { recordAuditEventAsync } from "../audit/audit";
import {
  AuthenticatedUser,
  TiffinCustomer,
  CreateTiffinCustomerInput,
  UpdateTiffinCustomerInput,
  CustomerStatus,
  CustomerType,
  DietaryPreference,
  TiffinProduct,
  CreateTiffinProductInput,
  UpdateTiffinProductInput,
  ProductCategory,
  BillingUnit,
  ProductStatus,
  TiffinSubscription,
  CreateTiffinSubscriptionInput,
  UpdateTiffinSubscriptionInput,
  PauseTiffinSubscriptionInput,
  CancelTiffinSubscriptionInput,
  SubscriptionStatus,
  SubscriptionMealTypes,
  SubscriptionServiceDays,
} from "@/types";

/**
 * Normalizes phone numbers to standard 10-digit Indian mobile or clean E.164 international format.
 */
export function normalizePhoneNumber(rawPhone: string): string {
  if (!rawPhone || typeof rawPhone !== "string") {
    throw new Error("Phone number is required.");
  }

  // Remove whitespace, hyphens, dots, parentheses
  let cleaned = rawPhone.trim().replace(/[\s\-\.\(\)]/g, "");

  // Handle Indian phone prefix +91 (13 chars), 91 (12 digits), or leading 0 (11 digits)
  if (cleaned.startsWith("+91") && cleaned.length === 13) {
    cleaned = cleaned.slice(3);
  } else if (cleaned.startsWith("91") && cleaned.length === 12) {
    cleaned = cleaned.slice(2);
  } else if (cleaned.startsWith("0") && cleaned.length === 11) {
    cleaned = cleaned.slice(1);
  }

  // Standard Indian 10-digit number
  if (/^[6-9]\d{9}$/.test(cleaned) || /^\d{10}$/.test(cleaned)) {
    return cleaned;
  }

  // International format starting with +
  if (cleaned.startsWith("+")) {
    const digitsOnly = cleaned.slice(1);
    if (!/^\d{7,15}$/.test(digitsOnly)) {
      throw new Error(`Invalid international phone format '${rawPhone}'. Must be + followed by 7-15 digits.`);
    }
    return cleaned;
  }

  throw new Error(
    `Invalid phone number format '${rawPhone}'. Must be a valid 10-digit mobile number or E.164 international format.`
  );
}

function mapRowToCustomer(row: any): TiffinCustomer {
  return {
    id: row.id,
    fullName: row.full_name,
    phone: row.phone,
    alternatePhone: row.alternate_phone || null,
    deliveryAddress: row.delivery_address,
    landmark: row.landmark || null,
    deliveryInstructions: row.delivery_instructions || null,
    customerType: row.customer_type as CustomerType,
    dietaryPreference: row.dietary_preference as DietaryPreference,
    status: row.status as CustomerStatus,
    notes: row.notes || null,
    createdBy: row.created_by,
    createdByName: row.created_by_name || null,
    updatedBy: row.updated_by || null,
    updatedByName: row.updated_by_name || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapRowToProduct(row: any): TiffinProduct {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    description: row.description || null,
    category: row.category as ProductCategory,
    billingUnit: row.billing_unit as BillingUnit,
    price: Number(row.price),
    currency: row.currency || "INR",
    status: row.status as ProductStatus,
    createdBy: row.created_by,
    createdByName: row.created_by_name || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ============================================================================
// 1. TIFFIN CUSTOMER DIRECTORY SERVICES
// ============================================================================

export interface ListTiffinCustomersOptions {
  search?: string;
  status?: CustomerStatus;
  customerType?: CustomerType;
  dietaryPreference?: DietaryPreference;
  limit?: number;
  offset?: number;
}

/**
 * Lists and searches Tiffin customers with optional status and type filters.
 */
export async function listTiffinCustomers(
  actor: AuthenticatedUser,
  options: ListTiffinCustomersOptions = {},
  asyncDb?: AsyncDb
): Promise<{ customers: TiffinCustomer[]; total: number }> {
  const db = asyncDb ?? getAsyncDb();
  requirePermission(actor, "tiffin.read");

  const conditions: string[] = [];
  const params: any[] = [];

  if (options.status) {
    conditions.push("c.status = ?");
    params.push(options.status);
  }

  if (options.customerType) {
    conditions.push("c.customer_type = ?");
    params.push(options.customerType);
  }

  if (options.dietaryPreference) {
    conditions.push("c.dietary_preference = ?");
    params.push(options.dietaryPreference);
  }

  if (options.search && options.search.trim().length > 0) {
    const term = `%${options.search.trim().toLowerCase()}%`;
    conditions.push(
      "(lower(c.full_name) LIKE ? OR c.phone LIKE ? OR lower(c.delivery_address) LIKE ? OR lower(COALESCE(c.landmark, '')) LIKE ?)"
    );
    params.push(term, term, term, term);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const countRow = await db.queryOne<{ count: number | string }>(`
    SELECT COUNT(*) as count
    FROM tiffin_customers c
    ${whereClause}
  `, params);

  const total = Number(countRow?.count || 0);

  const limit = Math.min(Math.max(1, options.limit ?? 50), 200);
  const offset = Math.max(0, options.offset ?? 0);

  const rows = await db.query<any>(`
    SELECT
      c.*,
      u1.full_name as created_by_name,
      u2.full_name as updated_by_name
    FROM tiffin_customers c
    LEFT JOIN staff_users u1 ON c.created_by = u1.id
    LEFT JOIN staff_users u2 ON c.updated_by = u2.id
    ${whereClause}
    ORDER BY c.created_at DESC
    LIMIT ? OFFSET ?
  `, [...params, limit, offset]);

  const customers = rows.map(mapRowToCustomer);

  return { customers, total };
}

/**
 * Retrieves a customer by ID.
 */
export async function getTiffinCustomerById(
  actor: AuthenticatedUser,
  id: string,
  asyncDb?: AsyncDb
): Promise<TiffinCustomer | null> {
  const db = asyncDb ?? getAsyncDb();
  requirePermission(actor, "tiffin.read");

  const row = await db.queryOne<any>(`
    SELECT
      c.*,
      u1.full_name as created_by_name,
      u2.full_name as updated_by_name
    FROM tiffin_customers c
    LEFT JOIN staff_users u1 ON c.created_by = u1.id
    LEFT JOIN staff_users u2 ON c.updated_by = u2.id
    WHERE c.id = ?
  `, [id]);

  if (!row) return null;
  return mapRowToCustomer(row);
}

/**
 * Checks for existing customers sharing a normalized phone number.
 */
export async function findPotentialDuplicateCustomers(
  phone: string,
  excludeId?: string,
  asyncDb?: AsyncDb
): Promise<TiffinCustomer[]> {
  const db = asyncDb ?? getAsyncDb();
  let normalized: string;
  try {
    normalized = normalizePhoneNumber(phone);
  } catch {
    return [];
  }

  const params: any[] = [normalized, normalized];
  let excludeClause = "";
  if (excludeId) {
    excludeClause = "AND id != ?";
    params.push(excludeId);
  }

  const rows = await db.query<any>(`
    SELECT *
    FROM tiffin_customers
    WHERE (phone = ? OR alternate_phone = ?)
      ${excludeClause}
    ORDER BY created_at DESC
  `, params);

  return rows.map(mapRowToCustomer);
}

/**
 * Creates a new Tiffin customer with duplicate checking and phone normalization.
 */
export async function createTiffinCustomer(
  actor: AuthenticatedUser,
  input: CreateTiffinCustomerInput,
  clientIpOrDb?: string | AsyncDb,
  asyncDb?: AsyncDb
): Promise<TiffinCustomer> {
  let clientIp: string | undefined;
  let dbInstance = asyncDb;

  if (typeof clientIpOrDb === "string") {
    clientIp = clientIpOrDb;
  } else if (clientIpOrDb && typeof clientIpOrDb === "object") {
    dbInstance = clientIpOrDb;
  }
  const db = dbInstance ?? getAsyncDb();

  requirePermission(actor, "tiffin.manage", { ip: clientIp, action: "tiffin.customer_created" });

  const fullName = input.fullName?.trim();
  if (!fullName || fullName.length < 2) {
    throw new Error("Customer full name must be at least 2 characters long.");
  }

  const normalizedPhone = normalizePhoneNumber(input.phone);
  let normalizedAltPhone: string | null = null;
  if (input.alternatePhone && input.alternatePhone.trim().length > 0) {
    normalizedAltPhone = normalizePhoneNumber(input.alternatePhone);
  }

  const deliveryAddress = input.deliveryAddress?.trim();
  if (!deliveryAddress || deliveryAddress.length < 5) {
    throw new Error("Delivery address must be at least 5 characters long.");
  }

  const customerType: CustomerType = input.customerType || "INDIVIDUAL";
  if (!["INDIVIDUAL", "CORPORATE", "RESIDENTIAL_PG"].includes(customerType)) {
    throw new Error(`Invalid customer type '${customerType}'.`);
  }

  const dietaryPreference: DietaryPreference = input.dietaryPreference || "VEG";
  if (!["VEG", "NON_VEG", "JAIN"].includes(dietaryPreference)) {
    throw new Error(`Invalid dietary preference '${dietaryPreference}'.`);
  }

  // Duplicate Check
  const duplicates = await findPotentialDuplicateCustomers(normalizedPhone, undefined, db);
  if (duplicates.length > 0 && !input.confirmDuplicate) {
    const existing = duplicates[0];
    throw new Error(
      `POTENTIAL_DUPLICATE: A customer with phone number '${normalizedPhone}' already exists: '${existing.fullName}' (${existing.status}, ID: ${existing.id}). Set confirmDuplicate to true to confirm creation for shared phone contact.`
    );
  }

  const id = `cust_${crypto.randomUUID()}`;
  const now = new Date().toISOString();

  await db.transaction(async (tx) => {
    await tx.execute(`
      INSERT INTO tiffin_customers (
        id, full_name, phone, alternate_phone, delivery_address,
        landmark, delivery_instructions, customer_type, dietary_preference,
        status, notes, created_by, updated_by, created_at, updated_at
      ) VALUES (
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?,
        'ACTIVE', ?, ?, NULL, ?, ?
      )
    `, [
      id,
      fullName,
      normalizedPhone,
      normalizedAltPhone,
      deliveryAddress,
      input.landmark?.trim() || null,
      input.deliveryInstructions?.trim() || null,
      customerType,
      dietaryPreference,
      input.notes?.trim() || null,
      actor.id,
      now,
      now,
    ]);

    await recordAuditEventAsync({
      actorId: actor.id,
      actorUsername: actor.username,
      action: "tiffin.customer_created",
      targetType: "tiffin_customer",
      targetId: id,
      metadata: {
        fullName,
        phone: normalizedPhone,
        customerType,
        deliveryAddress,
      },
      ipAddress: clientIp,
    }, tx);
  });

  return (await getTiffinCustomerById(actor, id, db))!;
}

/**
 * Updates an existing Tiffin customer's profile.
 */
export async function updateTiffinCustomer(
  actor: AuthenticatedUser,
  id: string,
  input: UpdateTiffinCustomerInput,
  clientIpOrDb?: string | AsyncDb,
  asyncDb?: AsyncDb
): Promise<TiffinCustomer> {
  let clientIp: string | undefined;
  let dbInstance = asyncDb;

  if (typeof clientIpOrDb === "string") {
    clientIp = clientIpOrDb;
  } else if (clientIpOrDb && typeof clientIpOrDb === "object") {
    dbInstance = clientIpOrDb;
  }
  const db = dbInstance ?? getAsyncDb();

  requirePermission(actor, "tiffin.manage", { ip: clientIp, action: "tiffin.customer_updated" });

  const current = await getTiffinCustomerById(actor, id, db);
  if (!current) {
    throw new Error(`Customer '${id}' not found.`);
  }

  const fullName = input.fullName !== undefined ? input.fullName.trim() : current.fullName;
  if (!fullName || fullName.length < 2) {
    throw new Error("Customer full name must be at least 2 characters long.");
  }

  let normalizedPhone = current.phone;
  if (input.phone !== undefined) {
    normalizedPhone = normalizePhoneNumber(input.phone);
  }

  let normalizedAltPhone = current.alternatePhone;
  if (input.alternatePhone !== undefined) {
    normalizedAltPhone = input.alternatePhone && input.alternatePhone.trim().length > 0
      ? normalizePhoneNumber(input.alternatePhone)
      : null;
  }

  const deliveryAddress = input.deliveryAddress !== undefined ? input.deliveryAddress.trim() : current.deliveryAddress;
  if (!deliveryAddress || deliveryAddress.length < 5) {
    throw new Error("Delivery address must be at least 5 characters long.");
  }

  const customerType: CustomerType = input.customerType || current.customerType;
  const dietaryPreference: DietaryPreference = input.dietaryPreference || current.dietaryPreference;
  const landmark = input.landmark !== undefined ? (input.landmark?.trim() || null) : current.landmark;
  const deliveryInstructions = input.deliveryInstructions !== undefined
    ? (input.deliveryInstructions?.trim() || null)
    : current.deliveryInstructions;
  const notes = input.notes !== undefined ? (input.notes?.trim() || null) : current.notes;

  const now = new Date().toISOString();

  await db.transaction(async (tx) => {
    await tx.execute(`
      UPDATE tiffin_customers
      SET full_name = ?,
          phone = ?,
          alternate_phone = ?,
          delivery_address = ?,
          landmark = ?,
          delivery_instructions = ?,
          customer_type = ?,
          dietary_preference = ?,
          notes = ?,
          updated_by = ?,
          updated_at = ?
      WHERE id = ?
    `, [
      fullName,
      normalizedPhone,
      normalizedAltPhone,
      deliveryAddress,
      landmark,
      deliveryInstructions,
      customerType,
      dietaryPreference,
      notes,
      actor.id,
      now,
      id,
    ]);

    await recordAuditEventAsync({
      actorId: actor.id,
      actorUsername: actor.username,
      action: "tiffin.customer_updated",
      targetType: "tiffin_customer",
      targetId: id,
      metadata: {
        fullName,
        phone: normalizedPhone,
      },
      ipAddress: clientIp,
    }, tx);
  });

  return (await getTiffinCustomerById(actor, id, db))!;
}

/**
 * Activates or deactivates a Tiffin customer.
 * Deactivation preserves all historical records, past deliveries, and accounting.
 */
export async function setTiffinCustomerStatus(
  actor: AuthenticatedUser,
  id: string,
  status: CustomerStatus,
  clientIpOrDb?: string | AsyncDb,
  asyncDb?: AsyncDb
): Promise<TiffinCustomer> {
  let clientIp: string | undefined;
  let dbInstance = asyncDb;

  if (typeof clientIpOrDb === "string") {
    clientIp = clientIpOrDb;
  } else if (clientIpOrDb && typeof clientIpOrDb === "object") {
    dbInstance = clientIpOrDb;
  }
  const db = dbInstance ?? getAsyncDb();

  requirePermission(actor, "tiffin.manage", {
    ip: clientIp,
    action: status === "ACTIVE" ? "tiffin.customer_activated" : "tiffin.customer_deactivated",
  });

  const current = await getTiffinCustomerById(actor, id, db);
  if (!current) {
    throw new Error(`Customer '${id}' not found.`);
  }

  if (current.status === status) {
    return current;
  }

  const now = new Date().toISOString();

  await db.transaction(async (tx) => {
    await tx.execute(`
      UPDATE tiffin_customers
      SET status = ?,
          updated_by = ?,
          updated_at = ?
      WHERE id = ?
    `, [status, actor.id, now, id]);

    await recordAuditEventAsync({
      actorId: actor.id,
      actorUsername: actor.username,
      action: status === "ACTIVE" ? "tiffin.customer_activated" : "tiffin.customer_deactivated",
      targetType: "tiffin_customer",
      targetId: id,
      metadata: {
        previousStatus: current.status,
        newStatus: status,
      },
      ipAddress: clientIp,
    }, tx);
  });

  return (await getTiffinCustomerById(actor, id, db))!;
}

// ============================================================================
// 2. TIFFIN MEAL & PACKAGE PRICING CATALOG SERVICES
// ============================================================================

export interface ListTiffinProductsOptions {
  category?: ProductCategory;
  status?: ProductStatus;
}

/**
 * Lists catalog products and pricing.
 */
export async function listTiffinProducts(
  actor: AuthenticatedUser,
  options: ListTiffinProductsOptions = {},
  asyncDb?: AsyncDb
): Promise<TiffinProduct[]> {
  const db = asyncDb ?? getAsyncDb();
  requirePermission(actor, "tiffin.read");

  const conditions: string[] = [];
  const params: any[] = [];

  if (options.category) {
    conditions.push("p.category = ?");
    params.push(options.category);
  }

  if (options.status) {
    conditions.push("p.status = ?");
    params.push(options.status);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const rows = await db.query<any>(`
    SELECT
      p.*,
      u.full_name as created_by_name
    FROM tiffin_products p
    LEFT JOIN staff_users u ON p.created_by = u.id
    ${whereClause}
    ORDER BY
      CASE p.category
        WHEN 'STANDARD_MEAL' THEN 1
        WHEN 'SUBSCRIPTION_PACKAGE' THEN 2
        WHEN 'SPECIAL' THEN 3
        WHEN 'EXTRA' THEN 4
        WHEN 'BEVERAGE' THEN 5
        ELSE 6
      END,
      p.price ASC
  `, params);

  return rows.map(mapRowToProduct);
}

/**
 * Retrieves a product by ID.
 */
export async function getTiffinProductById(
  actor: AuthenticatedUser,
  id: string,
  asyncDb?: AsyncDb
): Promise<TiffinProduct | null> {
  const db = asyncDb ?? getAsyncDb();
  requirePermission(actor, "tiffin.read");

  const row = await db.queryOne<any>(`
    SELECT
      p.*,
      u.full_name as created_by_name
    FROM tiffin_products p
    LEFT JOIN staff_users u ON p.created_by = u.id
    WHERE p.id = ?
  `, [id]);

  if (!row) return null;
  return mapRowToProduct(row);
}

/**
 * Retrieves a product by product code (e.g. 'TIF-DAILY').
 */
export async function getTiffinProductByCode(
  actor: AuthenticatedUser,
  code: string,
  asyncDb?: AsyncDb
): Promise<TiffinProduct | null> {
  const db = asyncDb ?? getAsyncDb();
  requirePermission(actor, "tiffin.read");

  const cleanCode = code?.trim().toUpperCase();
  const row = await db.queryOne<any>(`
    SELECT
      p.*,
      u.full_name as created_by_name
    FROM tiffin_products p
    LEFT JOIN staff_users u ON p.created_by = u.id
    WHERE upper(p.code) = ?
  `, [cleanCode]);

  if (!row) return null;
  return mapRowToProduct(row);
}

/**
 * Creates a catalog item or meal package with whole integer INR pricing.
 */
export async function createTiffinProduct(
  actor: AuthenticatedUser,
  input: CreateTiffinProductInput,
  clientIpOrDb?: string | AsyncDb,
  asyncDb?: AsyncDb
): Promise<TiffinProduct> {
  let clientIp: string | undefined;
  let dbInstance = asyncDb;

  if (typeof clientIpOrDb === "string") {
    clientIp = clientIpOrDb;
  } else if (clientIpOrDb && typeof clientIpOrDb === "object") {
    dbInstance = clientIpOrDb;
  }
  const db = dbInstance ?? getAsyncDb();

  requirePermission(actor, "tiffin.manage", { ip: clientIp, action: "tiffin.product_created" });

  const code = input.code?.trim().toUpperCase();
  if (!code || !/^[A-Z0-9_\-]{3,20}$/.test(code)) {
    throw new Error(
      `Invalid product code '${input.code}'. Must be 3-20 uppercase alphanumeric characters, dashes, or underscores.`
    );
  }

  const existing = await getTiffinProductByCode(actor, code, db);
  if (existing) {
    throw new Error(`Product code '${code}' already exists.`);
  }

  const name = input.name?.trim();
  if (!name || name.length < 2) {
    throw new Error("Product name must be at least 2 characters long.");
  }

  const price = Number(input.price);
  if (!Number.isInteger(price) || price < 0) {
    throw new Error("Product price must be a non-negative integer in whole INR.");
  }

  const validCategories: ProductCategory[] = [
    "STANDARD_MEAL",
    "SUBSCRIPTION_PACKAGE",
    "EXTRA",
    "BEVERAGE",
    "SPECIAL",
  ];
  if (!validCategories.includes(input.category)) {
    throw new Error(`Invalid product category '${input.category}'.`);
  }

  const validUnits: BillingUnit[] = [
    "PER_MEAL",
    "PER_DAY",
    "PER_MONTH",
    "PER_PIECE",
    "PER_PORTION",
  ];
  if (!validUnits.includes(input.billingUnit)) {
    throw new Error(`Invalid billing unit '${input.billingUnit}'.`);
  }

  const id = `prod_${crypto.randomUUID()}`;
  const now = new Date().toISOString();

  await db.transaction(async (tx) => {
    await tx.execute(`
      INSERT INTO tiffin_products (
        id, code, name, description, category,
        billing_unit, price, currency, status, created_by,
        created_at, updated_at
      ) VALUES (
        ?, ?, ?, ?, ?,
        ?, ?, 'INR', 'ACTIVE', ?,
        ?, ?
      )
    `, [
      id,
      code,
      name,
      input.description?.trim() || null,
      input.category,
      input.billingUnit,
      price,
      actor.id,
      now,
      now,
    ]);

    await recordAuditEventAsync({
      actorId: actor.id,
      actorUsername: actor.username,
      action: "tiffin.product_created",
      targetType: "tiffin_product",
      targetId: id,
      metadata: {
        code,
        name,
        price,
        category: input.category,
      },
      ipAddress: clientIp,
    }, tx);
  });

  return (await getTiffinProductById(actor, id, db))!;
}

/**
 * Updates a catalog product's details and price.
 * Modifying the price updates the catalog for future orders without altering historical transactions.
 */
export async function updateTiffinProduct(
  actor: AuthenticatedUser,
  id: string,
  input: UpdateTiffinProductInput,
  clientIpOrDb?: string | AsyncDb,
  asyncDb?: AsyncDb
): Promise<TiffinProduct> {
  let clientIp: string | undefined;
  let dbInstance = asyncDb;

  if (typeof clientIpOrDb === "string") {
    clientIp = clientIpOrDb;
  } else if (clientIpOrDb && typeof clientIpOrDb === "object") {
    dbInstance = clientIpOrDb;
  }
  const db = dbInstance ?? getAsyncDb();

  requirePermission(actor, "tiffin.manage", { ip: clientIp, action: "tiffin.product_updated" });

  const current = await getTiffinProductById(actor, id, db);
  if (!current) {
    throw new Error(`Product '${id}' not found.`);
  }

  const name = input.name !== undefined ? input.name.trim() : current.name;
  if (!name || name.length < 2) {
    throw new Error("Product name must be at least 2 characters long.");
  }

  let price = current.price;
  if (input.price !== undefined) {
    const numPrice = Number(input.price);
    if (!Number.isInteger(numPrice) || numPrice < 0) {
      throw new Error("Product price must be a non-negative integer in whole INR.");
    }
    price = numPrice;
  }

  const description = input.description !== undefined
    ? (input.description?.trim() || null)
    : current.description;
  const category = input.category || current.category;
  const billingUnit = input.billingUnit || current.billingUnit;

  const now = new Date().toISOString();

  await db.transaction(async (tx) => {
    await tx.execute(`
      UPDATE tiffin_products
      SET name = ?,
          description = ?,
          category = ?,
          billing_unit = ?,
          price = ?,
          updated_at = ?
      WHERE id = ?
    `, [name, description, category, billingUnit, price, now, id]);

    await recordAuditEventAsync({
      actorId: actor.id,
      actorUsername: actor.username,
      action: "tiffin.product_updated",
      targetType: "tiffin_product",
      targetId: id,
      metadata: {
        code: current.code,
        previousPrice: current.price,
        newPrice: price,
      },
      ipAddress: clientIp,
    }, tx);
  });

  return (await getTiffinProductById(actor, id, db))!;
}

/**
 * Activates or deactivates a catalog item.
 * Deactivation prevents new orders while preserving historical references.
 */
export async function setTiffinProductStatus(
  actor: AuthenticatedUser,
  id: string,
  status: ProductStatus,
  clientIpOrDb?: string | AsyncDb,
  asyncDb?: AsyncDb
): Promise<TiffinProduct> {
  let clientIp: string | undefined;
  let dbInstance = asyncDb;

  if (typeof clientIpOrDb === "string") {
    clientIp = clientIpOrDb;
  } else if (clientIpOrDb && typeof clientIpOrDb === "object") {
    dbInstance = clientIpOrDb;
  }
  const db = dbInstance ?? getAsyncDb();

  requirePermission(actor, "tiffin.manage", {
    ip: clientIp,
    action: status === "ACTIVE" ? "tiffin.product_activated" : "tiffin.product_deactivated",
  });

  const current = await getTiffinProductById(actor, id, db);
  if (!current) {
    throw new Error(`Product '${id}' not found.`);
  }

  if (current.status === status) {
    return current;
  }

  const now = new Date().toISOString();

  await db.transaction(async (tx) => {
    await tx.execute(`
      UPDATE tiffin_products
      SET status = ?,
          updated_at = ?
      WHERE id = ?
    `, [status, now, id]);

    await recordAuditEventAsync({
      actorId: actor.id,
      actorUsername: actor.username,
      action: status === "ACTIVE" ? "tiffin.product_activated" : "tiffin.product_deactivated",
      targetType: "tiffin_product",
      targetId: id,
      metadata: {
        code: current.code,
        previousStatus: current.status,
        newStatus: status,
      },
      ipAddress: clientIp,
    }, tx);
  });

  return (await getTiffinProductById(actor, id, db))!;
}

// ============================================================================
// 3. AUTHORITATIVE INITIAL PRODUCT CATALOG SEEDER (PRD SECTION 5)
// ============================================================================

export const INITIAL_TIFFIN_CATALOG: ReadonlyArray<Omit<CreateTiffinProductInput, "currency">> = [
  {
    code: "TIF-DAILY",
    name: "Daily Standard Tiffin",
    description: "1 Complete Thali: 4 Tawa Roti, Seasonal Sabzi, Dal Tadka, Steamed Rice, Fresh Salad",
    category: "STANDARD_MEAL",
    billingUnit: "PER_MEAL",
    price: 80,
  },
  {
    code: "TIF-MON-BOTH",
    name: "Monthly Lunch & Dinner Package",
    description: "Full monthly board: 60 Meals / Month (30 Days × 2 meals daily)",
    category: "SUBSCRIPTION_PACKAGE",
    billingUnit: "PER_MONTH",
    price: 3500,
  },
  {
    code: "TIF-MON-SINGLE",
    name: "Monthly Single Meal Package",
    description: "Half board subscription: 30 Meals / Month (Lunch-only or Dinner-only)",
    category: "SUBSCRIPTION_PACKAGE",
    billingUnit: "PER_MONTH",
    price: 2000,
  },
  {
    code: "TIF-FRI-BOWL",
    name: "Friday Curry Rice Bowl",
    description: "Generous special rice bowl (Chef's Curry + Steamed Rice), available Fridays",
    category: "SPECIAL",
    billingUnit: "PER_PORTION",
    price: 60,
  },
  {
    code: "EXT-ROTI",
    name: "Extra Chapati / Tawa Roti",
    description: "Fresh hot whole wheat tawa roti (1 pc)",
    category: "EXTRA",
    billingUnit: "PER_PIECE",
    price: 8,
  },
  {
    code: "EXT-CURD",
    name: "Fresh Curd (Dahi)",
    description: "Chilled plain home-set curd (100g cup)",
    category: "EXTRA",
    billingUnit: "PER_PORTION",
    price: 30,
  },
  {
    code: "EXT-RAITA",
    name: "Boondi / Veg Raita",
    description: "Seasoned yogurt accompaniment with roasted cumin (150ml cup)",
    category: "EXTRA",
    billingUnit: "PER_PORTION",
    price: 35,
  },
  {
    code: "EXT-SWEET",
    name: "Sweet of the Day",
    description: "Chef's daily dessert portion (Gulab Jamun / Halwa)",
    category: "EXTRA",
    billingUnit: "PER_PORTION",
    price: 40,
  },
  {
    code: "EXT-LASSI",
    name: "Sweet Punjabi Lassi",
    description: "Chilled rich sweet yogurt beverage (300ml glass)",
    category: "BEVERAGE",
    billingUnit: "PER_PORTION",
    price: 50,
  },
  {
    code: "EXT-CHAAS",
    name: "Spiced Buttermilk (Chaas)",
    description: "Light digestive spiced buttermilk with fresh mint and cumin (250ml)",
    category: "BEVERAGE",
    billingUnit: "PER_PORTION",
    price: 25,
  },
  {
    code: "EXT-PAPAD",
    name: "Roasted / Fried Papad",
    description: "Crisp seasoned lentil cracker (1 pc)",
    category: "EXTRA",
    billingUnit: "PER_PIECE",
    price: 10,
  },
  {
    code: "EXT-PICKLE",
    name: "Premium Pickle Pack",
    description: "Authentic mango or mixed vegetable pickle sachet",
    category: "EXTRA",
    billingUnit: "PER_PORTION",
    price: 15,
  },
  {
    code: "EXT-PANEER",
    name: "Paneer Sabzi Upgrade",
    description: "Upgrades standard seasonal vegetable to rich cottage cheese preparation",
    category: "EXTRA",
    billingUnit: "PER_PORTION",
    price: 40,
  },
  {
    code: "EXT-RICE",
    name: "Extra Steamed Rice",
    description: "Extra long grain basmati steamed rice portion (150g)",
    category: "EXTRA",
    billingUnit: "PER_PORTION",
    price: 20,
  },
];

/**
 * Idempotently seeds the initial PRD Section 5 baseline pricing catalog if no products exist.
 */
export async function seedDefaultCatalogIfEmpty(
  actor: AuthenticatedUser,
  asyncDb?: AsyncDb
): Promise<number> {
  const db = asyncDb ?? getAsyncDb();
  const countRow = await db.queryOne<{ count: number | string }>(
    "SELECT COUNT(*) as count FROM tiffin_products"
  );

  if (Number(countRow?.count || 0) > 0) {
    return 0;
  }

  let inserted = 0;
  for (const item of INITIAL_TIFFIN_CATALOG) {
    await createTiffinProduct(actor, item, undefined, db);
    inserted++;
  }

  return inserted;
}

// ============================================================================
// 4. TIFFIN SUBSCRIPTIONS & SERVICE SCHEDULING SERVICES (Task 01B.44)
// ============================================================================

function isValidDateString(d: string): boolean {
  if (!d || typeof d !== "string") return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return false;
  const parsed = new Date(d);
  return !isNaN(parsed.getTime());
}

function mapRowToSubscription(row: any): TiffinSubscription {
  return {
    id: row.id,
    customerId: row.customer_id,
    customerName: row.customer_name || null,
    customerPhone: row.customer_phone || null,
    customerType: row.customer_type || null,
    dietaryPreference: row.dietary_preference || null,
    productId: row.product_id,
    productCode: row.product_code || null,
    productName: row.product_name || null,
    productCategory: row.product_category || null,
    status: row.status as SubscriptionStatus,
    startDate: row.start_date,
    endDate: row.end_date || null,
    price: Number(row.price),
    currency: row.currency || "INR",
    mealTypes: row.meal_types as SubscriptionMealTypes,
    serviceDays: row.service_days as SubscriptionServiceDays,
    quantityPerMeal: Number(row.quantity_per_meal || 1),
    pauseStartDate: row.pause_start_date || null,
    pauseResumeDate: row.pause_resume_date || null,
    pauseReason: row.pause_reason || null,
    cancelledAt: row.cancelled_at || null,
    cancellationReason: row.cancellation_reason || null,
    cancelledBy: row.cancelled_by || null,
    cancelledByName: row.cancelled_by_name || null,
    deliveryAddress: row.delivery_address,
    deliveryInstructions: row.delivery_instructions || null,
    notes: row.notes || null,
    createdBy: row.created_by,
    createdByName: row.created_by_name || null,
    updatedBy: row.updated_by || null,
    updatedByName: row.updated_by_name || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface ListTiffinSubscriptionsOptions {
  customerId?: string;
  productId?: string;
  status?: SubscriptionStatus;
  mealTypes?: SubscriptionMealTypes;
  serviceDays?: SubscriptionServiceDays;
  search?: string;
  startDate?: string;
  endDate?: string;
  limit?: number;
  offset?: number;
}

/**
 * Creates a new Tiffin customer subscription with agreed price snapshot and service schedule.
 */
export async function createTiffinSubscription(
  actor: AuthenticatedUser,
  input: CreateTiffinSubscriptionInput,
  clientIpOrDb?: string | AsyncDb,
  asyncDb?: AsyncDb
): Promise<TiffinSubscription> {
  let clientIp: string | undefined;
  let dbInstance = asyncDb;

  if (typeof clientIpOrDb === "string") {
    clientIp = clientIpOrDb;
  } else if (clientIpOrDb && typeof clientIpOrDb === "object") {
    dbInstance = clientIpOrDb;
  }
  const db = dbInstance ?? getAsyncDb();

  requirePermission(actor, "tiffin.manage", { ip: clientIp, action: "tiffin.subscription_created" });

  if (!input.customerId?.trim()) {
    throw new Error("Customer ID is required.");
  }
  const customer = await getTiffinCustomerById(actor, input.customerId.trim(), db);
  if (!customer) {
    throw new Error(`Customer '${input.customerId}' not found.`);
  }
  if (customer.status !== "ACTIVE") {
    throw new Error(`Cannot create subscription for inactive customer '${customer.fullName}'.`);
  }

  if (!input.productId?.trim()) {
    throw new Error("Product ID is required.");
  }
  const product = await getTiffinProductById(actor, input.productId.trim(), db);
  if (!product) {
    throw new Error(`Product '${input.productId}' not found.`);
  }
  if (product.status !== "ACTIVE") {
    throw new Error(`Cannot create subscription for inactive catalog product '${product.name}'.`);
  }

  const startDate = input.startDate?.trim();
  if (!startDate || !isValidDateString(startDate)) {
    throw new Error("Valid service start date (YYYY-MM-DD) is required.");
  }

  let endDate: string | null = null;
  if (input.endDate && input.endDate.trim().length > 0) {
    endDate = input.endDate.trim();
    if (!isValidDateString(endDate)) {
      throw new Error("End date must be a valid date in YYYY-MM-DD format.");
    }
    if (endDate < startDate) {
      throw new Error(`End date (${endDate}) cannot be earlier than start date (${startDate}).`);
    }
  }

  // Price snapshot: use customPrice if provided and valid, otherwise snapshot catalog price
  let agreedPrice = product.price;
  if (input.customPrice !== undefined && input.customPrice !== null) {
    const custom = Math.round(Number(input.customPrice));
    if (isNaN(custom) || custom < 0) {
      throw new Error("Agreed subscription price must be a non-negative whole integer.");
    }
    agreedPrice = custom;
  }

  const mealTypes: SubscriptionMealTypes = input.mealTypes || "BOTH";
  if (!["LUNCH", "DINNER", "BOTH", "BREAKFAST"].includes(mealTypes)) {
    throw new Error(`Invalid mealTypes '${mealTypes}'. Allowed values: LUNCH, DINNER, BOTH, BREAKFAST.`);
  }

  const serviceDays: SubscriptionServiceDays = input.serviceDays || "ALL_DAYS";
  if (!["ALL_DAYS", "MON_SAT", "MON_FRI"].includes(serviceDays)) {
    throw new Error(`Invalid serviceDays '${serviceDays}'. Allowed values: ALL_DAYS, MON_SAT, MON_FRI.`);
  }

  const quantityPerMeal = Math.max(1, Math.round(Number(input.quantityPerMeal || 1)));

  const deliveryAddress = input.deliveryAddress?.trim() || customer.deliveryAddress;
  if (!deliveryAddress || deliveryAddress.length < 5) {
    throw new Error("Delivery address must be at least 5 characters long.");
  }

  const deliveryInstructions = input.deliveryInstructions?.trim() || customer.deliveryInstructions || null;
  const notes = input.notes?.trim() || null;

  const id = `sub_${crypto.randomUUID()}`;
  const now = new Date().toISOString();

  await db.transaction(async (tx) => {
    await tx.execute(`
      INSERT INTO tiffin_subscriptions (
        id, customer_id, product_id, status, start_date,
        end_date, price, currency, meal_types, service_days,
        quantity_per_meal, pause_start_date, pause_resume_date, pause_reason,
        cancelled_at, cancellation_reason, cancelled_by,
        delivery_address, delivery_instructions, notes,
        created_by, updated_by, created_at, updated_at
      ) VALUES (
        ?, ?, ?, 'ACTIVE', ?,
        ?, ?, 'INR', ?, ?,
        ?, NULL, NULL, NULL,
        NULL, NULL, NULL,
        ?, ?, ?,
        ?, NULL, ?, ?
      )
    `, [
      id,
      customer.id,
      product.id,
      startDate,
      endDate,
      agreedPrice,
      mealTypes,
      serviceDays,
      quantityPerMeal,
      deliveryAddress,
      deliveryInstructions,
      notes,
      actor.id,
      now,
      now,
    ]);

    await recordAuditEventAsync({
      actorId: actor.id,
      actorUsername: actor.username,
      action: "tiffin.subscription_created",
      targetType: "tiffin_subscription",
      targetId: id,
      metadata: {
        subscriptionId: id,
        customerId: customer.id,
        customerName: customer.fullName,
        productId: product.id,
        productCode: product.code,
        price: agreedPrice,
        startDate,
        endDate,
        mealTypes,
        serviceDays,
        quantityPerMeal,
      },
      ipAddress: clientIp,
    }, tx);
  });

  return (await getTiffinSubscriptionById(actor, id, db))!;
}

/**
 * Retrieves a single Tiffin subscription by ID.
 */
export async function getTiffinSubscriptionById(
  actor: AuthenticatedUser,
  id: string,
  asyncDb?: AsyncDb
): Promise<TiffinSubscription | null> {
  const db = asyncDb ?? getAsyncDb();
  requirePermission(actor, "tiffin.read");

  const row = await db.queryOne<any>(`
    SELECT
      s.*,
      c.full_name as customer_name,
      c.phone as customer_phone,
      c.customer_type as customer_type,
      c.dietary_preference as dietary_preference,
      p.code as product_code,
      p.name as product_name,
      p.category as product_category,
      u1.full_name as created_by_name,
      u2.full_name as updated_by_name,
      u3.full_name as cancelled_by_name
    FROM tiffin_subscriptions s
    JOIN tiffin_customers c ON s.customer_id = c.id
    JOIN tiffin_products p ON s.product_id = p.id
    LEFT JOIN staff_users u1 ON s.created_by = u1.id
    LEFT JOIN staff_users u2 ON s.updated_by = u2.id
    LEFT JOIN staff_users u3 ON s.cancelled_by = u3.id
    WHERE s.id = ?
  `, [id]);

  if (!row) return null;
  return mapRowToSubscription(row);
}

/**
 * Lists and filters Tiffin subscriptions.
 */
export async function listTiffinSubscriptions(
  actor: AuthenticatedUser,
  options: ListTiffinSubscriptionsOptions = {},
  asyncDb?: AsyncDb
): Promise<{ subscriptions: TiffinSubscription[]; total: number }> {
  const db = asyncDb ?? getAsyncDb();
  requirePermission(actor, "tiffin.read");

  const conditions: string[] = [];
  const params: any[] = [];

  if (options.customerId) {
    conditions.push("s.customer_id = ?");
    params.push(options.customerId);
  }

  if (options.productId) {
    conditions.push("s.product_id = ?");
    params.push(options.productId);
  }

  if (options.status) {
    conditions.push("s.status = ?");
    params.push(options.status);
  }

  if (options.mealTypes) {
    conditions.push("s.meal_types = ?");
    params.push(options.mealTypes);
  }

  if (options.serviceDays) {
    conditions.push("s.service_days = ?");
    params.push(options.serviceDays);
  }

  if (options.startDate) {
    conditions.push("s.start_date >= ?");
    params.push(options.startDate);
  }

  if (options.endDate) {
    conditions.push("s.end_date <= ?");
    params.push(options.endDate);
  }

  if (options.search && options.search.trim().length > 0) {
    const term = `%${options.search.trim().toLowerCase()}%`;
    conditions.push(
      "(lower(c.full_name) LIKE ? OR c.phone LIKE ? OR lower(p.code) LIKE ? OR lower(p.name) LIKE ? OR lower(s.delivery_address) LIKE ?)"
    );
    params.push(term, term, term, term, term);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const countRow = await db.queryOne<{ count: number | string }>(`
    SELECT COUNT(*) as count
    FROM tiffin_subscriptions s
    JOIN tiffin_customers c ON s.customer_id = c.id
    JOIN tiffin_products p ON s.product_id = p.id
    ${whereClause}
  `, params);

  const total = Number(countRow?.count || 0);

  const limit = Math.min(Math.max(1, options.limit ?? 50), 200);
  const offset = Math.max(0, options.offset ?? 0);

  const rows = await db.query<any>(`
    SELECT
      s.*,
      c.full_name as customer_name,
      c.phone as customer_phone,
      c.customer_type as customer_type,
      c.dietary_preference as dietary_preference,
      p.code as product_code,
      p.name as product_name,
      p.category as product_category,
      u1.full_name as created_by_name,
      u2.full_name as updated_by_name,
      u3.full_name as cancelled_by_name
    FROM tiffin_subscriptions s
    JOIN tiffin_customers c ON s.customer_id = c.id
    JOIN tiffin_products p ON s.product_id = p.id
    LEFT JOIN staff_users u1 ON s.created_by = u1.id
    LEFT JOIN staff_users u2 ON s.updated_by = u2.id
    LEFT JOIN staff_users u3 ON s.cancelled_by = u3.id
    ${whereClause}
    ORDER BY s.created_at DESC
    LIMIT ? OFFSET ?
  `, [...params, limit, offset]);

  const subscriptions = rows.map(mapRowToSubscription);
  return { subscriptions, total };
}

/**
 * Updates permitted fields on an existing subscription while preserving agreed price integrity.
 */
export async function updateTiffinSubscription(
  actor: AuthenticatedUser,
  id: string,
  input: UpdateTiffinSubscriptionInput,
  clientIpOrDb?: string | AsyncDb,
  asyncDb?: AsyncDb
): Promise<TiffinSubscription> {
  let clientIp: string | undefined;
  let dbInstance = asyncDb;

  if (typeof clientIpOrDb === "string") {
    clientIp = clientIpOrDb;
  } else if (clientIpOrDb && typeof clientIpOrDb === "object") {
    dbInstance = clientIpOrDb;
  }
  const db = dbInstance ?? getAsyncDb();

  requirePermission(actor, "tiffin.manage", { ip: clientIp, action: "tiffin.subscription_updated" });

  const current = await getTiffinSubscriptionById(actor, id, db);
  if (!current) {
    throw new Error(`Subscription '${id}' not found.`);
  }

  if (current.status === "CANCELLED" || current.status === "COMPLETED") {
    throw new Error(`Cannot update ${current.status.toLowerCase()} subscription '${id}'.`);
  }

  let endDate = current.endDate;
  if (input.endDate !== undefined) {
    if (input.endDate && input.endDate.trim().length > 0) {
      const parsedEnd = input.endDate.trim();
      if (!isValidDateString(parsedEnd)) {
        throw new Error("End date must be a valid date in YYYY-MM-DD format.");
      }
      if (parsedEnd < current.startDate) {
        throw new Error(`End date (${parsedEnd}) cannot be earlier than start date (${current.startDate}).`);
      }
      endDate = parsedEnd;
    } else {
      endDate = null;
    }
  }

  let mealTypes = current.mealTypes;
  if (input.mealTypes) {
    if (!["LUNCH", "DINNER", "BOTH", "BREAKFAST"].includes(input.mealTypes)) {
      throw new Error(`Invalid mealTypes '${input.mealTypes}'.`);
    }
    mealTypes = input.mealTypes;
  }

  let serviceDays = current.serviceDays;
  if (input.serviceDays) {
    if (!["ALL_DAYS", "MON_SAT", "MON_FRI"].includes(input.serviceDays)) {
      throw new Error(`Invalid serviceDays '${input.serviceDays}'.`);
    }
    serviceDays = input.serviceDays;
  }

  let quantityPerMeal = current.quantityPerMeal;
  if (input.quantityPerMeal !== undefined) {
    const qty = Math.round(Number(input.quantityPerMeal));
    if (isNaN(qty) || qty < 1) {
      throw new Error("Quantity per meal must be an integer greater than or equal to 1.");
    }
    quantityPerMeal = qty;
  }

  let price = current.price;
  let priceChanged = false;
  if (input.customPrice !== undefined && input.customPrice !== null) {
    const custom = Math.round(Number(input.customPrice));
    if (isNaN(custom) || custom < 0) {
      throw new Error("Agreed subscription price must be a non-negative whole integer.");
    }
    if (custom !== current.price) {
      price = custom;
      priceChanged = true;
    }
  }

  const deliveryAddress = input.deliveryAddress !== undefined ? input.deliveryAddress.trim() : current.deliveryAddress;
  if (!deliveryAddress || deliveryAddress.length < 5) {
    throw new Error("Delivery address must be at least 5 characters long.");
  }

  const deliveryInstructions =
    input.deliveryInstructions !== undefined
      ? input.deliveryInstructions?.trim() || null
      : current.deliveryInstructions;

  const notes = input.notes !== undefined ? input.notes?.trim() || null : current.notes;
  const now = new Date().toISOString();

  await db.transaction(async (tx) => {
    await tx.execute(`
      UPDATE tiffin_subscriptions
      SET end_date = ?,
          meal_types = ?,
          service_days = ?,
          quantity_per_meal = ?,
          price = ?,
          delivery_address = ?,
          delivery_instructions = ?,
          notes = ?,
          updated_by = ?,
          updated_at = ?
      WHERE id = ?
    `, [
      endDate,
      mealTypes,
      serviceDays,
      quantityPerMeal,
      price,
      deliveryAddress,
      deliveryInstructions,
      notes,
      actor.id,
      now,
      id,
    ]);

    await recordAuditEventAsync({
      actorId: actor.id,
      actorUsername: actor.username,
      action: priceChanged ? "tiffin.subscription_price_updated" : "tiffin.subscription_updated",
      targetType: "tiffin_subscription",
      targetId: id,
      metadata: {
        subscriptionId: id,
        previousPrice: current.price,
        newPrice: price,
        previousEndDate: current.endDate,
        newEndDate: endDate,
        mealTypes,
        serviceDays,
        quantityPerMeal,
      },
      ipAddress: clientIp,
    }, tx);
  });

  return (await getTiffinSubscriptionById(actor, id, db))!;
}

/**
 * Temporarily pauses an active Tiffin subscription.
 */
export async function pauseTiffinSubscription(
  actor: AuthenticatedUser,
  id: string,
  input: PauseTiffinSubscriptionInput,
  clientIpOrDb?: string | AsyncDb,
  asyncDb?: AsyncDb
): Promise<TiffinSubscription> {
  let clientIp: string | undefined;
  let dbInstance = asyncDb;

  if (typeof clientIpOrDb === "string") {
    clientIp = clientIpOrDb;
  } else if (clientIpOrDb && typeof clientIpOrDb === "object") {
    dbInstance = clientIpOrDb;
  }
  const db = dbInstance ?? getAsyncDb();

  requirePermission(actor, "tiffin.manage", { ip: clientIp, action: "tiffin.subscription_paused" });

  const current = await getTiffinSubscriptionById(actor, id, db);
  if (!current) {
    throw new Error(`Subscription '${id}' not found.`);
  }

  if (current.status !== "ACTIVE") {
    throw new Error(`Cannot pause subscription '${id}' because its status is ${current.status}. Only ACTIVE subscriptions can be paused.`);
  }

  const pauseStart = input.pauseStartDate?.trim();
  if (!pauseStart || !isValidDateString(pauseStart)) {
    throw new Error("Valid pause start date (YYYY-MM-DD) is required.");
  }

  let pauseResume: string | null = null;
  if (input.pauseResumeDate && input.pauseResumeDate.trim().length > 0) {
    pauseResume = input.pauseResumeDate.trim();
    if (!isValidDateString(pauseResume)) {
      throw new Error("Pause resume date must be a valid date in YYYY-MM-DD format.");
    }
    if (pauseResume < pauseStart) {
      throw new Error(`Pause resume date (${pauseResume}) cannot be earlier than pause start date (${pauseStart}).`);
    }
  }

  const reason = input.pauseReason?.trim() || null;
  const now = new Date().toISOString();

  await db.transaction(async (tx) => {
    await tx.execute(`
      UPDATE tiffin_subscriptions
      SET status = 'PAUSED',
          pause_start_date = ?,
          pause_resume_date = ?,
          pause_reason = ?,
          updated_by = ?,
          updated_at = ?
      WHERE id = ?
    `, [pauseStart, pauseResume, reason, actor.id, now, id]);

    await recordAuditEventAsync({
      actorId: actor.id,
      actorUsername: actor.username,
      action: "tiffin.subscription_paused",
      targetType: "tiffin_subscription",
      targetId: id,
      metadata: {
        subscriptionId: id,
        previousStatus: "ACTIVE",
        newStatus: "PAUSED",
        pauseStartDate: pauseStart,
        pauseResumeDate: pauseResume,
        reason,
      },
      ipAddress: clientIp,
    }, tx);

    // Deliveries already on a list inside the pause are cancelled while their meal is before its
    // cutoff; later ones stay for the Manager to decide on the Delivery page.
    const { cancelSubscriptionDeliveriesForChange } = await import("../delivery/deliveryOps");
    await cancelSubscriptionDeliveriesForChange(tx, actor, id, pauseStart, pauseResume || null, `Subscription paused${reason ? `: ${reason}` : ""}`, clientIp);
  });

  return (await getTiffinSubscriptionById(actor, id, db))!;
}

/**
 * Resumes a paused Tiffin subscription back to ACTIVE service.
 */
export async function resumeTiffinSubscription(
  actor: AuthenticatedUser,
  id: string,
  clientIpOrDb?: string | AsyncDb,
  asyncDb?: AsyncDb
): Promise<TiffinSubscription> {
  let clientIp: string | undefined;
  let dbInstance = asyncDb;

  if (typeof clientIpOrDb === "string") {
    clientIp = clientIpOrDb;
  } else if (clientIpOrDb && typeof clientIpOrDb === "object") {
    dbInstance = clientIpOrDb;
  }
  const db = dbInstance ?? getAsyncDb();

  requirePermission(actor, "tiffin.manage", { ip: clientIp, action: "tiffin.subscription_resumed" });

  const current = await getTiffinSubscriptionById(actor, id, db);
  if (!current) {
    throw new Error(`Subscription '${id}' not found.`);
  }

  if (current.status !== "PAUSED") {
    throw new Error(`Cannot resume subscription '${id}' because its status is ${current.status}. Only PAUSED subscriptions can be resumed.`);
  }

  const now = new Date().toISOString();

  await db.transaction(async (tx) => {
    await tx.execute(`
      UPDATE tiffin_subscriptions
      SET status = 'ACTIVE',
          pause_start_date = NULL,
          pause_resume_date = NULL,
          updated_by = ?,
          updated_at = ?
      WHERE id = ?
    `, [actor.id, now, id]);

    await recordAuditEventAsync({
      actorId: actor.id,
      actorUsername: actor.username,
      action: "tiffin.subscription_resumed",
      targetType: "tiffin_subscription",
      targetId: id,
      metadata: {
        subscriptionId: id,
        previousStatus: "PAUSED",
        newStatus: "ACTIVE",
      },
      ipAddress: clientIp,
    }, tx);
  });

  return (await getTiffinSubscriptionById(actor, id, db))!;
}

/**
 * Cancels a subscription. Historical records are strictly preserved.
 */
export async function cancelTiffinSubscription(
  actor: AuthenticatedUser,
  id: string,
  input: CancelTiffinSubscriptionInput = {},
  clientIpOrDb?: string | AsyncDb,
  asyncDb?: AsyncDb
): Promise<TiffinSubscription> {
  let clientIp: string | undefined;
  let dbInstance = asyncDb;

  if (typeof clientIpOrDb === "string") {
    clientIp = clientIpOrDb;
  } else if (clientIpOrDb && typeof clientIpOrDb === "object") {
    dbInstance = clientIpOrDb;
  }
  const db = dbInstance ?? getAsyncDb();

  requirePermission(actor, "tiffin.manage", { ip: clientIp, action: "tiffin.subscription_cancelled" });

  const current = await getTiffinSubscriptionById(actor, id, db);
  if (!current) {
    throw new Error(`Subscription '${id}' not found.`);
  }

  if (current.status === "CANCELLED") {
    throw new Error(`Subscription '${id}' is already cancelled.`);
  }

  if (current.status === "COMPLETED") {
    throw new Error(`Cannot cancel a subscription that has already been COMPLETED.`);
  }

  const reason = input.cancellationReason?.trim() || null;
  const now = new Date().toISOString();

  await db.transaction(async (tx) => {
    await tx.execute(`
      UPDATE tiffin_subscriptions
      SET status = 'CANCELLED',
          cancelled_at = ?,
          cancellation_reason = ?,
          cancelled_by = ?,
          updated_by = ?,
          updated_at = ?
      WHERE id = ?
    `, [now, reason, actor.id, actor.id, now, id]);

    await recordAuditEventAsync({
      actorId: actor.id,
      actorUsername: actor.username,
      action: "tiffin.subscription_cancelled",
      targetType: "tiffin_subscription",
      targetId: id,
      metadata: {
        subscriptionId: id,
        previousStatus: current.status,
        newStatus: "CANCELLED",
        cancellationReason: reason,
      },
      ipAddress: clientIp,
    }, tx);

    const { cancelSubscriptionDeliveriesForChange } = await import("../delivery/deliveryOps");
    const { getBusinessDateString } = await import("../finance/financeService");
    await cancelSubscriptionDeliveriesForChange(tx, actor, id, getBusinessDateString(), null, `Subscription cancelled${reason ? `: ${reason}` : ""}`, clientIp);
  });

  return (await getTiffinSubscriptionById(actor, id, db))!;
}

/**
 * Returns all subscriptions for a specific customer.
 */
export async function getCustomerSubscriptions(
  actor: AuthenticatedUser,
  customerId: string,
  asyncDb?: AsyncDb
): Promise<TiffinSubscription[]> {
  const result = await listTiffinSubscriptions(actor, { customerId, limit: 100 }, asyncDb);
  return result.subscriptions;
}

