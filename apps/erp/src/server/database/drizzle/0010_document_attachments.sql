-- Task 01B.57: Secure Resident KYC & Financial Document Management
-- Migration 0010: Create document_attachments table and indexes

CREATE TABLE IF NOT EXISTS "document_attachments" (
  "id" text PRIMARY KEY NOT NULL,
  "category" text NOT NULL,
  "resident_id" text REFERENCES "residents"("id") ON DELETE restrict,
  "stay_id" text REFERENCES "resident_stays"("id") ON DELETE set null,
  "transaction_id" text REFERENCES "financial_transactions"("id") ON DELETE set null,
  "invoice_id" text REFERENCES "invoices"("id") ON DELETE set null,
  "settlement_id" text REFERENCES "resident_settlements"("id") ON DELETE set null,
  "display_filename" text NOT NULL,
  "mime_type" text NOT NULL,
  "file_size" integer NOT NULL,
  "file_hash" text NOT NULL,
  "storage_path" text NOT NULL,
  "status" text DEFAULT 'ACTIVE' NOT NULL,
  "superseded_by" text,
  "notes" text,
  "uploaded_by" text NOT NULL REFERENCES "staff_users"("id") ON DELETE restrict,
  "created_at" text NOT NULL,
  "updated_at" text NOT NULL,
  CONSTRAINT "chk_doc_category" CHECK ("category" IN ('RESIDENT_KYC', 'RESIDENT_ADDRESS_PROOF', 'RENT_RECEIPT', 'SECURITY_DEPOSIT_RECEIPT', 'CHECKOUT_SETTLEMENT_RECEIPT', 'EXPENSE_RECEIPT', 'OPERATIONAL_ATTACHMENT')),
  CONSTRAINT "chk_doc_status" CHECK ("status" IN ('ACTIVE', 'SUPERSEDED', 'ARCHIVED')),
  CONSTRAINT "chk_doc_file_size" CHECK ("file_size" > 0 AND "file_size" <= 5242880)
);

CREATE INDEX IF NOT EXISTS "idx_docs_category" ON "document_attachments" ("category");
CREATE INDEX IF NOT EXISTS "idx_docs_resident" ON "document_attachments" ("resident_id");
CREATE INDEX IF NOT EXISTS "idx_docs_stay" ON "document_attachments" ("stay_id");
CREATE INDEX IF NOT EXISTS "idx_docs_tx" ON "document_attachments" ("transaction_id");
CREATE INDEX IF NOT EXISTS "idx_docs_invoice" ON "document_attachments" ("invoice_id");
CREATE INDEX IF NOT EXISTS "idx_docs_settlement" ON "document_attachments" ("settlement_id");
CREATE INDEX IF NOT EXISTS "idx_docs_status" ON "document_attachments" ("status");
