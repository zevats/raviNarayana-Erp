-- Task 01B.48: Kitchen Raw Material Inventory, Recipes, and Production Consumption
CREATE TABLE IF NOT EXISTS "kitchen_raw_materials" (
  "id" text PRIMARY KEY NOT NULL,
  "code" text NOT NULL,
  "name" text NOT NULL,
  "description" text,
  "category" text NOT NULL,
  "base_unit" text NOT NULL,
  "current_stock" integer DEFAULT 0 NOT NULL,
  "reorder_threshold" integer DEFAULT 0 NOT NULL,
  "is_active" integer DEFAULT 1 NOT NULL,
  "created_by" text NOT NULL,
  "updated_by" text,
  "created_at" text NOT NULL,
  "updated_at" text NOT NULL,
  CONSTRAINT "kitchen_raw_materials_code_unique" UNIQUE("code")
);--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "kitchen_raw_materials" ADD CONSTRAINT "kitchen_raw_materials_created_by_staff_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."staff_users"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "kitchen_raw_materials" ADD CONSTRAINT "kitchen_raw_materials_updated_by_staff_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."staff_users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "idx_krm_code" ON "kitchen_raw_materials" USING btree ("code");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_krm_category" ON "kitchen_raw_materials" USING btree ("category");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_krm_active" ON "kitchen_raw_materials" USING btree ("is_active");--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "kitchen_raw_materials" ADD CONSTRAINT "chk_krm_category" CHECK ("category" IN ('GRAINS', 'PULSES', 'VEGETABLES', 'DAIRY', 'SPICES', 'OILS', 'PACKAGING', 'OTHER'));
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "kitchen_raw_materials" ADD CONSTRAINT "chk_krm_base_unit" CHECK ("base_unit" IN ('G', 'ML', 'PCS'));
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "kitchen_raw_materials" ADD CONSTRAINT "chk_krm_reorder" CHECK ("reorder_threshold" >= 0);
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint

-- 2. Kitchen Recipes
CREATE TABLE IF NOT EXISTS "kitchen_recipes" (
  "id" text PRIMARY KEY NOT NULL,
  "name" text NOT NULL,
  "description" text,
  "meal_type" text,
  "product_id" text,
  "yield_servings" integer DEFAULT 1 NOT NULL,
  "version" integer DEFAULT 1 NOT NULL,
  "is_active" integer DEFAULT 1 NOT NULL,
  "created_by" text NOT NULL,
  "updated_by" text,
  "created_at" text NOT NULL,
  "updated_at" text NOT NULL
);--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "kitchen_recipes" ADD CONSTRAINT "kitchen_recipes_created_by_staff_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."staff_users"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "kitchen_recipes" ADD CONSTRAINT "kitchen_recipes_updated_by_staff_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."staff_users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "kitchen_recipes" ADD CONSTRAINT "kitchen_recipes_product_id_tiffin_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."tiffin_products"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_kr_meal_type" ON "kitchen_recipes" USING btree ("meal_type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_kr_product" ON "kitchen_recipes" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_kr_active" ON "kitchen_recipes" USING btree ("is_active");--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "kitchen_recipes" ADD CONSTRAINT "chk_kr_yield" CHECK ("yield_servings" >= 1);
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "kitchen_recipes" ADD CONSTRAINT "chk_kr_version" CHECK ("version" >= 1);
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "kitchen_recipes" ADD CONSTRAINT "chk_kr_meal_type" CHECK ("meal_type" IS NULL OR "meal_type" IN ('BREAKFAST', 'LUNCH', 'DINNER'));
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint

-- 3. Kitchen Recipe Ingredients
CREATE TABLE IF NOT EXISTS "kitchen_recipe_ingredients" (
  "id" text PRIMARY KEY NOT NULL,
  "recipe_id" text NOT NULL,
  "recipe_version" integer DEFAULT 1 NOT NULL,
  "material_id" text NOT NULL,
  "quantity_base" integer NOT NULL,
  "display_unit" text NOT NULL,
  "display_quantity" integer NOT NULL,
  "loss_percent" integer DEFAULT 0 NOT NULL,
  "notes" text,
  "created_at" text NOT NULL,
  "updated_at" text NOT NULL
);--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "kitchen_recipe_ingredients" ADD CONSTRAINT "kitchen_recipe_ingredients_recipe_id_kitchen_recipes_id_fk" FOREIGN KEY ("recipe_id") REFERENCES "public"."kitchen_recipes"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "kitchen_recipe_ingredients" ADD CONSTRAINT "kitchen_recipe_ingredients_material_id_kitchen_raw_materials_id_fk" FOREIGN KEY ("material_id") REFERENCES "public"."kitchen_raw_materials"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_kri_recipe" ON "kitchen_recipe_ingredients" USING btree ("recipe_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_kri_material" ON "kitchen_recipe_ingredients" USING btree ("material_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_kri_recipe_ver_mat" ON "kitchen_recipe_ingredients" USING btree ("recipe_id", "recipe_version", "material_id");--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "kitchen_recipe_ingredients" ADD CONSTRAINT "chk_kri_qty" CHECK ("quantity_base" > 0);
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "kitchen_recipe_ingredients" ADD CONSTRAINT "chk_kri_loss" CHECK ("loss_percent" >= 0 AND "loss_percent" <= 100);
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint

