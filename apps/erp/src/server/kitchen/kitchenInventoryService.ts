import crypto from "crypto";
import { getAsyncDb, AsyncDb } from "../database/db";
import { requirePermission } from "../authorization/authorize";
import { recordAuditEventAsync } from "../audit/audit";
import {
  AuthenticatedUser,
  MealType,
  RawMaterialCategory,
  RawMaterialBaseUnit,
  KitchenRawMaterial,
  KitchenRecipe,
  KitchenRecipeIngredient,
  KitchenStockMovement,
  KitchenProductionConsumption,
  ProductionConsumptionPreview,
  ConsumptionPreviewIngredient,
  StockMovementType,
  StockSourceType,
} from "@/types";

// -----------------------------------------------------------------------------
// Errors & Invariants
// -----------------------------------------------------------------------------

export class InventoryValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InventoryValidationError";
  }
}

export class InsufficientStockError extends Error {
  public shortages: Array<{
    materialId: string;
    materialCode: string;
    materialName: string;
    required: number;
    available: number;
    shortage: number;
  }>;

  constructor(
    message: string,
    shortages: Array<{
      materialId: string;
      materialCode: string;
      materialName: string;
      required: number;
      available: number;
      shortage: number;
    }>
  ) {
    super(message);
    this.name = "InsufficientStockError";
    this.shortages = shortages;
  }
}

// -----------------------------------------------------------------------------
// Canonical Unit Conversions (Zero Floating-Point Drift)
// -----------------------------------------------------------------------------

export const VALID_CATEGORIES: readonly RawMaterialCategory[] = [
  "GRAINS",
  "PULSES",
  "VEGETABLES",
  "DAIRY",
  "SPICES",
  "OILS",
  "PACKAGING",
  "OTHER",
];

export const VALID_BASE_UNITS: readonly RawMaterialBaseUnit[] = ["G", "ML", "PCS"];

/**
 * Deterministically converts an input quantity to the canonical base unit.
 * Mass: G (1), KG (1000)
 * Volume: ML (1), L (1000)
 * Count: PCS (1)
 * Throws explicit error on incompatible unit conversions.
 */
export function convertToBaseUnit(
  quantity: number,
  inputUnit: string,
  baseUnit: RawMaterialBaseUnit
): number {
  if (typeof quantity !== "number" || isNaN(quantity) || quantity <= 0) {
    throw new InventoryValidationError("Quantity must be a positive number.");
  }
  const normInput = inputUnit.trim().toUpperCase();
  const normBase = baseUnit.trim().toUpperCase();

  if (normBase === "G") {
    if (normInput === "G") return Math.round(quantity);
    if (normInput === "KG") return Math.round(quantity * 1000);
    throw new InventoryValidationError(
      `Incompatible unit conversion: Cannot convert ${inputUnit} to mass base unit G.`
    );
  }

  if (normBase === "ML") {
    if (normInput === "ML") return Math.round(quantity);
    if (normInput === "L") return Math.round(quantity * 1000);
    throw new InventoryValidationError(
      `Incompatible unit conversion: Cannot convert ${inputUnit} to volume base unit ML.`
    );
  }

  if (normBase === "PCS") {
    if (normInput === "PCS") return Math.round(quantity);
    throw new InventoryValidationError(
      `Incompatible unit conversion: Cannot convert ${inputUnit} to count base unit PCS.`
    );
  }

  throw new InventoryValidationError(`Unsupported base unit: ${baseUnit}`);
}

export function formatQuantityWithUnit(quantityBase: number, baseUnit: RawMaterialBaseUnit): string {
  if (baseUnit === "G") {
    if (Math.abs(quantityBase) >= 1000) {
      const kg = (quantityBase / 1000).toFixed(quantityBase % 1000 === 0 ? 0 : 2);
      return `${kg} kg (${quantityBase} g)`;
    }
    return `${quantityBase} g`;
  }
  if (baseUnit === "ML") {
    if (Math.abs(quantityBase) >= 1000) {
      const l = (quantityBase / 1000).toFixed(quantityBase % 1000 === 0 ? 0 : 2);
      return `${l} L (${quantityBase} ml)`;
    }
    return `${quantityBase} ml`;
  }
  return `${quantityBase} pcs`;
}

// -----------------------------------------------------------------------------
// Raw Material Catalog Management
// -----------------------------------------------------------------------------

export interface CreateRawMaterialInput {
  code: string;
  name: string;
  description?: string | null;
  category: RawMaterialCategory;
  baseUnit: RawMaterialBaseUnit;
  initialStock?: number;
  reorderThreshold?: number;
}

export interface UpdateRawMaterialInput {
  name?: string;
  description?: string | null;
  category?: RawMaterialCategory;
  reorderThreshold?: number;
  isActive?: boolean;
}

export interface RawMaterialFilter {
  search?: string;
  category?: RawMaterialCategory;
  isActive?: boolean;
  lowStockOnly?: boolean;
}

