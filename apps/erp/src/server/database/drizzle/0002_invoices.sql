ALTER TABLE "financial_transactions" ADD COLUMN "invoice_id" text;--> statement-breakpoint
CREATE INDEX "idx_fin_tx_invoice" ON "financial_transactions" USING btree ("invoice_id");--> statement-breakpoint

CREATE TABLE "invoice_counters" (
	"year" integer PRIMARY KEY NOT NULL,
	"last_number" integer DEFAULT 0 NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint

CREATE TABLE "invoices" (
	"id" text PRIMARY KEY NOT NULL,
	"invoice_number" text,
	"invoice_type" text NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"resident_id" text NOT NULL,
	"stay_id" text,
	"issue_date" text NOT NULL,
	"due_date" text NOT NULL,
	"billing_period" text NOT NULL,
	"subtotal" integer DEFAULT 0 NOT NULL,
	"cgst_amount" integer DEFAULT 0 NOT NULL,
	"sgst_amount" integer DEFAULT 0 NOT NULL,
	"igst_amount" integer DEFAULT 0 NOT NULL,
	"total_tax" integer DEFAULT 0 NOT NULL,
	"total_amount" integer DEFAULT 0 NOT NULL,
	"amount_paid" integer DEFAULT 0 NOT NULL,
	"balance_due" integer DEFAULT 0 NOT NULL,
	"company_name" text NOT NULL,
	"company_address" text NOT NULL,
	"company_gstin" text,
	"company_state_code" text DEFAULT '06' NOT NULL,
	"recipient_name" text NOT NULL,
	"recipient_phone" text NOT NULL,
	"recipient_email" text,
	"recipient_address" text,
	"recipient_gstin" text,
	"recipient_state_code" text DEFAULT '06' NOT NULL,
	"rent_charge_id" text,
	"notes" text,
	"cancelled_at" text,
	"cancellation_reason" text,
	"created_by" text NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "invoices_invoice_number_unique" UNIQUE("invoice_number"),
	CONSTRAINT "chk_invoices_type" CHECK ("invoice_type" IN ('REGULAR_BILL', 'GST_TAX_INVOICE')),
	CONSTRAINT "chk_invoices_status" CHECK ("status" IN ('DRAFT', 'ISSUED', 'PARTIALLY_PAID', 'PAID', 'CANCELLED')),
	CONSTRAINT "chk_invoices_subtotal" CHECK ("subtotal" >= 0),
	CONSTRAINT "chk_invoices_cgst" CHECK ("cgst_amount" >= 0),
	CONSTRAINT "chk_invoices_sgst" CHECK ("sgst_amount" >= 0),
	CONSTRAINT "chk_invoices_igst" CHECK ("igst_amount" >= 0),
	CONSTRAINT "chk_invoices_total_tax" CHECK ("total_tax" >= 0),
	CONSTRAINT "chk_invoices_total_amount" CHECK ("total_amount" >= 0),
	CONSTRAINT "chk_invoices_amount_paid" CHECK ("amount_paid" >= 0),
	CONSTRAINT "chk_invoices_balance_due" CHECK ("balance_due" >= 0)
);
--> statement-breakpoint

ALTER TABLE "invoices" ADD CONSTRAINT "invoices_resident_id_residents_id_fk" FOREIGN KEY ("resident_id") REFERENCES "public"."residents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_stay_id_resident_stays_id_fk" FOREIGN KEY ("stay_id") REFERENCES "public"."resident_stays"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_rent_charge_id_financial_transactions_id_fk" FOREIGN KEY ("rent_charge_id") REFERENCES "public"."financial_transactions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_created_by_staff_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."staff_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint

CREATE UNIQUE INDEX "idx_invoices_number" ON "invoices" USING btree ("invoice_number");--> statement-breakpoint
CREATE INDEX "idx_invoices_resident" ON "invoices" USING btree ("resident_id");--> statement-breakpoint
CREATE INDEX "idx_invoices_stay" ON "invoices" USING btree ("stay_id");--> statement-breakpoint
CREATE INDEX "idx_invoices_status" ON "invoices" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_invoices_issue_date" ON "invoices" USING btree ("issue_date");--> statement-breakpoint
CREATE INDEX "idx_invoices_billing_period" ON "invoices" USING btree ("billing_period");--> statement-breakpoint

CREATE TABLE "invoice_items" (
	"id" text PRIMARY KEY NOT NULL,
	"invoice_id" text NOT NULL,
	"description" text NOT NULL,
	"sac_hsn_code" text,
	"quantity" integer DEFAULT 1 NOT NULL,
	"unit_price" integer NOT NULL,
	"amount" integer NOT NULL,
	"tax_rate" integer DEFAULT 0 NOT NULL,
	"cgst_rate" integer DEFAULT 0 NOT NULL,
	"sgst_rate" integer DEFAULT 0 NOT NULL,
	"igst_rate" integer DEFAULT 0 NOT NULL,
	"cgst_amount" integer DEFAULT 0 NOT NULL,
	"sgst_amount" integer DEFAULT 0 NOT NULL,
	"igst_amount" integer DEFAULT 0 NOT NULL,
	"total_item_amount" integer NOT NULL,
	"created_at" text NOT NULL,
	CONSTRAINT "chk_invoice_items_qty" CHECK ("quantity" > 0),
	CONSTRAINT "chk_invoice_items_unit_price" CHECK ("unit_price" >= 0),
	CONSTRAINT "chk_invoice_items_amount" CHECK ("amount" >= 0),
	CONSTRAINT "chk_invoice_items_tax_rate" CHECK ("tax_rate" >= 0),
	CONSTRAINT "chk_invoice_items_total" CHECK ("total_item_amount" >= 0)
);
--> statement-breakpoint

ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_invoice_items_invoice" ON "invoice_items" USING btree ("invoice_id");--> statement-breakpoint

CREATE TABLE "invoice_payment_allocations" (
	"id" text PRIMARY KEY NOT NULL,
	"invoice_id" text NOT NULL,
	"payment_transaction_id" text NOT NULL,
	"amount" integer NOT NULL,
	"allocated_at" text NOT NULL,
	"allocated_by" text NOT NULL,
	"notes" text,
	"created_at" text NOT NULL,
	CONSTRAINT "chk_inv_alloc_amount" CHECK ("amount" > 0)
);
--> statement-breakpoint

ALTER TABLE "invoice_payment_allocations" ADD CONSTRAINT "invoice_payment_allocations_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_payment_allocations" ADD CONSTRAINT "invoice_payment_allocations_payment_transaction_id_financial_transactions_id_fk" FOREIGN KEY ("payment_transaction_id") REFERENCES "public"."financial_transactions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_payment_allocations" ADD CONSTRAINT "invoice_payment_allocations_allocated_by_staff_users_id_fk" FOREIGN KEY ("allocated_by") REFERENCES "public"."staff_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint

CREATE INDEX "idx_inv_alloc_invoice" ON "invoice_payment_allocations" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "idx_inv_alloc_payment" ON "invoice_payment_allocations" USING btree ("payment_transaction_id");