-- 4. Kitchen Stock Movements
CREATE TABLE IF NOT EXISTS "kitchen_stock_movements" (
  "id" text PRIMARY KEY NOT NULL,
  "material_id" text NOT NULL,
  "movement_type" text NOT NULL,
  "quantity_base" integer NOT NULL,
  "unit" text NOT NULL,
  "source_type" text NOT NULL,
  "source_id" text,
  "reason" text NOT NULL,
  "actor_id" text NOT NULL,
  "actor_name" text,
  "created_at" text NOT NULL
);--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "kitchen_stock_movements" ADD CONSTRAINT "kitchen_stock_movements_material_id_kitchen_raw_materials_id_fk" FOREIGN KEY ("material_id") REFERENCES "public"."kitchen_raw_materials"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "kitchen_stock_movements" ADD CONSTRAINT "kitchen_stock_movements_actor_id_staff_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."staff_users"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_ksm_material" ON "kitchen_stock_movements" USING btree ("material_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_ksm_type" ON "kitchen_stock_movements" USING btree ("movement_type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_ksm_source" ON "kitchen_stock_movements" USING btree ("source_type", "source_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_ksm_created" ON "kitchen_stock_movements" USING btree ("created_at");--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "kitchen_stock_movements" ADD CONSTRAINT "chk_ksm_type" CHECK ("movement_type" IN ('OPENING_BALANCE', 'RECEIPT', 'ADJUSTMENT_ADD', 'ADJUSTMENT_SUB', 'PRODUCTION_CONSUMPTION', 'PRODUCTION_REVERSAL', 'WASTE'));
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "kitchen_stock_movements" ADD CONSTRAINT "chk_ksm_source_type" CHECK ("source_type" IN ('MANUAL', 'PRODUCTION_PLAN', 'WASTE_REPORT'));
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint

-- 5. Kitchen Production Consumptions
CREATE TABLE IF NOT EXISTS "kitchen_production_consumptions" (
  "id" text PRIMARY KEY NOT NULL,
  "plan_id" text NOT NULL,
  "meal_type" text NOT NULL,
  "service_date" text NOT NULL,
  "recipe_id" text NOT NULL,
  "recipe_version" integer DEFAULT 1 NOT NULL,
  "produced_servings" integer NOT NULL,
  "status" text DEFAULT 'POSTED' NOT NULL,
  "notes" text,
  "posted_by" text NOT NULL,
  "posted_at" text NOT NULL,
  "reversed_by" text,
  "reversed_at" text,
  "reversal_reason" text
);--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "kitchen_production_consumptions" ADD CONSTRAINT "kitchen_production_consumptions_plan_id_daily_meal_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."daily_meal_plans"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "kitchen_production_consumptions" ADD CONSTRAINT "kitchen_production_consumptions_recipe_id_kitchen_recipes_id_fk" FOREIGN KEY ("recipe_id") REFERENCES "public"."kitchen_recipes"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "kitchen_production_consumptions" ADD CONSTRAINT "kitchen_production_consumptions_posted_by_staff_users_id_fk" FOREIGN KEY ("posted_by") REFERENCES "public"."staff_users"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "kitchen_production_consumptions" ADD CONSTRAINT "kitchen_production_consumptions_reversed_by_staff_users_id_fk" FOREIGN KEY ("reversed_by") REFERENCES "public"."staff_users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_kpc_plan" ON "kitchen_production_consumptions" USING btree ("plan_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_kpc_date" ON "kitchen_production_consumptions" USING btree ("service_date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_kpc_status" ON "kitchen_production_consumptions" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_kpc_plan_posted" ON "kitchen_production_consumptions" USING btree ("plan_id", "status");--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "kitchen_production_consumptions" ADD CONSTRAINT "chk_kpc_status" CHECK ("status" IN ('POSTED', 'REVERSED'));
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "kitchen_production_consumptions" ADD CONSTRAINT "chk_kpc_servings" CHECK ("produced_servings" > 0);
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