function mapRowToMaterial(row: any): KitchenRawMaterial {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    description: row.description || null,
    category: row.category as RawMaterialCategory,
    baseUnit: row.base_unit as RawMaterialBaseUnit,
    currentStock: Number(row.current_stock || 0),
    reorderThreshold: Number(row.reorder_threshold || 0),
    isActive: Number(row.is_active || 0),
    createdBy: row.created_by,
    updatedBy: row.updated_by || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function createRawMaterial(
  actor: AuthenticatedUser,
  input: CreateRawMaterialInput,
  clientIp?: string,
  providedDb?: AsyncDb
): Promise<KitchenRawMaterial> {
  requirePermission(actor, "kitchen.manage");
  const db = providedDb || (await getAsyncDb());

  if (!input.code || !input.code.trim()) {
    throw new InventoryValidationError("Material code is required.");
  }
  if (!input.name || !input.name.trim()) {
    throw new InventoryValidationError("Material name is required.");
  }
  if (!VALID_CATEGORIES.includes(input.category)) {
    throw new InventoryValidationError(`Invalid category: ${input.category}`);
  }
  if (!VALID_BASE_UNITS.includes(input.baseUnit)) {
    throw new InventoryValidationError(`Invalid base unit: ${input.baseUnit}`);
  }

  const code = input.code.trim().toUpperCase();
  const name = input.name.trim();
  const description = input.description ? input.description.trim() : null;
  const reorderThreshold = Math.max(0, Number(input.reorderThreshold || 0));
  const initialStock = Math.max(0, Number(input.initialStock || 0));

  // Check unique code
  const existing = await db.queryOne<{ id: string }>(
    "SELECT id FROM kitchen_raw_materials WHERE code = ?",
    [code]
  );
  if (existing) {
    throw new InventoryValidationError(`Raw material with code '${code}' already exists.`);
  }

  const id = `krm_${crypto.randomUUID()}`;
  const now = new Date().toISOString();

  await db.transaction(async (tx) => {
    await tx.execute(
      `
      INSERT INTO kitchen_raw_materials (
        id, code, name, description, category, base_unit,
        current_stock, reorder_threshold, is_active, created_by,
        updated_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, NULL, ?, ?)
    `,
      [
        id,
        code,
        name,
        description,
        input.category,
        input.baseUnit,
        initialStock,
        reorderThreshold,
        actor.id,
        now,
        now,
      ]
    );

    if (initialStock > 0) {
      const movementId = `ksm_${crypto.randomUUID()}`;
      await tx.execute(
        `
        INSERT INTO kitchen_stock_movements (
          id, material_id, movement_type, quantity_base, unit,
          source_type, source_id, reason, actor_id, actor_name, created_at
        ) VALUES (?, ?, 'OPENING_BALANCE', ?, ?, 'MANUAL', NULL, 'Initial opening stock', ?, ?, ?)
      `,
        [
          movementId,
          id,
          initialStock,
          input.baseUnit,
          actor.id,
          actor.fullName || actor.username,
          now,
        ]
      );
    }
  });

  await recordAuditEventAsync({
    actorId: actor.id,
    actorUsername: actor.username,
    action: "kitchen.material_created",
    targetType: "kitchen_raw_material",
    targetId: id,
    metadata: { code, name, category: input.category, baseUnit: input.baseUnit, initialStock },
    ipAddress: clientIp,
  });

  const created = await getRawMaterialById(actor, id, db);
  return created!;
}

export async function updateRawMaterial(
  actor: AuthenticatedUser,
  id: string,
  input: UpdateRawMaterialInput,
  clientIp?: string,
  providedDb?: AsyncDb
): Promise<KitchenRawMaterial> {
  requirePermission(actor, "kitchen.manage");
  const db = providedDb || (await getAsyncDb());

  const existing = await db.queryOne<any>("SELECT * FROM kitchen_raw_materials WHERE id = ?", [id]);
  if (!existing) {
    throw new InventoryValidationError(`Raw material '${id}' not found.`);
  }

  const updates: string[] = [];
  const params: any[] = [];

  if (input.name !== undefined) {
    if (!input.name.trim()) throw new InventoryValidationError("Material name cannot be empty.");
    updates.push("name = ?");
    params.push(input.name.trim());
  }

  if (input.description !== undefined) {
    updates.push("description = ?");
    params.push(input.description ? input.description.trim() : null);
  }

  if (input.category !== undefined) {
    if (!VALID_CATEGORIES.includes(input.category)) {
      throw new InventoryValidationError(`Invalid category: ${input.category}`);
    }
    updates.push("category = ?");
    params.push(input.category);
  }

  if (input.reorderThreshold !== undefined) {
    const thresh = Number(input.reorderThreshold);
    if (isNaN(thresh) || thresh < 0) {
      throw new InventoryValidationError("Reorder threshold must be a non-negative number.");
    }
    updates.push("reorder_threshold = ?");
    params.push(Math.round(thresh));
  }

  if (input.isActive !== undefined) {
    updates.push("is_active = ?");
    params.push(input.isActive ? 1 : 0);
  }

  if (updates.length === 0) {
    return mapRowToMaterial(existing);
  }

  const now = new Date().toISOString();
  updates.push("updated_by = ?");
  params.push(actor.id);
  updates.push("updated_at = ?");
  params.push(now);

  params.push(id);
  await db.execute(
    `UPDATE kitchen_raw_materials SET ${updates.join(", ")} WHERE id = ?`,
    params
  );

  await recordAuditEventAsync({
    actorId: actor.id,
    actorUsername: actor.username,
    action: "kitchen.material_updated",
    targetType: "kitchen_raw_material",
    targetId: id,
    metadata: { changes: input },
    ipAddress: clientIp,
  });

  const updated = await getRawMaterialById(actor, id, db);
  return updated!;
}

export async function getRawMaterialById(
  actor: AuthenticatedUser,
  id: string,
  providedDb?: AsyncDb
): Promise<KitchenRawMaterial | null> {
  requirePermission(actor, "kitchen.read");
  const db = providedDb || (await getAsyncDb());
  const row = await db.queryOne<any>("SELECT * FROM kitchen_raw_materials WHERE id = ?", [id]);
  return row ? mapRowToMaterial(row) : null;
}

export async function listRawMaterials(
  actor: AuthenticatedUser,
  filter?: RawMaterialFilter,
  providedDb?: AsyncDb
): Promise<KitchenRawMaterial[]> {
  requirePermission(actor, "kitchen.read");
  const db = providedDb || (await getAsyncDb());

  const conditions: string[] = [];
  const params: any[] = [];

  if (filter?.search && filter.search.trim()) {
    conditions.push("(code LIKE ? OR name LIKE ?)");
    const term = `%${filter.search.trim()}%`;
    params.push(term, term);
  }

  if (filter?.category) {
    conditions.push("category = ?");
    params.push(filter.category);
  }

  if (filter?.isActive !== undefined) {
    conditions.push("is_active = ?");
    params.push(filter.isActive ? 1 : 0);
  }

  if (filter?.lowStockOnly) {
    conditions.push("current_stock <= reorder_threshold");
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const rows = await db.query<any>(
    `SELECT * FROM kitchen_raw_materials ${whereClause} ORDER BY name ASC`,
    params
  );

  return rows.map(mapRowToMaterial);
}

export async function getLowStockAlerts(
  actor: AuthenticatedUser,
  providedDb?: AsyncDb
): Promise<Array<KitchenRawMaterial & { shortage: number }>> {
  requirePermission(actor, "kitchen.read");
  const materials = await listRawMaterials(actor, { isActive: true, lowStockOnly: true }, providedDb);
  return materials.map((m) => ({
    ...m,
    shortage: Math.max(0, m.reorderThreshold - m.currentStock),
  }));
}

// -----------------------------------------------------------------------------
// Stock Movement Management (Receipts, Adjustments, Spoilage/Waste)
// -----------------------------------------------------------------------------

export interface RecordStockReceiptInput {
  materialId: string;
  quantity: number;
  unit: string;
  reason?: string;
  referenceNumber?: string;
}

export interface RecordStockAdjustmentInput {
  materialId: string;
  adjustmentType: "ADD" | "SUB";
  quantity: number;
  unit: string;
  reason: string;
}

export interface RecordMaterialWasteInput {
  materialId: string;
  quantity: number;
  unit: string;
  reason: string;
}

export interface StockMovementFilter {
  materialId?: string;
  movementType?: StockMovementType;
  sourceType?: StockSourceType;
  sourceId?: string;
  limit?: number;
}

function mapRowToMovement(row: any): KitchenStockMovement {
  return {
    id: row.id,
    materialId: row.material_id,
    materialCode: row.material_code,
    materialName: row.material_name,
    movementType: row.movement_type as StockMovementType,
    quantityBase: Number(row.quantity_base),
    unit: row.unit,
    sourceType: row.source_type as StockSourceType,
    sourceId: row.source_id || null,
    reason: row.reason,
    actorId: row.actor_id,
    actorName: row.actor_name || null,
    createdAt: row.created_at,
  };
}

export async function recordStockReceipt(
  actor: AuthenticatedUser,
  input: RecordStockReceiptInput,
  clientIp?: string,
  providedDb?: AsyncDb
): Promise<KitchenStockMovement> {
  requirePermission(actor, "kitchen.manage");
  const db = providedDb || (await getAsyncDb());

  const material = await db.queryOne<any>(
    "SELECT * FROM kitchen_raw_materials WHERE id = ?",
    [input.materialId]
  );
  if (!material) {
    throw new InventoryValidationError(`Raw material '${input.materialId}' not found.`);
  }

  const quantityBase = convertToBaseUnit(
    input.quantity,
    input.unit,
    material.base_unit as RawMaterialBaseUnit
  );

  const movementId = `ksm_${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  const reason = input.reason?.trim() || "Stock replenishment receipt";
  const actorName = actor.fullName || actor.username;

  await db.transaction(async (tx) => {
    await tx.execute(
      `
      INSERT INTO kitchen_stock_movements (
        id, material_id, movement_type, quantity_base, unit,
        source_type, source_id, reason, actor_id, actor_name, created_at
      ) VALUES (?, ?, 'RECEIPT', ?, ?, 'MANUAL', ?, ?, ?, ?, ?)
    `,
      [
        movementId,
        material.id,
        quantityBase,
        input.unit.trim().toUpperCase(),
        input.referenceNumber?.trim() || null,
        reason,
        actor.id,
        actorName,
        now,
      ]
    );

    await tx.execute(
      `UPDATE kitchen_raw_materials SET current_stock = current_stock + ?, updated_at = ? WHERE id = ?`,
      [quantityBase, now, material.id]
    );
  });

  await recordAuditEventAsync({
    actorId: actor.id,
    actorUsername: actor.username,
    action: "kitchen.stock_receipt_recorded",
    targetType: "kitchen_stock_movement",
    targetId: movementId,
    metadata: {
      materialId: material.id,
      code: material.code,
      quantityBase,
      unit: input.unit,
      inputQuantity: input.quantity,
      referenceNumber: input.referenceNumber,
    },
    ipAddress: clientIp,
  });

  const row = await db.queryOne<any>(
    `
    SELECT m.*, r.code as material_code, r.name as material_name
    FROM kitchen_stock_movements m
    JOIN kitchen_raw_materials r ON m.material_id = r.id
    WHERE m.id = ?
  `,
    [movementId]
  );

  return mapRowToMovement(row);
}

export async function recordStockAdjustment(
  actor: AuthenticatedUser,
  input: RecordStockAdjustmentInput,
  clientIp?: string,
  providedDb?: AsyncDb
): Promise<KitchenStockMovement> {
  requirePermission(actor, "kitchen.manage");
  const db = providedDb || (await getAsyncDb());

  if (!input.reason || !input.reason.trim()) {
    throw new InventoryValidationError("A clear reason is mandatory for inventory stock adjustments.");
  }

  const material = await db.queryOne<any>(
    "SELECT * FROM kitchen_raw_materials WHERE id = ?",
    [input.materialId]
  );
  if (!material) {
    throw new InventoryValidationError(`Raw material '${input.materialId}' not found.`);
  }

  const rawQtyBase = convertToBaseUnit(
    input.quantity,
    input.unit,
    material.base_unit as RawMaterialBaseUnit
  );

  const isAdd = input.adjustmentType === "ADD";
  const signedQtyBase = isAdd ? rawQtyBase : -rawQtyBase;
  const movementType: StockMovementType = isAdd ? "ADJUSTMENT_ADD" : "ADJUSTMENT_SUB";

  // Prevent stock adjustment from driving stock negative
  if (!isAdd && Number(material.current_stock) < rawQtyBase) {
    throw new InventoryValidationError(
      `Cannot subtract ${rawQtyBase} ${material.base_unit}. Current available stock is only ${material.current_stock} ${material.base_unit}.`
    );
  }

  const movementId = `ksm_${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  const actorName = actor.fullName || actor.username;

  await db.transaction(async (tx) => {
    await tx.execute(
      `
      INSERT INTO kitchen_stock_movements (
        id, material_id, movement_type, quantity_base, unit,
        source_type, source_id, reason, actor_id, actor_name, created_at
      ) VALUES (?, ?, ?, ?, ?, 'MANUAL', NULL, ?, ?, ?, ?)
    `,
      [
        movementId,
        material.id,
        movementType,
        signedQtyBase,
        input.unit.trim().toUpperCase(),
        input.reason.trim(),
        actor.id,
        actorName,
        now,
      ]
    );

    await tx.execute(
      `UPDATE kitchen_raw_materials SET current_stock = current_stock + ?, updated_at = ? WHERE id = ?`,
      [signedQtyBase, now, material.id]
    );
  });

  await recordAuditEventAsync({
    actorId: actor.id,
    actorUsername: actor.username,
    action: "kitchen.stock_adjustment_recorded",
    targetType: "kitchen_stock_movement",
    targetId: movementId,
    metadata: {
      materialId: material.id,
      code: material.code,
      signedQtyBase,
      unit: input.unit,
      reason: input.reason,
    },
    ipAddress: clientIp,
  });

  const row = await db.queryOne<any>(
    `
    SELECT m.*, r.code as material_code, r.name as material_name
    FROM kitchen_stock_movements m
    JOIN kitchen_raw_materials r ON m.material_id = r.id
    WHERE m.id = ?
  `,
    [movementId]
  );

  return mapRowToMovement(row);
}

export async function recordMaterialWaste(
  actor: AuthenticatedUser,
  input: RecordMaterialWasteInput,
  clientIp?: string,
  providedDb?: AsyncDb
): Promise<KitchenStockMovement> {
  requirePermission(actor, "kitchen.manage");
  const db = providedDb || (await getAsyncDb());

  if (!input.reason || !input.reason.trim()) {
    throw new InventoryValidationError("A reason is required to record raw material waste or spoilage.");
  }

  const material = await db.queryOne<any>(
    "SELECT * FROM kitchen_raw_materials WHERE id = ?",
    [input.materialId]
  );
  if (!material) {
    throw new InventoryValidationError(`Raw material '${input.materialId}' not found.`);
  }

  const quantityBase = convertToBaseUnit(
    input.quantity,
    input.unit,
    material.base_unit as RawMaterialBaseUnit
  );

  if (Number(material.current_stock) < quantityBase) {
    throw new InventoryValidationError(
      `Cannot record waste of ${quantityBase} ${material.base_unit}. Current stock is only ${material.current_stock} ${material.base_unit}.`
    );
  }

  const movementId = `ksm_${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  const actorName = actor.fullName || actor.username;

  await db.transaction(async (tx) => {
    await tx.execute(
      `
      INSERT INTO kitchen_stock_movements (
        id, material_id, movement_type, quantity_base, unit,
        source_type, source_id, reason, actor_id, actor_name, created_at
      ) VALUES (?, ?, 'WASTE', ?, ?, 'WASTE_REPORT', NULL, ?, ?, ?, ?)
    `,
      [
        movementId,
        material.id,
        -quantityBase,
        input.unit.trim().toUpperCase(),
        input.reason.trim(),
        actor.id,
        actorName,
        now,
      ]
    );

    await tx.execute(
      `UPDATE kitchen_raw_materials SET current_stock = current_stock - ?, updated_at = ? WHERE id = ?`,
      [quantityBase, now, material.id]
    );
  });

  await recordAuditEventAsync({
    actorId: actor.id,
    actorUsername: actor.username,
    action: "kitchen.material_waste_recorded",
    targetType: "kitchen_stock_movement",
    targetId: movementId,
    metadata: {
      materialId: material.id,
      code: material.code,
      quantityBase,
      unit: input.unit,
      reason: input.reason,
    },
    ipAddress: clientIp,
  });

  const row = await db.queryOne<any>(
    `
    SELECT m.*, r.code as material_code, r.name as material_name
    FROM kitchen_stock_movements m
    JOIN kitchen_raw_materials r ON m.material_id = r.id
    WHERE m.id = ?
  `,
    [movementId]
  );

  return mapRowToMovement(row);
}

export async function listStockMovements(
  actor: AuthenticatedUser,
  filter?: StockMovementFilter,
  providedDb?: AsyncDb
): Promise<KitchenStockMovement[]> {
  requirePermission(actor, "kitchen.read");
  const db = providedDb || (await getAsyncDb());

  const conditions: string[] = [];
  const params: any[] = [];

  if (filter?.materialId) {
    conditions.push("m.material_id = ?");
    params.push(filter.materialId);
  }

  if (filter?.movementType) {
    conditions.push("m.movement_type = ?");
    params.push(filter.movementType);
  }

  if (filter?.sourceType) {
    conditions.push("m.source_type = ?");
    params.push(filter.sourceType);
  }

  if (filter?.sourceId) {
    conditions.push("m.source_id = ?");
    params.push(filter.sourceId);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const limit = Math.min(100, Math.max(1, Number(filter?.limit || 50)));

  const rows = await db.query<any>(
    `
    SELECT m.*, r.code as material_code, r.name as material_name
    FROM kitchen_stock_movements m
    JOIN kitchen_raw_materials r ON m.material_id = r.id
    ${whereClause}
    ORDER BY m.created_at DESC
    LIMIT ${limit}
  `,
    params
  );

  return rows.map(mapRowToMovement);
}

// -----------------------------------------------------------------------------
// Recipe Management & Versioning
// -----------------------------------------------------------------------------

export interface RecipeIngredientInput {
  materialId: string;
  quantity: number;
  unit: string;
  lossPercent?: number;
  notes?: string | null;
}

export interface CreateRecipeInput {
  name: string;
  description?: string | null;
  mealType?: MealType | null;
  productId?: string | null;
  yieldServings?: number;
  ingredients: RecipeIngredientInput[];
}

export interface UpdateRecipeInput {
  name?: string;
  description?: string | null;
  mealType?: MealType | null;
  productId?: string | null;
  yieldServings?: number;
  isActive?: boolean;
  ingredients?: RecipeIngredientInput[];
}

function mapRowToRecipe(row: any, ingredients?: KitchenRecipeIngredient[]): KitchenRecipe {
  return {
    id: row.id,
    name: row.name,
    description: row.description || null,
    mealType: (row.meal_type as MealType) || null,
    productId: row.product_id || null,
    yieldServings: Number(row.yield_servings || 1),
    version: Number(row.version || 1),
    isActive: Number(row.is_active || 0),
    createdBy: row.created_by,
    updatedBy: row.updated_by || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ingredients,
  };
}

export async function createRecipe(
  actor: AuthenticatedUser,
  input: CreateRecipeInput,
  clientIp?: string,
  providedDb?: AsyncDb
): Promise<KitchenRecipe> {
  requirePermission(actor, "kitchen.manage");
  const db = providedDb || (await getAsyncDb());

  if (!input.name || !input.name.trim()) {
    throw new InventoryValidationError("Recipe name is required.");
  }
  const yieldServings = Math.max(1, Number(input.yieldServings || 1));

  if (!input.ingredients || input.ingredients.length === 0) {
    throw new InventoryValidationError("A recipe must include at least one ingredient.");
  }

  // Validate mealType if provided
  if (input.mealType && !["BREAKFAST", "LUNCH", "DINNER"].includes(input.mealType)) {
    throw new InventoryValidationError(`Invalid meal type: ${input.mealType}`);
  }

  // Validate product if provided
  if (input.productId) {
    const prod = await db.queryOne<{ id: string }>(
      "SELECT id FROM tiffin_products WHERE id = ?",
      [input.productId]
    );
    if (!prod) {
      throw new InventoryValidationError(`Product '${input.productId}' not found.`);
    }
  }

  // Validate ingredients: check materials exist and are active, reject duplicate material lines
  const seenMaterials = new Set<string>();
  const processedIngredients: Array<{
    materialId: string;
    quantityBase: number;
    displayUnit: string;
    displayQuantity: number;
    lossPercent: number;
    notes: string | null;
  }> = [];

  for (const ing of input.ingredients) {
    if (seenMaterials.has(ing.materialId)) {
      throw new InventoryValidationError(
        `Duplicate ingredient material ID '${ing.materialId}' in recipe definition.`
      );
    }
    seenMaterials.add(ing.materialId);

    const mat = await db.queryOne<any>(
      "SELECT id, base_unit, is_active FROM kitchen_raw_materials WHERE id = ?",
      [ing.materialId]
    );
    if (!mat) {
      throw new InventoryValidationError(`Referenced raw material '${ing.materialId}' does not exist.`);
    }
    if (Number(mat.is_active) === 0) {
      throw new InventoryValidationError(
        `Referenced raw material '${ing.materialId}' is inactive. Cannot add inactive materials to recipes.`
      );
    }

    const quantityBase = convertToBaseUnit(
      ing.quantity,
      ing.unit,
      mat.base_unit as RawMaterialBaseUnit
    );

    const lossPercent = Math.min(100, Math.max(0, Number(ing.lossPercent || 0)));

    processedIngredients.push({
      materialId: ing.materialId,
      quantityBase,
      displayUnit: ing.unit.trim().toUpperCase(),
      displayQuantity: Math.round(ing.quantity),
      lossPercent,
      notes: ing.notes ? ing.notes.trim() : null,
    });
  }

  const recipeId = `rcp_${crypto.randomUUID()}`;
  const now = new Date().toISOString();

  await db.transaction(async (tx) => {
    await tx.execute(
      `
      INSERT INTO kitchen_recipes (
        id, name, description, meal_type, product_id, yield_servings,
        version, is_active, created_by, updated_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 1, 1, ?, NULL, ?, ?)
    `,
      [
        recipeId,
        input.name.trim(),
        input.description ? input.description.trim() : null,
        input.mealType || null,
        input.productId || null,
        yieldServings,
        actor.id,
        now,
        now,
      ]
    );

    for (const item of processedIngredients) {
      const ingId = `kri_${crypto.randomUUID()}`;
      await tx.execute(
        `
        INSERT INTO kitchen_recipe_ingredients (
          id, recipe_id, recipe_version, material_id, quantity_base,
          display_unit, display_quantity, loss_percent, notes, created_at, updated_at
        ) VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
        [
          ingId,
          recipeId,
          item.materialId,
          item.quantityBase,
          item.displayUnit,
          item.displayQuantity,
          item.lossPercent,
          item.notes,
          now,
          now,
        ]
      );
    }
  });

  await recordAuditEventAsync({
    actorId: actor.id,
    actorUsername: actor.username,
    action: "kitchen.recipe_created",
    targetType: "kitchen_recipe",
    targetId: recipeId,
    metadata: {
      name: input.name,
      mealType: input.mealType,
      productId: input.productId,
      yieldServings,
      ingredientCount: processedIngredients.length,
    },
    ipAddress: clientIp,
  });

  const created = await getRecipeById(actor, recipeId, db);
  return created!;
}

