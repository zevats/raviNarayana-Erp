CREATE TABLE "tiffin_customers" (
	"id" text PRIMARY KEY NOT NULL,
	"full_name" text NOT NULL,
	"phone" text NOT NULL,
	"alternate_phone" text,
	"delivery_address" text NOT NULL,
	"landmark" text,
	"delivery_instructions" text,
	"customer_type" text DEFAULT 'INDIVIDUAL' NOT NULL,
	"dietary_preference" text DEFAULT 'VEG' NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"notes" text,
	"created_by" text NOT NULL,
	"updated_by" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "chk_tiffin_cust_type" CHECK ("customer_type" IN ('INDIVIDUAL', 'CORPORATE', 'RESIDENTIAL_PG')),
	CONSTRAINT "chk_tiffin_cust_diet" CHECK ("dietary_preference" IN ('VEG', 'NON_VEG', 'JAIN')),
	CONSTRAINT "chk_tiffin_cust_status" CHECK ("status" IN ('ACTIVE', 'INACTIVE'))
);
--> statement-breakpoint

ALTER TABLE "tiffin_customers" ADD CONSTRAINT "tiffin_customers_created_by_staff_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."staff_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tiffin_customers" ADD CONSTRAINT "tiffin_customers_updated_by_staff_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."staff_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint

CREATE INDEX "idx_tiffin_cust_phone" ON "tiffin_customers" USING btree ("phone");--> statement-breakpoint
CREATE INDEX "idx_tiffin_cust_status" ON "tiffin_customers" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_tiffin_cust_name" ON "tiffin_customers" USING btree ("full_name");--> statement-breakpoint

CREATE TABLE "tiffin_products" (
	"id" text PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"category" text NOT NULL,
	"billing_unit" text NOT NULL,
	"price" integer NOT NULL,
	"currency" text DEFAULT 'INR' NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"created_by" text NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "tiffin_products_code_unique" UNIQUE("code"),
	CONSTRAINT "chk_tiffin_prod_category" CHECK ("category" IN ('STANDARD_MEAL', 'SUBSCRIPTION_PACKAGE', 'EXTRA', 'BEVERAGE', 'SPECIAL')),
	CONSTRAINT "chk_tiffin_prod_unit" CHECK ("billing_unit" IN ('PER_MEAL', 'PER_DAY', 'PER_MONTH', 'PER_PIECE', 'PER_PORTION')),
	CONSTRAINT "chk_tiffin_prod_price" CHECK ("price" >= 0),
	CONSTRAINT "chk_tiffin_prod_status" CHECK ("status" IN ('ACTIVE', 'INACTIVE'))
);
--> statement-breakpoint

ALTER TABLE "tiffin_products" ADD CONSTRAINT "tiffin_products_created_by_staff_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."staff_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint

CREATE UNIQUE INDEX "idx_tiffin_prod_code" ON "tiffin_products" USING btree ("code");--> statement-breakpoint
CREATE INDEX "idx_tiffin_prod_category" ON "tiffin_products" USING btree ("category");--> statement-breakpoint
CREATE INDEX "idx_tiffin_prod_status" ON "tiffin_products" USING btree ("status");