export async function updateRecipe(
  actor: AuthenticatedUser,
  id: string,
  input: UpdateRecipeInput,
  clientIp?: string,
  providedDb?: AsyncDb
): Promise<KitchenRecipe> {
  requirePermission(actor, "kitchen.manage");
  const db = providedDb || (await getAsyncDb());

  const existing = await db.queryOne<any>("SELECT * FROM kitchen_recipes WHERE id = ?", [id]);
  if (!existing) {
    throw new InventoryValidationError(`Recipe '${id}' not found.`);
  }

  const now = new Date().toISOString();
  const currentVersion = Number(existing.version || 1);

  await db.transaction(async (tx) => {
    // If ingredients are changing, increment recipe version snapshot to preserve historical consumption integrity!
    if (input.ingredients !== undefined) {
      if (input.ingredients.length === 0) {
        throw new InventoryValidationError("A recipe must include at least one ingredient.");
      }

      const nextVersion = currentVersion + 1;
      const seenMaterials = new Set<string>();

      for (const ing of input.ingredients) {
        if (seenMaterials.has(ing.materialId)) {
          throw new InventoryValidationError(
            `Duplicate ingredient material ID '${ing.materialId}' in recipe definition.`
          );
        }
        seenMaterials.add(ing.materialId);

        const mat = await tx.queryOne<any>(
          "SELECT id, base_unit, is_active FROM kitchen_raw_materials WHERE id = ?",
          [ing.materialId]
        );
        if (!mat) {
          throw new InventoryValidationError(`Referenced raw material '${ing.materialId}' does not exist.`);
        }
        if (Number(mat.is_active) === 0) {
          throw new InventoryValidationError(
            `Referenced raw material '${ing.materialId}' is inactive. Cannot add inactive materials to recipes.`
          );
        }

        const quantityBase = convertToBaseUnit(
          ing.quantity,
          ing.unit,
          mat.base_unit as RawMaterialBaseUnit
        );
        const lossPercent = Math.min(100, Math.max(0, Number(ing.lossPercent || 0)));
        const ingId = `kri_${crypto.randomUUID()}`;

        await tx.execute(
          `
          INSERT INTO kitchen_recipe_ingredients (
            id, recipe_id, recipe_version, material_id, quantity_base,
            display_unit, display_quantity, loss_percent, notes, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
          [
            ingId,
            id,
            nextVersion,
            ing.materialId,
            quantityBase,
            ing.unit.trim().toUpperCase(),
            Math.round(ing.quantity),
            lossPercent,
            ing.notes ? ing.notes.trim() : null,
            now,
            now,
          ]
        );
      }

      await tx.execute(
        `UPDATE kitchen_recipes SET version = ?, updated_by = ?, updated_at = ? WHERE id = ?`,
        [nextVersion, actor.id, now, id]
      );
    }

    // Update metadata
    const metaUpdates: string[] = [];
    const metaParams: any[] = [];

    if (input.name !== undefined) {
      if (!input.name.trim()) throw new InventoryValidationError("Recipe name cannot be empty.");
      metaUpdates.push("name = ?");
      metaParams.push(input.name.trim());
    }

    if (input.description !== undefined) {
      metaUpdates.push("description = ?");
      metaParams.push(input.description ? input.description.trim() : null);
    }

    if (input.mealType !== undefined) {
      metaUpdates.push("meal_type = ?");
      metaParams.push(input.mealType || null);
    }

    if (input.productId !== undefined) {
      metaUpdates.push("product_id = ?");
      metaParams.push(input.productId || null);
    }

    if (input.yieldServings !== undefined) {
      const y = Number(input.yieldServings);
      if (isNaN(y) || y < 1) throw new InventoryValidationError("Yield servings must be >= 1.");
      metaUpdates.push("yield_servings = ?");
      metaParams.push(Math.round(y));
    }

    if (input.isActive !== undefined) {
      metaUpdates.push("is_active = ?");
      metaParams.push(input.isActive ? 1 : 0);
    }

    if (metaUpdates.length > 0) {
      metaUpdates.push("updated_by = ?");
      metaParams.push(actor.id);
      metaUpdates.push("updated_at = ?");
      metaParams.push(now);
      metaParams.push(id);
      await tx.execute(
        `UPDATE kitchen_recipes SET ${metaUpdates.join(", ")} WHERE id = ?`,
        metaParams
      );
    }
  });

  await recordAuditEventAsync({
    actorId: actor.id,
    actorUsername: actor.username,
    action: "kitchen.recipe_updated",
    targetType: "kitchen_recipe",
    targetId: id,
    metadata: { changes: input },
    ipAddress: clientIp,
  });

  const updated = await getRecipeById(actor, id, db);
  return updated!;
}

export async function getRecipeById(
  actor: AuthenticatedUser,
  id: string,
  providedDb?: AsyncDb,
  version?: number
): Promise<KitchenRecipe | null> {
  requirePermission(actor, "kitchen.read");
  const db = providedDb || (await getAsyncDb());

  const row = await db.queryOne<any>("SELECT * FROM kitchen_recipes WHERE id = ?", [id]);
  if (!row) return null;

  const targetVersion = version !== undefined ? version : Number(row.version);

  const ingRows = await db.query<any>(
    `
    SELECT kri.*, m.code as material_code, m.name as material_name, m.category, m.base_unit
    FROM kitchen_recipe_ingredients kri
    JOIN kitchen_raw_materials m ON kri.material_id = m.id
    WHERE kri.recipe_id = ? AND kri.recipe_version = ?
    ORDER BY m.name ASC
  `,
    [id, targetVersion]
  );

  const ingredients: KitchenRecipeIngredient[] = ingRows.map((r) => ({
    id: r.id,
    recipeId: r.recipe_id,
    recipeVersion: Number(r.recipe_version),
    materialId: r.material_id,
    materialCode: r.material_code,
    materialName: r.material_name,
    category: r.category as RawMaterialCategory,
    baseUnit: r.base_unit as RawMaterialBaseUnit,
    quantityBase: Number(r.quantity_base),
    displayUnit: r.display_unit,
    displayQuantity: Number(r.display_quantity),
    lossPercent: Number(r.loss_percent || 0),
    notes: r.notes || null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));

  return mapRowToRecipe(row, ingredients);
}

export async function listRecipes(
  actor: AuthenticatedUser,
  filter?: { mealType?: MealType; productId?: string; isActive?: boolean },
  providedDb?: AsyncDb
): Promise<KitchenRecipe[]> {
  requirePermission(actor, "kitchen.read");
  const db = providedDb || (await getAsyncDb());

  const conditions: string[] = [];
  const params: any[] = [];

  if (filter?.mealType) {
    conditions.push("meal_type = ?");
    params.push(filter.mealType);
  }

  if (filter?.productId) {
    conditions.push("product_id = ?");
    params.push(filter.productId);
  }

  if (filter?.isActive !== undefined) {
    conditions.push("is_active = ?");
    params.push(filter.isActive ? 1 : 0);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const rows = await db.query<any>(
    `SELECT * FROM kitchen_recipes ${whereClause} ORDER BY name ASC`,
    params
  );

  const recipes: KitchenRecipe[] = [];
  for (const row of rows) {
    const full = await getRecipeById(actor, row.id, db);
    if (full) recipes.push(full);
  }

  return recipes;
}

export async function getActiveRecipeForMealOrProduct(
  mealType?: MealType | null,
  productId?: string | null,
  providedDb?: AsyncDb
): Promise<KitchenRecipe | null> {
  const db = providedDb || (await getAsyncDb());

  if (productId) {
    const row = await db.queryOne<any>(
      "SELECT id FROM kitchen_recipes WHERE product_id = ? AND is_active = 1 LIMIT 1",
      [productId]
    );
    if (row) {
      // Mock actor with kitchen.read for internal lookup
      const sysActor: AuthenticatedUser = {
        id: "system",
        username: "system",
        fullName: "System",
        email: "system@internal.ravinarayan.com",
        role: "SUPER_ADMIN",
      };
      return getRecipeById(sysActor, row.id, db);
    }
  }

  if (mealType) {
    const row = await db.queryOne<any>(
      "SELECT id FROM kitchen_recipes WHERE meal_type = ? AND is_active = 1 LIMIT 1",
      [mealType]
    );
    if (row) {
      const sysActor: AuthenticatedUser = {
        id: "system",
        username: "system",
        fullName: "System",
        email: "system@internal.ravinarayan.com",
        role: "SUPER_ADMIN",
      };
      return getRecipeById(sysActor, row.id, db);
    }
  }

  return null;
}

// -----------------------------------------------------------------------------
// Production-Linked Consumption Workflow
// -----------------------------------------------------------------------------

function mapRowToConsumption(row: any, movements?: KitchenStockMovement[]): KitchenProductionConsumption {
  return {
    id: row.id,
    planId: row.plan_id,
    mealType: row.meal_type as MealType,
    serviceDate: row.service_date,
    recipeId: row.recipe_id,
    recipeName: row.recipe_name,
    recipeVersion: Number(row.recipe_version),
    producedServings: Number(row.produced_servings),
    status: row.status as "POSTED" | "REVERSED",
    notes: row.notes || null,
    postedBy: row.posted_by,
    postedByName: row.posted_by_name || null,
    postedAt: row.posted_at,
    reversedBy: row.reversed_by || null,
    reversedByName: row.reversed_by_name || null,
    reversedAt: row.reversed_at || null,
    reversalReason: row.reversal_reason || null,
    movements,
  };
}

export async function getProductionConsumptionForPlan(
  actor: AuthenticatedUser,
  planId: string,
  providedDb?: AsyncDb
): Promise<KitchenProductionConsumption | null> {
  requirePermission(actor, "kitchen.read");
  const db = providedDb || (await getAsyncDb());

  const row = await db.queryOne<any>(
    `
    SELECT c.*, r.name as recipe_name, u1.full_name as posted_by_name, u2.full_name as reversed_by_name
    FROM kitchen_production_consumptions c
    LEFT JOIN kitchen_recipes r ON c.recipe_id = r.id
    LEFT JOIN staff_users u1 ON c.posted_by = u1.id
    LEFT JOIN staff_users u2 ON c.reversed_by = u2.id
    WHERE c.plan_id = ? AND c.status = 'POSTED'
    LIMIT 1
  `,
    [planId]
  );

  if (!row) return null;

  const mRows = await db.query<any>(
    `
    SELECT m.*, krm.code as material_code, krm.name as material_name
    FROM kitchen_stock_movements m
    JOIN kitchen_raw_materials krm ON m.material_id = krm.id
    WHERE m.source_type = 'PRODUCTION_PLAN' AND m.source_id = ?
    ORDER BY m.created_at ASC
  `,
    [planId]
  );

  return mapRowToConsumption(row, mRows.map(mapRowToMovement));
}

export async function previewProductionConsumption(
  actor: AuthenticatedUser,
  planId: string,
  providedDb?: AsyncDb
): Promise<ProductionConsumptionPreview> {
  requirePermission(actor, "kitchen.read");
  const db = providedDb || (await getAsyncDb());

  const plan = await db.queryOne<any>("SELECT * FROM daily_meal_plans WHERE id = ?", [planId]);
  if (!plan) {
    throw new InventoryValidationError(`Meal plan '${planId}' not found.`);
  }

  const existingConsumption = await getProductionConsumptionForPlan(actor, planId, db);

  const activeRecipe = await getActiveRecipeForMealOrProduct(
    plan.meal_type as MealType,
    null,
    db
  );

  // Authoritative production count: strictly actual_cooked_count when COMPLETED
  const actualCookedCount = Number(plan.actual_cooked_count || 0);
  const isAuthoritativeCompleted = plan.status === "COMPLETED" && actualCookedCount > 0;

  if (!activeRecipe) {
    return {
      planId,
      serviceDate: plan.service_date,
      mealType: plan.meal_type as MealType,
      planStatus: plan.status,
      actualCookedCount,
      recipe: null,
      ingredients: [],
      canConfirm: false,
      hasShortages: false,
      existingConsumption,
    };
  }

  // Load recipe ingredients with current raw material stock balances
  const ingRows = await db.query<any>(
    `
    SELECT kri.*, krm.code as material_code, krm.name as material_name, krm.category, krm.base_unit, krm.current_stock
    FROM kitchen_recipe_ingredients kri
    JOIN kitchen_raw_materials krm ON kri.material_id = krm.id
    WHERE kri.recipe_id = ? AND kri.recipe_version = ?
    ORDER BY krm.name ASC
  `,
    [activeRecipe.id, activeRecipe.version]
  );

  let hasShortages = false;
  const ingredients: ConsumptionPreviewIngredient[] = [];

  const servingsToUse = isAuthoritativeCompleted
    ? actualCookedCount
    : Number(plan.final_preparation_count || 0);

  for (const ing of ingRows) {
    const yieldServings = activeRecipe.yieldServings || 1;
    const perServingBase = Number(ing.quantity_base) / yieldServings;
    const requiredBase = Math.round(servingsToUse * perServingBase);
    const currentStock = Number(ing.current_stock || 0);
    const isSufficient = currentStock >= requiredBase;
    const shortageBase = isSufficient ? 0 : requiredBase - currentStock;

    if (!isSufficient) {
      hasShortages = true;
    }

    ingredients.push({
      materialId: ing.material_id,
      materialCode: ing.material_code,
      materialName: ing.material_name,
      category: ing.category as RawMaterialCategory,
      baseUnit: ing.base_unit as RawMaterialBaseUnit,
      displayUnit: ing.display_unit,
      quantityPerServingBase: perServingBase,
      requiredQuantityBase: requiredBase,
      currentStockBase: currentStock,
      isSufficient,
      shortageBase,
    });
  }

  const canConfirm =
    isAuthoritativeCompleted &&
    !hasShortages &&
    !existingConsumption &&
    ingredients.length > 0;

  return {
    planId,
    serviceDate: plan.service_date,
    mealType: plan.meal_type as MealType,
    planStatus: plan.status,
    actualCookedCount,
    recipe: {
      id: activeRecipe.id,
      name: activeRecipe.name,
      version: activeRecipe.version,
      yieldServings: activeRecipe.yieldServings,
    },
    ingredients,
    canConfirm,
    hasShortages,
    existingConsumption,
  };
}

export async function confirmProductionConsumption(
  actor: AuthenticatedUser,
  planId: string,
  notes?: string,
  clientIp?: string,
  providedDb?: AsyncDb
): Promise<KitchenProductionConsumption> {
  requirePermission(actor, "kitchen.manage");
  const db = providedDb || (await getAsyncDb());

  // 1. Authoritative meal plan check
  const plan = await db.queryOne<any>("SELECT * FROM daily_meal_plans WHERE id = ?", [planId]);
  if (!plan) {
    throw new InventoryValidationError(`Daily meal plan '${planId}' not found.`);
  }

  if (plan.status !== "COMPLETED") {
    throw new InventoryValidationError(
      `Cannot confirm consumption: Daily meal plan '${planId}' has status '${plan.status}'. Production consumption requires status 'COMPLETED'.`
    );
  }

  const actualCookedCount = Number(plan.actual_cooked_count || 0);
  if (actualCookedCount <= 0) {
    throw new InventoryValidationError(
      "Cannot confirm consumption: Authoritative actual cooked count is missing or zero. Meal production must be reconciled first."
    );
  }

  // 2. Duplicate prevention & Idempotency check:
  // If already posted, return the existing consumption record without deducting inventory again!
  const existing = await getProductionConsumptionForPlan(actor, planId, db);
  if (existing) {
    return existing;
  }

  // 3. Resolve active recipe
  const activeRecipe = await getActiveRecipeForMealOrProduct(
    plan.meal_type as MealType,
    null,
    db
  );
  if (!activeRecipe) {
    throw new InventoryValidationError(
      `No active recipe found for meal type '${plan.meal_type}'. Please configure a recipe before confirming consumption.`
    );
  }

  const ingRows = await db.query<any>(
    `
    SELECT kri.*, krm.code as material_code, krm.name as material_name, krm.current_stock
    FROM kitchen_recipe_ingredients kri
    JOIN kitchen_raw_materials krm ON kri.material_id = krm.id
    WHERE kri.recipe_id = ? AND kri.recipe_version = ?
  `,
    [activeRecipe.id, activeRecipe.version]
  );

  if (ingRows.length === 0) {
    throw new InventoryValidationError(
      `Active recipe '${activeRecipe.name}' has no ingredient lines configured.`
    );
  }

  // 4. Validate stock sufficiency for all recipe ingredients
  const shortages: Array<{
    materialId: string;
    materialCode: string;
    materialName: string;
    required: number;
    available: number;
    shortage: number;
  }> = [];

  const deductions: Array<{
    materialId: string;
    materialCode: string;
    materialName: string;
    requiredQuantityBase: number;
    unit: string;
  }> = [];

  for (const ing of ingRows) {
    const yieldServings = activeRecipe.yieldServings || 1;
    const requiredQuantityBase = Math.round(
      actualCookedCount * (Number(ing.quantity_base) / yieldServings)
    );
    const available = Number(ing.current_stock || 0);

    if (available < requiredQuantityBase) {
      shortages.push({
        materialId: ing.material_id,
        materialCode: ing.material_code,
        materialName: ing.material_name,
        required: requiredQuantityBase,
        available,
        shortage: requiredQuantityBase - available,
      });
    }

    deductions.push({
      materialId: ing.material_id,
      materialCode: ing.material_code,
      materialName: ing.material_name,
      requiredQuantityBase,
      unit: ing.display_unit,
    });
  }

  if (shortages.length > 0) {
    throw new InsufficientStockError(
      "Insufficient raw material stock to confirm production consumption.",
      shortages
    );
  }

  // 5. Atomic transaction execution
  const consumptionId = `kpc_${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  const actorName = actor.fullName || actor.username;

  // Canonical ordering of ingredients by materialId to prevent deadlock under concurrent transactions
  const sortedDeductions = [...deductions].sort((a, b) => a.materialId.localeCompare(b.materialId));

  const existingInTx = await db.transaction(async (tx) => {
    // 5.1 Re-verify idempotency inside transaction under lock
    const alreadyPosted = await getProductionConsumptionForPlan(actor, planId, tx);
    if (alreadyPosted) {
      return alreadyPosted;
    }

    // 5.2 Atomic conditional decrement and stock movement for each ingredient
    for (const d of sortedDeductions) {
      const updateRes = await tx.execute(
        `UPDATE kitchen_raw_materials
         SET current_stock = current_stock - ?, updated_at = ?
         WHERE id = ? AND current_stock >= ?`,
        [d.requiredQuantityBase, now, d.materialId, d.requiredQuantityBase]
      );

      if (updateRes.changes === 0) {
        // Atomic conditional update failed: stock was insufficient at the moment of the write!
        const fresh = await tx.queryOne<{ current_stock: number; name: string; code: string }>(
          `SELECT current_stock, name, code FROM kitchen_raw_materials WHERE id = ?`,
          [d.materialId]
        );
        const currentAvailable = Number(fresh?.current_stock || 0);
        throw new InsufficientStockError(
          `Insufficient raw material stock to confirm production consumption for "${d.materialName}" (${d.materialCode}). Required: ${d.requiredQuantityBase} ${d.unit}, Available: ${currentAvailable} ${d.unit}.`,
          [
            {
              materialId: d.materialId,
              materialCode: d.materialCode,
              materialName: d.materialName,
              required: d.requiredQuantityBase,
              available: currentAvailable,
              shortage: Math.max(0, d.requiredQuantityBase - currentAvailable),
            },
          ]
        );
      }

      const movementId = `ksm_${crypto.randomUUID()}`;
      const reason = `Recipe consumption for ${plan.meal_type} on ${plan.service_date} (${actualCookedCount} servings)`;

      await tx.execute(
        `
        INSERT INTO kitchen_stock_movements (
          id, material_id, movement_type, quantity_base, unit,
          source_type, source_id, reason, actor_id, actor_name, created_at
        ) VALUES (?, ?, 'PRODUCTION_CONSUMPTION', ?, ?, 'PRODUCTION_PLAN', ?, ?, ?, ?, ?)
      `,
        [
          movementId,
          d.materialId,
          -d.requiredQuantityBase,
          d.unit,
          plan.id,
          reason,
          actor.id,
          actorName,
          now,
        ]
      );
    }

    // 5.3 Insert consumption header
    await tx.execute(
      `
      INSERT INTO kitchen_production_consumptions (
        id, plan_id, meal_type, service_date, recipe_id, recipe_version,
        produced_servings, status, notes, posted_by, posted_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'POSTED', ?, ?, ?)
    `,
      [
        consumptionId,
        plan.id,
        plan.meal_type,
        plan.service_date,
        activeRecipe.id,
        activeRecipe.version,
        actualCookedCount,
        notes ? notes.trim() : null,
        actor.id,
        now,
      ]
    );

    return null;
  });

  if (existingInTx) {
    return existingInTx;
  }

  await recordAuditEventAsync({
    actorId: actor.id,
    actorUsername: actor.username,
    action: "kitchen.consumption_confirmed",
    targetType: "kitchen_production_consumption",
    targetId: consumptionId,
    metadata: {
      planId: plan.id,
      serviceDate: plan.service_date,
      mealType: plan.meal_type,
      recipeId: activeRecipe.id,
      recipeVersion: activeRecipe.version,
      producedServings: actualCookedCount,
      deductionsCount: deductions.length,
    },
    ipAddress: clientIp,
  });

  const created = await getProductionConsumptionForPlan(actor, planId, db);
  return created!;
}

export async function reverseProductionConsumption(
  actor: AuthenticatedUser,
  planId: string,
  reason: string,
  clientIp?: string,
  providedDb?: AsyncDb
): Promise<KitchenProductionConsumption> {
  requirePermission(actor, "kitchen.manage");
  const db = providedDb || (await getAsyncDb());

  if (!reason || !reason.trim()) {
    throw new InventoryValidationError("A reversal reason is mandatory to correct or reverse consumption.");
  }

  const existing = await db.queryOne<any>(
    "SELECT * FROM kitchen_production_consumptions WHERE plan_id = ? AND status = 'POSTED'",
    [planId]
  );
  if (!existing) {
    throw new InventoryValidationError(
      `No active POSTED production consumption found for meal plan '${planId}'.`
    );
  }

  const movements = await db.query<any>(
    `
    SELECT * FROM kitchen_stock_movements
    WHERE source_type = 'PRODUCTION_PLAN' AND source_id = ? AND movement_type = 'PRODUCTION_CONSUMPTION'
  `,
    [planId]
  );

  const now = new Date().toISOString();
  const actorName = actor.fullName || actor.username;

  await db.transaction(async (tx) => {
    // 1. Mark consumption record as REVERSED
    await tx.execute(
      `
      UPDATE kitchen_production_consumptions
      SET status = 'REVERSED', reversed_by = ?, reversed_at = ?, reversal_reason = ?
      WHERE id = ?
    `,
      [actor.id, now, reason.trim(), existing.id]
    );

    // 2. Post compensating stock movements and restore raw material balances
    for (const m of movements) {
      const revMovementId = `ksm_${crypto.randomUUID()}`;
      const qtyToRestore = Math.abs(Number(m.quantity_base));
      const revReason = `Reversal: ${reason.trim()} (Ref: ${m.reason})`;

      await tx.execute(
        `
        INSERT INTO kitchen_stock_movements (
          id, material_id, movement_type, quantity_base, unit,
          source_type, source_id, reason, actor_id, actor_name, created_at
        ) VALUES (?, ?, 'PRODUCTION_REVERSAL', ?, ?, 'PRODUCTION_PLAN', ?, ?, ?, ?, ?)
      `,
        [
          revMovementId,
          m.material_id,
          qtyToRestore,
          m.unit,
          planId,
          revReason,
          actor.id,
          actorName,
          now,
        ]
      );

      await tx.execute(
        `UPDATE kitchen_raw_materials SET current_stock = current_stock + ?, updated_at = ? WHERE id = ?`,
        [qtyToRestore, now, m.material_id]
      );
    }
  });

  await recordAuditEventAsync({
    actorId: actor.id,
    actorUsername: actor.username,
    action: "kitchen.consumption_reversed",
    targetType: "kitchen_production_consumption",
    targetId: existing.id,
    metadata: {
      planId,
      reason,
      restoredMovementsCount: movements.length,
    },
    ipAddress: clientIp,
  });

  const reversedRow = await db.queryOne<any>(
    `
    SELECT c.*, r.name as recipe_name, u1.full_name as posted_by_name, u2.full_name as reversed_by_name
    FROM kitchen_production_consumptions c
    LEFT JOIN kitchen_recipes r ON c.recipe_id = r.id
    LEFT JOIN staff_users u1 ON c.posted_by = u1.id
    LEFT JOIN staff_users u2 ON c.reversed_by = u2.id
    WHERE c.id = ?
  `,
    [existing.id]
  );

  return mapRowToConsumption(reversedRow);
}

export async function listProductionConsumptions(
  actor: AuthenticatedUser,
  filter?: { serviceDate?: string; mealType?: MealType; status?: string },
  providedDb?: AsyncDb
): Promise<KitchenProductionConsumption[]> {
  requirePermission(actor, "kitchen.read");
  const db = providedDb || (await getAsyncDb());

  const conditions: string[] = [];
  const params: any[] = [];

  if (filter?.serviceDate) {
    conditions.push("c.service_date = ?");
    params.push(filter.serviceDate);
  }

  if (filter?.mealType) {
    conditions.push("c.meal_type = ?");
    params.push(filter.mealType);
  }

  if (filter?.status) {
    conditions.push("c.status = ?");
    params.push(filter.status);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const rows = await db.query<any>(
    `
    SELECT c.*, r.name as recipe_name, u1.full_name as posted_by_name, u2.full_name as reversed_by_name
    FROM kitchen_production_consumptions c
    LEFT JOIN kitchen_recipes r ON c.recipe_id = r.id
    LEFT JOIN staff_users u1 ON c.posted_by = u1.id
    LEFT JOIN staff_users u2 ON c.reversed_by = u2.id
    ${whereClause}
    ORDER BY c.service_date DESC, c.posted_at DESC
  `,
    params
  );

  return rows.map((r) => mapRowToConsumption(r));
}
