import Database from "better-sqlite3";
import crypto from "crypto";
import path from "path";
import fs from "fs";

import { runMigrations } from "./helpers/sqliteMigrations";
import { closeDb, getAsyncDb, AsyncDb } from "../apps/erp/src/server/database/db";
import {
  requirePermission,
  AuthorizationError,
} from "../apps/erp/src/server/authorization/authorize";
import {
  normalizePhoneNumber,
  listTiffinCustomers,
  getTiffinCustomerById,
  findPotentialDuplicateCustomers,
  createTiffinCustomer,
  updateTiffinCustomer,
  setTiffinCustomerStatus,
  listTiffinProducts,
  getTiffinProductById,
  getTiffinProductByCode,
  createTiffinProduct,
  updateTiffinProduct,
  setTiffinProductStatus,
  INITIAL_TIFFIN_CATALOG,
  seedDefaultCatalogIfEmpty,
  createTiffinSubscription,
  getTiffinSubscriptionById,
  listTiffinSubscriptions,
  updateTiffinSubscription,
  pauseTiffinSubscription,
  resumeTiffinSubscription,
  cancelTiffinSubscription,
  getCustomerSubscriptions,
} from "../apps/erp/src/server/tiffin/tiffinService";
import {
  previewTiffinBilling,
  generateTiffinInvoices,
  recordTiffinPayment,
  getTiffinCustomerBalance,
  getUnallocatedPaymentsForCustomer,
} from "../apps/erp/src/server/tiffin/tiffinBillingService";
import {
  getInvoiceById,
  cancelInvoice,
  allocatePaymentToInvoice,
} from "../apps/erp/src/server/finance/invoiceService";
import { AuthenticatedUser } from "../apps/erp/src/types";

// Primary database path for zero-modification guard
const primaryDbPath = path.resolve(__dirname, "../data/erp.db");
const primaryStatsBefore = fs.existsSync(primaryDbPath) ? fs.statSync(primaryDbPath) : null;

// Isolated test database path
const TEST_TIFFIN_DB_PATH = path.resolve(__dirname, "test_tiffin.db");

function cleanupTestDb() {
  closeDb();
  if (fs.existsSync(TEST_TIFFIN_DB_PATH)) fs.unlinkSync(TEST_TIFFIN_DB_PATH);
  const wal = `${TEST_TIFFIN_DB_PATH}-wal`;
  const shm = `${TEST_TIFFIN_DB_PATH}-shm`;
  if (fs.existsSync(wal)) fs.unlinkSync(wal);
  if (fs.existsSync(shm)) fs.unlinkSync(shm);
}
cleanupTestDb();

// Point process environment to isolated test DB
process.env.ERP_DATABASE_PATH = TEST_TIFFIN_DB_PATH;

let passCount = 0;
let failCount = 0;

function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`  ✓ PASS: ${message}`);
    passCount++;
  } else {
    console.error(`  ✗ FAIL: ${message}`);
    failCount++;
  }
}

console.log("================================================================================");
console.log("RAVINARAYAN ERP — TIFFIN DIRECTORY & PRICING CATALOG TEST SUITE (Task 01B.43)");
console.log("================================================================================\n");

async function runTiffinTests() {
  // Test actors
  const superAdminUser: AuthenticatedUser = {
    id: "usr_superadmin",
    username: "superadmin",
    fullName: "Super Admin",
    role: "SUPER_ADMIN",
    email: "superadmin@ravinarayan.com",
  };

  const opsManagerUser: AuthenticatedUser = {
    id: "usr_opsmgr",
    username: "opsmgr",
    fullName: "Ops Manager",
    role: "OPERATIONS_MANAGER",
    email: "ops@ravinarayan.com",
  };

  const kitchenHeadUser: AuthenticatedUser = {
    id: "usr_kitchen",
    username: "kitchen",
    fullName: "Kitchen Head",
    role: "KITCHEN_OPERATIONS",
    email: "kitchen@ravinarayan.com",
  };

  const accountantUser: AuthenticatedUser = {
    id: "usr_accountant",
    username: "accountant",
    fullName: "Accountant",
    role: "ACCOUNTANT",
    email: "accounts@ravinarayan.com",
  };

  const deliveryPersonUser: AuthenticatedUser = {
    id: "usr_delivery",
    username: "delivery",
    fullName: "Delivery Person",
    role: "DELIVERY_PERSON",
    email: "delivery@ravinarayan.com",
  };

  // --------------------------------------------------------------------------
  // SECTION 1: DATABASE SCHEMA & MIGRATION VERIFICATION
  // --------------------------------------------------------------------------
  console.log("--- Section 1: Database Schema & Migration Verification ---");

  const rawDb = new Database(TEST_TIFFIN_DB_PATH);
  runMigrations(rawDb);
  const userVersion = rawDb.pragma("user_version", { simple: true }) as number;
  assert(userVersion >= 13, `Migration V13 applied successfully (current user_version: ${userVersion})`);

  // Verify tiffin_customers table structure
  const custTable = rawDb.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='tiffin_customers'").get();
  assert(Boolean(custTable), "Table 'tiffin_customers' exists in test database");

  const custColumns = (rawDb.prepare("PRAGMA table_info(tiffin_customers)").all() as any[]).map((c) => c.name);
  assert(custColumns.includes("id"), "tiffin_customers has 'id' column");
  assert(custColumns.includes("full_name"), "tiffin_customers has 'full_name' column");
  assert(custColumns.includes("phone"), "tiffin_customers has 'phone' column");
  assert(custColumns.includes("alternate_phone"), "tiffin_customers has 'alternate_phone' column");
  assert(custColumns.includes("delivery_address"), "tiffin_customers has 'delivery_address' column");
  assert(custColumns.includes("landmark"), "tiffin_customers has 'landmark' column");
  assert(custColumns.includes("customer_type"), "tiffin_customers has 'customer_type' column");
  assert(custColumns.includes("dietary_preference"), "tiffin_customers has 'dietary_preference' column");
  assert(custColumns.includes("status"), "tiffin_customers has 'status' column");

  // Verify tiffin_products table structure
  const prodTable = rawDb.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='tiffin_products'").get();
  assert(Boolean(prodTable), "Table 'tiffin_products' exists in test database");

  const prodColumns = (rawDb.prepare("PRAGMA table_info(tiffin_products)").all() as any[]).map((c) => c.name);
  assert(prodColumns.includes("id"), "tiffin_products has 'id' column");
  assert(prodColumns.includes("code"), "tiffin_products has 'code' column");
  assert(prodColumns.includes("name"), "tiffin_products has 'name' column");
  assert(prodColumns.includes("category"), "tiffin_products has 'category' column");
  assert(prodColumns.includes("billing_unit"), "tiffin_products has 'billing_unit' column");
  assert(prodColumns.includes("price"), "tiffin_products has 'price' column");
  assert(prodColumns.includes("currency"), "tiffin_products has 'currency' column");
  assert(prodColumns.includes("status"), "tiffin_products has 'status' column");

  // Verify tiffin_subscriptions table structure (Task 01B.44)
  const subsTable = rawDb.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='tiffin_subscriptions'").get();
  assert(Boolean(subsTable), "Table 'tiffin_subscriptions' exists in test database");

  const subsColumns = (rawDb.prepare("PRAGMA table_info(tiffin_subscriptions)").all() as any[]).map((c) => c.name);
  assert(subsColumns.includes("id"), "tiffin_subscriptions has 'id' column");
  assert(subsColumns.includes("customer_id"), "tiffin_subscriptions has 'customer_id' column");
  assert(subsColumns.includes("product_id"), "tiffin_subscriptions has 'product_id' column");
  assert(subsColumns.includes("status"), "tiffin_subscriptions has 'status' column");
  assert(subsColumns.includes("start_date"), "tiffin_subscriptions has 'start_date' column");
  assert(subsColumns.includes("end_date"), "tiffin_subscriptions has 'end_date' column");
  assert(subsColumns.includes("price"), "tiffin_subscriptions has 'price' column");
  assert(subsColumns.includes("currency"), "tiffin_subscriptions has 'currency' column");
  assert(subsColumns.includes("meal_types"), "tiffin_subscriptions has 'meal_types' column");
  assert(subsColumns.includes("service_days"), "tiffin_subscriptions has 'service_days' column");
  assert(subsColumns.includes("quantity_per_meal"), "tiffin_subscriptions has 'quantity_per_meal' column");
  assert(subsColumns.includes("pause_start_date"), "tiffin_subscriptions has 'pause_start_date' column");
  assert(subsColumns.includes("pause_resume_date"), "tiffin_subscriptions has 'pause_resume_date' column");
  assert(subsColumns.includes("pause_reason"), "tiffin_subscriptions has 'pause_reason' column");
  assert(subsColumns.includes("cancelled_at"), "tiffin_subscriptions has 'cancelled_at' column");
  assert(subsColumns.includes("cancellation_reason"), "tiffin_subscriptions has 'cancellation_reason' column");
  assert(subsColumns.includes("cancelled_by"), "tiffin_subscriptions has 'cancelled_by' column");
  assert(subsColumns.includes("delivery_address"), "tiffin_subscriptions has 'delivery_address' column");
  assert(subsColumns.includes("delivery_instructions"), "tiffin_subscriptions has 'delivery_instructions' column");
  assert(subsColumns.includes("notes"), "tiffin_subscriptions has 'notes' column");
  assert(subsColumns.includes("created_by"), "tiffin_subscriptions has 'created_by' column");
  assert(subsColumns.includes("updated_by"), "tiffin_subscriptions has 'updated_by' column");
  assert(subsColumns.includes("created_at"), "tiffin_subscriptions has 'created_at' column");
  assert(subsColumns.includes("updated_at"), "tiffin_subscriptions has 'updated_at' column");

  // Verify indices
  const indices = (rawDb.prepare("SELECT name FROM sqlite_master WHERE type='index'").all() as any[]).map((i) => i.name);
  assert(indices.includes("idx_tiffin_cust_phone"), "Index 'idx_tiffin_cust_phone' exists");
  assert(indices.includes("idx_tiffin_cust_status"), "Index 'idx_tiffin_cust_status' exists");
  assert(indices.includes("idx_tiffin_cust_name"), "Index 'idx_tiffin_cust_name' exists");
  assert(indices.includes("idx_tiffin_prod_code"), "Index 'idx_tiffin_prod_code' exists");
  assert(indices.includes("idx_tiffin_prod_category"), "Index 'idx_tiffin_prod_category' exists");
  assert(indices.includes("idx_tiffin_prod_status"), "Index 'idx_tiffin_prod_status' exists");
  assert(indices.includes("idx_tiffin_sub_customer"), "Index 'idx_tiffin_sub_customer' exists");
  assert(indices.includes("idx_tiffin_sub_product"), "Index 'idx_tiffin_sub_product' exists");
  assert(indices.includes("idx_tiffin_sub_status"), "Index 'idx_tiffin_sub_status' exists");
  assert(indices.includes("idx_tiffin_sub_start_date"), "Index 'idx_tiffin_sub_start_date' exists");

  // Insert mock actors for audit log FK reference
  rawDb.prepare(`
    INSERT OR IGNORE INTO staff_users (id, username, email, full_name, password_hash, role, is_active, created_at, updated_at)
    VALUES 
      ('usr_superadmin', 'superadmin', 'superadmin@ravinarayan.com', 'Super Admin', 'hash', 'SUPER_ADMIN', 1, datetime('now'), datetime('now')),
      ('usr_opsmgr', 'opsmgr', 'ops@ravinarayan.com', 'Ops Manager', 'hash', 'OPERATIONS_MANAGER', 1, datetime('now'), datetime('now')),
      ('usr_kitchen', 'kitchen', 'kitchen@ravinarayan.com', 'Kitchen Head', 'hash', 'KITCHEN_OPERATIONS', 1, datetime('now'), datetime('now')),
      ('usr_accountant', 'accountant', 'accounts@ravinarayan.com', 'Accountant', 'hash', 'ACCOUNTANT', 1, datetime('now'), datetime('now')),
      ('usr_delivery', 'delivery', 'delivery@ravinarayan.com', 'Delivery Person', 'hash', 'DELIVERY_PERSON', 1, datetime('now'), datetime('now'))
  `).run();
  rawDb.close();

  const db = getAsyncDb();

  // --------------------------------------------------------------------------
  // SECTION 2: PHONE NORMALIZATION & VALIDATION
  // --------------------------------------------------------------------------
  console.log("\n--- Section 2: Phone Normalization & Validation ---");

  assert(normalizePhoneNumber("9876543210") === "9876543210", "Standard 10-digit phone normalized cleanly");
  assert(normalizePhoneNumber("+91 98765 43210") === "9876543210", "+91 with spaces normalized to 10 digits");
  assert(normalizePhoneNumber("91-9876543210") === "9876543210", "91- prefix with hyphen normalized to 10 digits");
  assert(normalizePhoneNumber("09876543210") === "9876543210", "Leading 0 prefix normalized to 10 digits");
  assert(normalizePhoneNumber("(98765) 43210") === "9876543210", "Parentheses and spaces normalized cleanly");
  assert(normalizePhoneNumber("+14155552671") === "+14155552671", "International E.164 phone preserved with + prefix");

  let invalidPhoneCaught = false;
  try {
    normalizePhoneNumber("12345");
  } catch (err: any) {
    invalidPhoneCaught = true;
  }
  assert(invalidPhoneCaught, "Invalid short phone number rejected with validation error");

  let nonNumericPhoneCaught = false;
  try {
    normalizePhoneNumber("abcdefghij");
  } catch (err: any) {
    nonNumericPhoneCaught = true;
  }
  assert(nonNumericPhoneCaught, "Non-numeric phone string rejected with validation error");

  // --------------------------------------------------------------------------
  // SECTION 3: CUSTOMER CREATION & DUPLICATE PREVENTION WORKFLOW
  // --------------------------------------------------------------------------
  console.log("\n--- Section 3: Customer Creation & Duplicate Prevention Workflow ---");

  // Create first customer
  const customer1 = await createTiffinCustomer(
    superAdminUser,
    {
      fullName: "Ramesh Sharma",
      phone: "+91 98765 11111",
      alternatePhone: "098765 22222",
      deliveryAddress: "Flat 402, Sunshine Apartments, 5th Cross, Indiranagar",
      landmark: "Near BDA Complex",
      deliveryInstructions: "Leave with security if not answering call",
      customerType: "INDIVIDUAL",
      dietaryPreference: "VEG",
      notes: "Likes mild spice",
    },
    undefined,
    db
  );

  assert(Boolean(customer1.id), `Customer 1 created successfully with ID: ${customer1.id}`);
  assert(customer1.phone === "9876511111", "Customer 1 phone normalized to '9876511111'");
  assert(customer1.alternatePhone === "9876522222", "Customer 1 alternate phone normalized to '9876522222'");
  assert(customer1.status === "ACTIVE", "Customer 1 initial status is 'ACTIVE'");
  assert(customer1.dietaryPreference === "VEG", "Customer 1 dietary preference is 'VEG'");

  // Attempt duplicate customer creation with identical phone without confirmDuplicate
  let duplicateWarningTriggered = false;
  let duplicateErrorMessage = "";
  try {
    await createTiffinCustomer(
      opsManagerUser,
      {
        fullName: "Suresh Sharma", // Brother/roommate sharing phone
        phone: "9876511111",
        deliveryAddress: "Flat 402, Sunshine Apartments, Indiranagar",
        customerType: "INDIVIDUAL",
        dietaryPreference: "VEG",
      },
      undefined,
      db
    );
  } catch (err: any) {
    duplicateWarningTriggered = true;
    duplicateErrorMessage = err.message;
  }

  assert(duplicateWarningTriggered, "Duplicate phone number triggered duplicate prevention error");
  assert(
    duplicateErrorMessage.includes("POTENTIAL_DUPLICATE") && duplicateErrorMessage.includes("Ramesh Sharma"),
    `Duplicate warning message mentions existing customer: ${duplicateErrorMessage}`
  );

  // Confirm creation with confirmDuplicate: true
  const customer2 = await createTiffinCustomer(
    opsManagerUser,
    {
      fullName: "Suresh Sharma",
      phone: "9876511111",
      deliveryAddress: "Flat 402, Sunshine Apartments, Indiranagar",
      customerType: "INDIVIDUAL",
      dietaryPreference: "NON_VEG",
      confirmDuplicate: true,
    },
    undefined,
    db
  );

  assert(Boolean(customer2.id), `Customer 2 created with shared phone after confirmation: ${customer2.id}`);
  assert(customer2.id !== customer1.id, "Customer 2 has distinct ID from Customer 1");
  assert(customer2.dietaryPreference === "NON_VEG", "Customer 2 dietary preference set to 'NON_VEG'");

  // Create Corporate customer
  const corpCustomer = await createTiffinCustomer(
    superAdminUser,
    {
      fullName: "Acme Tech Solutions (Pantry)",
      phone: "9876533333",
      deliveryAddress: "Tower B, 3rd Floor, Tech Park, Outer Ring Road",
      landmark: "Opposite Metro Station",
      customerType: "CORPORATE",
      dietaryPreference: "VEG",
      notes: "Daily lunch delivery for 15 employees",
    },
    undefined,
    db
  );
  assert(corpCustomer.customerType === "CORPORATE", "Corporate customer created successfully");

  // Create PG Resident customer
  const pgCustomer = await createTiffinCustomer(
    opsManagerUser,
    {
      fullName: "Anand Verma",
      phone: "9876544444",
      deliveryAddress: "Room 204, Bed B, Ravi Narayana PG Main Wing",
      customerType: "RESIDENTIAL_PG",
      dietaryPreference: "JAIN",
      notes: "No onion, no garlic meal",
    },
    undefined,
    db
  );
  assert(pgCustomer.customerType === "RESIDENTIAL_PG", "PG Resident tiffin customer created successfully");
  assert(pgCustomer.dietaryPreference === "JAIN", "PG Resident dietary preference set to 'JAIN'");

  // --------------------------------------------------------------------------
  // SECTION 4: CUSTOMER DIRECTORY READ, FILTER & SEARCH
  // --------------------------------------------------------------------------
  console.log("\n--- Section 4: Customer Directory Read, Filter & Search ---");

  // List all
  const allCustomers = (await listTiffinCustomers(superAdminUser, {}, db)).customers;
  assert(allCustomers.length >= 4, `Listed ${allCustomers.length} total customers`);

  // Filter by customerType
  const corpList = (await listTiffinCustomers(superAdminUser, { customerType: "CORPORATE" }, db)).customers;
  assert(corpList.length === 1 && corpList[0].fullName.includes("Acme"), "Filter by customerType=CORPORATE returned Acme");

  const pgList = (await listTiffinCustomers(superAdminUser, { customerType: "RESIDENTIAL_PG" }, db)).customers;
  assert(pgList.length === 1 && pgList[0].fullName === "Anand Verma", "Filter by customerType=RESIDENTIAL_PG returned Anand");

  // Filter by dietaryPreference
  const jainList = (await listTiffinCustomers(superAdminUser, { dietaryPreference: "JAIN" }, db)).customers;
  assert(jainList.length === 1 && jainList[0].fullName === "Anand Verma", "Filter by dietaryPreference=JAIN works");

  // Search by query (name, phone, address)
  const searchByName = (await listTiffinCustomers(superAdminUser, { search: "Ramesh" }, db)).customers;
  assert(searchByName.length === 1 && searchByName[0].id === customer1.id, "Search by name 'Ramesh' returned correct record");

  const searchByPhone = (await listTiffinCustomers(superAdminUser, { search: "9876511111" }, db)).customers;
  assert(searchByPhone.length === 2, "Search by shared phone '9876511111' returned both brothers");

  const searchByAddress = (await listTiffinCustomers(superAdminUser, { search: "Outer Ring Road" }, db)).customers;
  assert(searchByAddress.length === 1 && searchByAddress[0].id === corpCustomer.id, "Search by address 'Outer Ring Road' returned corporate account");

  // Get by ID
  const fetchedCust1 = await getTiffinCustomerById(superAdminUser, customer1.id, db);
  assert(fetchedCust1 !== null && fetchedCust1.fullName === "Ramesh Sharma", "getTiffinCustomerById returned customer");

  // --------------------------------------------------------------------------
  // SECTION 5: CUSTOMER UPDATE & STATUS TRANSITIONS
  // --------------------------------------------------------------------------
  console.log("\n--- Section 5: Customer Update & Status Transitions ---");

  // Update customer fields
  const updatedCust1 = await updateTiffinCustomer(
    opsManagerUser,
    customer1.id,
    {
      deliveryAddress: "Flat 504, Sunshine Apartments, 5th Cross, Indiranagar",
      notes: "Moved to 5th floor flat. Call on arrival.",
      dietaryPreference: "NON_VEG",
    },
    undefined,
    db
  );

  assert(updatedCust1.deliveryAddress === "Flat 504, Sunshine Apartments, 5th Cross, Indiranagar", "Address updated correctly");
  assert(updatedCust1.dietaryPreference === "NON_VEG", "Dietary preference updated to NON_VEG");
  assert(updatedCust1.updatedBy === opsManagerUser.id, "updatedBy recorded correctly as opsManagerUser");

  // Deactivate customer
  const deactivatedCust = await setTiffinCustomerStatus(opsManagerUser, customer1.id, "INACTIVE", undefined, db);
  assert(deactivatedCust.status === "INACTIVE", "Customer status updated to 'INACTIVE'");

  // Reactivate customer
  const reactivatedCust = await setTiffinCustomerStatus(superAdminUser, customer1.id, "ACTIVE", undefined, db);
  assert(reactivatedCust.status === "ACTIVE", "Customer status reactivated to 'ACTIVE'");

  // --------------------------------------------------------------------------
  // SECTION 6: PRICING CATALOG SEEDER & INITIAL MENU
  // --------------------------------------------------------------------------
  console.log("\n--- Section 6: Pricing Catalog Seeder & Initial Menu ---");

  const seededCount = await seedDefaultCatalogIfEmpty(superAdminUser, db);
  assert(seededCount === INITIAL_TIFFIN_CATALOG.length, `Default catalog seeded ${seededCount} items`);

  // Idempotency check: seeding again should return 0
  const secondSeedCount = await seedDefaultCatalogIfEmpty(superAdminUser, db);
  assert(secondSeedCount === 0, "Second seed call is idempotent and inserted 0 items");

  // Verify baseline catalog products from PRD Section 5
  const dailyThali = await getTiffinProductByCode(superAdminUser, "TIF-DAILY", db);
  assert(dailyThali !== null && dailyThali.price === 80, "TIF-DAILY (Standard Thali) exists with price ₹80");
  assert(dailyThali?.billingUnit === "PER_MEAL", "TIF-DAILY billing unit is PER_MEAL");

  const monthlyBoth = await getTiffinProductByCode(superAdminUser, "TIF-MON-BOTH", db);
  assert(monthlyBoth !== null && monthlyBoth.price === 3500, "TIF-MON-BOTH exists with price ₹3,500");
  assert(monthlyBoth?.category === "SUBSCRIPTION_PACKAGE", "TIF-MON-BOTH category is SUBSCRIPTION_PACKAGE");
  assert(monthlyBoth?.billingUnit === "PER_MONTH", "TIF-MON-BOTH billing unit is PER_MONTH");

  const monthlySingle = await getTiffinProductByCode(superAdminUser, "TIF-MON-SINGLE", db);
  assert(monthlySingle !== null && monthlySingle.price === 2000, "TIF-MON-SINGLE exists with price ₹2,000");

  const fridayBowl = await getTiffinProductByCode(superAdminUser, "TIF-FRI-BOWL", db);
  assert(fridayBowl !== null && fridayBowl.price === 60, "TIF-FRI-BOWL exists with price ₹60");

  const extraRoti = await getTiffinProductByCode(superAdminUser, "EXT-ROTI", db);
  assert(extraRoti !== null && extraRoti.price === 8, "EXT-ROTI exists with price ₹8");

  const lassi = await getTiffinProductByCode(superAdminUser, "EXT-LASSI", db);
  assert(lassi !== null && lassi.price === 50, "EXT-LASSI exists with price ₹50");
  assert(lassi?.category === "BEVERAGE", "EXT-LASSI category is BEVERAGE");

  // --------------------------------------------------------------------------
  // SECTION 7: PRICING CATALOG CRUD & PRICE INTEGRITY
  // --------------------------------------------------------------------------
  console.log("\n--- Section 7: Pricing Catalog CRUD & Price Integrity ---");

  // Create custom special product
  const customProduct = await createTiffinProduct(
    superAdminUser,
    {
      code: "TIF-SWEET-SPL",
      name: "Gulab Jamun (2 pcs)",
      description: "Warm homemade gulab jamun in cardamom syrup",
      category: "SPECIAL",
      billingUnit: "PER_PORTION",
      price: 50,
    },
    undefined,
    db
  );

  assert(customProduct.code === "TIF-SWEET-SPL", "Custom product TIF-SWEET-SPL created");
  assert(customProduct.price === 50, "Custom product price is ₹50");
  assert(customProduct.status === "ACTIVE", "Custom product status is ACTIVE");

  // Attempt duplicate product code
  let duplicateCodeCaught = false;
  try {
    await createTiffinProduct(
      superAdminUser,
      {
        code: "TIF-SWEET-SPL",
        name: "Duplicate Sweet",
        category: "SPECIAL",
        billingUnit: "PER_PORTION",
        price: 60,
      },
      undefined,
      db
    );
  } catch (err: any) {
    duplicateCodeCaught = true;
  }
  assert(duplicateCodeCaught, "Duplicate product code rejected with error");

  // Attempt negative price
  let negativePriceCaught = false;
  try {
    await createTiffinProduct(
      superAdminUser,
      {
        code: "TIF-BAD-PRICE",
        name: "Bad Price",
        category: "EXTRA",
        billingUnit: "PER_PORTION",
        price: -25,
      },
      undefined,
      db
    );
  } catch (err: any) {
    negativePriceCaught = true;
  }
  assert(negativePriceCaught, "Negative product price rejected with validation error");

  // Update product price & description
  const updatedProduct = await updateTiffinProduct(
    opsManagerUser,
    customProduct.id,
    {
      name: "Gulab Jamun with Rabdi (2 pcs)",
      price: 65,
    },
    undefined,
    db
  );
  assert(updatedProduct.price === 65, "Product price updated to ₹65");
  assert(updatedProduct.name.includes("Rabdi"), "Product name updated");

  // Deactivate product
  const deactivatedProd = await setTiffinProductStatus(opsManagerUser, customProduct.id, "INACTIVE", undefined, db);
  assert(deactivatedProd.status === "INACTIVE", "Product status updated to INACTIVE");

  // Reactivate product
  const reactivatedProd = await setTiffinProductStatus(superAdminUser, customProduct.id, "ACTIVE", undefined, db);
  assert(reactivatedProd.status === "ACTIVE", "Product status reactivated to ACTIVE");

  // List products with category filter
  const beverageProducts = await listTiffinProducts(superAdminUser, { category: "BEVERAGE" }, db);
  assert(beverageProducts.length >= 2, `Listed ${beverageProducts.length} beverage products`);

  // --------------------------------------------------------------------------
  // SECTION 8: SUBSCRIPTION MANAGEMENT & SERVICE SCHEDULING (Task 01B.44)
  // --------------------------------------------------------------------------
  console.log("\n--- Section 8: Subscription Management & Service Scheduling ---");

  // Get test product TIF-MON-BOTH and customers
  const monthlyPkg = await getTiffinProductByCode(superAdminUser, "TIF-MON-BOTH", db);
  assert(Boolean(monthlyPkg), "Retrieved TIF-MON-BOTH product for subscription testing");

  const todayStr = new Date().toISOString().slice(0, 10);
  const nextMonthDate = new Date();
  nextMonthDate.setMonth(nextMonthDate.getMonth() + 1);
  const nextMonthStr = nextMonthDate.toISOString().slice(0, 10);

  // 8.1 Create standard subscription with snapshot price
  const sub1 = await createTiffinSubscription(
    opsManagerUser,
    {
      customerId: customer1.id,
      productId: monthlyPkg!.id,
      startDate: todayStr,
      endDate: nextMonthStr,
      mealTypes: "BOTH",
      serviceDays: "ALL_DAYS",
      quantityPerMeal: 1,
      deliveryAddress: "Flat 401, Green Glen Layout, Bellandur",
      deliveryInstructions: "Leave with security if not answering",
      notes: "Preferred mild spice",
    },
    undefined,
    db
  );

  assert(Boolean(sub1.id), `Subscription created with ID: ${sub1.id}`);
  assert(sub1.status === "ACTIVE", "Subscription initial status is ACTIVE");
  assert(sub1.price === 3500, `Agreed snapshot price is ₹3,500 (matches catalog: ${sub1.price})`);
  assert(sub1.mealTypes === "BOTH", "Meal types is BOTH");
  assert(sub1.serviceDays === "ALL_DAYS", "Service days is ALL_DAYS");
  assert(sub1.quantityPerMeal === 1, "Quantity per meal is 1");
  assert(sub1.customerId === customer1.id, "Customer ID matches");
  assert(sub1.productId === monthlyPkg!.id, "Product ID matches");
  assert(sub1.customerName === customer1.fullName, "Customer name resolved in subscription view");

  // 8.2 Price Snapshot Immutability Verification
  // Update catalog price of TIF-MON-BOTH from 3500 to 3900
  await updateTiffinProduct(
    superAdminUser,
    monthlyPkg!.id,
    { price: 3900 },
    undefined,
    db
  );
  const reloadedCatalogPkg = await getTiffinProductById(superAdminUser, monthlyPkg!.id, db);
  assert(reloadedCatalogPkg?.price === 3900, "Catalog price of TIF-MON-BOTH updated to ₹3,900");

  const sub1Reloaded = await getTiffinSubscriptionById(superAdminUser, sub1.id, db);
  assert(
    sub1Reloaded?.price === 3500,
    `Existing subscription price remained ₹3,500 despite catalog price increase (immutability preserved)`
  );

  // Restore catalog price
  await updateTiffinProduct(superAdminUser, monthlyPkg!.id, { price: 3500 }, undefined, db);

  // 8.3 Input Validations & Integrity Guards
  // a) End date before start date rejection
  let invalidDateRejected = false;
  try {
    await createTiffinSubscription(
      opsManagerUser,
      {
        customerId: customer1.id,
        productId: monthlyPkg!.id,
        startDate: "2026-12-01",
        endDate: "2026-11-01",
        mealTypes: "BOTH",
        serviceDays: "ALL_DAYS",
        quantityPerMeal: 1,
        deliveryAddress: "Some Address",
      },
      undefined,
      db
    );
  } catch (err: any) {
    if (err.message?.includes("cannot be earlier than start date")) {
      invalidDateRejected = true;
    }
  }
  assert(invalidDateRejected, "Subscription with endDate earlier than startDate rejected");

  // b) Inactive customer rejection
  // Deactivate customer 2 temporarily
  await setTiffinCustomerStatus(superAdminUser, customer2.id, "INACTIVE", undefined, db);
  let inactiveCustRejected = false;
  try {
    await createTiffinSubscription(
      opsManagerUser,
      {
        customerId: customer2.id,
        productId: monthlyPkg!.id,
        startDate: todayStr,
        mealTypes: "LUNCH",
        serviceDays: "MON_FRI",
        quantityPerMeal: 1,
        deliveryAddress: "Address",
      },
      undefined,
      db
    );
  } catch (err: any) {
    if (err.message?.includes("inactive") || err.message?.includes("not found")) {
      inactiveCustRejected = true;
    }
  }
  assert(inactiveCustRejected, "Subscription for inactive customer rejected");
  // Reactivate customer 2
  await setTiffinCustomerStatus(superAdminUser, customer2.id, "ACTIVE", undefined, db);

  // c) Custom agreed price support (Corporate discount)
  const corporateCust = (await listTiffinCustomers(superAdminUser, { customerType: "CORPORATE" }, db)).customers[0];
  const subCorporate = await createTiffinSubscription(
    opsManagerUser,
    {
      customerId: corporateCust.id,
      productId: monthlyPkg!.id,
      startDate: todayStr,
      mealTypes: "LUNCH",
      serviceDays: "MON_FRI",
      quantityPerMeal: 5,
      customPrice: 3000, // Negotiated corporate rate
      deliveryAddress: corporateCust.deliveryAddress,
    },
    undefined,
    db
  );
  assert(subCorporate.price === 3000, `Custom agreed rate of ₹3,000 applied for corporate customer`);
  assert(subCorporate.quantityPerMeal === 5, "Corporate quantity is 5 per meal");

  // 8.4 Subscription Listing & Filtering
  const allSubs = (await listTiffinSubscriptions(superAdminUser, {}, db)).subscriptions;
  assert(allSubs.length >= 2, `Listed ${allSubs.length} subscriptions`);

  const filteredByCustomer = (await listTiffinSubscriptions(superAdminUser, { customerId: customer1.id }, db)).subscriptions;
  assert(filteredByCustomer.length === 1 && filteredByCustomer[0].id === sub1.id, "Filter by customerId works");

  const filteredByStatus = (await listTiffinSubscriptions(superAdminUser, { status: "ACTIVE" }, db)).subscriptions;
  assert(filteredByStatus.length >= 2, "Filter by status='ACTIVE' works");

  const filteredByMeal = (await listTiffinSubscriptions(superAdminUser, { mealTypes: "LUNCH" }, db)).subscriptions;
  assert(filteredByMeal.some((s) => s.id === subCorporate.id), "Filter by mealTypes='LUNCH' works");

  const filteredByDays = (await listTiffinSubscriptions(superAdminUser, { serviceDays: "MON_FRI" }, db)).subscriptions;
  assert(filteredByDays.some((s) => s.id === subCorporate.id), "Filter by serviceDays='MON_FRI' works");

  const searchedSubs = (await listTiffinSubscriptions(superAdminUser, { search: "Bellandur" }, db)).subscriptions;
  assert(searchedSubs.some((s) => s.id === sub1.id), "Search subscription by address text works");

  const cust1Subs = await getCustomerSubscriptions(superAdminUser, customer1.id, db);
  assert(cust1Subs.length === 1, "getCustomerSubscriptions returned customer subscriptions");

  // 8.5 Update Subscription
  const updatedSub1 = await updateTiffinSubscription(
    opsManagerUser,
    sub1.id,
    {
      quantityPerMeal: 2,
      mealTypes: "LUNCH",
      serviceDays: "MON_SAT",
      notes: "Updated schedule to Mon-Sat lunch only, 2 boxes",
    },
    undefined,
    db
  );
  assert(updatedSub1.quantityPerMeal === 2, "Updated quantityPerMeal to 2");
  assert(updatedSub1.mealTypes === "LUNCH", "Updated mealTypes to LUNCH");
  assert(updatedSub1.serviceDays === "MON_SAT", "Updated serviceDays to MON_SAT");

  // 8.6 Pause Subscription Lifecycle
  const pauseDate = new Date();
  pauseDate.setDate(pauseDate.getDate() + 2);
  const pauseStartStr = pauseDate.toISOString().slice(0, 10);
  pauseDate.setDate(pauseDate.getDate() + 5);
  const pauseResumeStr = pauseDate.toISOString().slice(0, 10);

  // Pause sub1
  const pausedSub1 = await pauseTiffinSubscription(
    opsManagerUser,
    sub1.id,
    {
      pauseStartDate: pauseStartStr,
      pauseResumeDate: pauseResumeStr,
      pauseReason: "Out of town on family vacation",
    },
    undefined,
    db
  );
  assert(pausedSub1.status === "PAUSED", "Subscription status transitioned to PAUSED");
  assert(pausedSub1.pauseStartDate === pauseStartStr, `Pause start date set to ${pauseStartStr}`);
  assert(pausedSub1.pauseResumeDate === pauseResumeStr, `Pause resume date set to ${pauseResumeStr}`);
  assert(pausedSub1.pauseReason === "Out of town on family vacation", "Pause reason recorded");

  // Attempt to pause already paused subscription
  let duplicatePauseBlocked = false;
  try {
    await pauseTiffinSubscription(
      opsManagerUser,
      sub1.id,
      { pauseStartDate: pauseStartStr },
      undefined,
      db
    );
  } catch (err: any) {
    if (err.message?.includes("Only ACTIVE subscriptions can be paused")) {
      duplicatePauseBlocked = true;
    }
  }
  assert(duplicatePauseBlocked, "Cannot pause an already paused subscription");

  // 8.7 Resume Subscription Lifecycle
  const resumedSub1 = await resumeTiffinSubscription(opsManagerUser, sub1.id, undefined, db);
  assert(resumedSub1.status === "ACTIVE", "Subscription status transitioned back to ACTIVE");
  assert(resumedSub1.pauseStartDate === null, "Pause start date cleared on resume");
  assert(resumedSub1.pauseResumeDate === null, "Pause resume date cleared on resume");

  // Attempt to resume already active subscription
  let duplicateResumeBlocked = false;
  try {
    await resumeTiffinSubscription(opsManagerUser, sub1.id, undefined, db);
  } catch (err: any) {
    if (err.message?.includes("Only PAUSED subscriptions can be resumed")) {
      duplicateResumeBlocked = true;
    }
  }
  assert(duplicateResumeBlocked, "Cannot resume an already active subscription");

  // 8.8 Cancel Subscription Lifecycle
  const cancelledCorporate = await cancelTiffinSubscription(
    superAdminUser,
    subCorporate.id,
    { cancellationReason: "Company moved office to another campus" },
    undefined,
    db
  );
  assert(cancelledCorporate.status === "CANCELLED", "Subscription status transitioned to CANCELLED");
  assert(Boolean(cancelledCorporate.cancelledAt), "Cancelled timestamp recorded");
  assert(cancelledCorporate.cancelledBy === superAdminUser.id, "Cancelled by user recorded");
  assert(
    cancelledCorporate.cancellationReason === "Company moved office to another campus",
    "Cancellation reason recorded"
  );

  // Attempt to cancel an already cancelled subscription
  let duplicateCancelBlocked = false;
  try {
    await cancelTiffinSubscription(
      superAdminUser,
      subCorporate.id,
      { cancellationReason: "Already cancelled" },
      undefined,
      db
    );
  } catch (err: any) {
    if (err.message?.includes("already cancelled")) {
      duplicateCancelBlocked = true;
    }
  }
  assert(duplicateCancelBlocked, "Cannot cancel an already cancelled subscription");

  // Attempt to pause a cancelled subscription
  let pauseCancelledBlocked = false;
  try {
    await pauseTiffinSubscription(
      opsManagerUser,
      subCorporate.id,
      { pauseStartDate: todayStr },
      undefined,
      db
    );
  } catch (err: any) {
    if (err.message?.includes("Only ACTIVE subscriptions can be paused")) {
      pauseCancelledBlocked = true;
    }
  }
  assert(pauseCancelledBlocked, "Cannot pause a cancelled subscription");

  // --------------------------------------------------------------------------
  // SECTION 9: ROLE-BASED ACCESS CONTROL (RBAC) ENFORCEMENT
  // --------------------------------------------------------------------------
  console.log("\n--- Section 9: Role-Based Access Control (RBAC) Enforcement ---");

  // KITCHEN_OPERATIONS has tiffin.read, but NOT tiffin.manage
  // 1. Kitchen head can read customers
  const kitchenCustomerRead = (await listTiffinCustomers(kitchenHeadUser, {}, db)).customers;
  assert(kitchenCustomerRead.length > 0, "Kitchen Head can read tiffin customers (tiffin.read)");

  // 2. Kitchen head can read catalog
  const kitchenCatalogRead = await listTiffinProducts(kitchenHeadUser, {}, db);
  assert(kitchenCatalogRead.length > 0, "Kitchen Head can read tiffin pricing catalog (tiffin.read)");

  // 3. Kitchen head can read subscriptions (tiffin.read)
  const kitchenSubsRead = (await listTiffinSubscriptions(kitchenHeadUser, {}, db)).subscriptions;
  assert(kitchenSubsRead.length > 0, "Kitchen Head can read tiffin subscriptions (tiffin.read)");

  // 4. Kitchen head CANNOT create customer
  let kitchenCreateCustomerBlocked = false;
  try {
    await createTiffinCustomer(
      kitchenHeadUser,
      {
        fullName: "Unauthorized Customer",
        phone: "9876599999",
        deliveryAddress: "Some Address",
      },
      undefined,
      db
    );
  } catch (err: any) {
    if (err instanceof AuthorizationError || err.statusCode === 403) {
      kitchenCreateCustomerBlocked = true;
    }
  }
  assert(kitchenCreateCustomerBlocked, "Kitchen Head is blocked from creating customer (requires tiffin.manage)");

  // 5. Kitchen head CANNOT create or update products
  let kitchenCreateProductBlocked = false;
  try {
    await createTiffinProduct(
      kitchenHeadUser,
      {
        code: "TIF-UNAUTH",
        name: "Unauthorized Item",
        category: "EXTRA",
        billingUnit: "PER_PORTION",
        price: 100,
      },
      undefined,
      db
    );
  } catch (err: any) {
    if (err instanceof AuthorizationError || err.statusCode === 403) {
      kitchenCreateProductBlocked = true;
    }
  }
  assert(kitchenCreateProductBlocked, "Kitchen Head is blocked from creating product (requires tiffin.manage)");

  // 6. Kitchen head CANNOT create subscriptions (requires tiffin.manage)
  let kitchenCreateSubBlocked = false;
  try {
    await createTiffinSubscription(
      kitchenHeadUser,
      {
        customerId: customer1.id,
        productId: monthlyPkg!.id,
        startDate: todayStr,
        mealTypes: "BOTH",
        serviceDays: "ALL_DAYS",
        quantityPerMeal: 1,
        deliveryAddress: "Addr",
      },
      undefined,
      db
    );
  } catch (err: any) {
    if (err instanceof AuthorizationError || err.statusCode === 403) {
      kitchenCreateSubBlocked = true;
    }
  }
  assert(kitchenCreateSubBlocked, "Kitchen Head is blocked from creating subscription (requires tiffin.manage)");

  // 7. Kitchen head CANNOT pause or cancel subscriptions
  let kitchenPauseSubBlocked = false;
  try {
    await pauseTiffinSubscription(kitchenHeadUser, sub1.id, { pauseStartDate: todayStr }, undefined, db);
  } catch (err: any) {
    if (err instanceof AuthorizationError || err.statusCode === 403) {
      kitchenPauseSubBlocked = true;
    }
  }
  assert(kitchenPauseSubBlocked, "Kitchen Head is blocked from pausing subscription (requires tiffin.manage)");

  // ACCOUNTANT has neither tiffin.read nor tiffin.manage
  let accountantReadBlocked = false;
  try {
    await listTiffinCustomers(accountantUser, {}, db);
  } catch (err: any) {
    if (err instanceof AuthorizationError || err.statusCode === 403) {
      accountantReadBlocked = true;
    }
  }
  assert(accountantReadBlocked, "Accountant is blocked from reading tiffin customers");

  let accountantSubsBlocked = false;
  try {
    await listTiffinSubscriptions(accountantUser, {}, db);
  } catch (err: any) {
    if (err instanceof AuthorizationError || err.statusCode === 403) {
      accountantSubsBlocked = true;
    }
  }
  assert(accountantSubsBlocked, "Accountant is blocked from reading tiffin subscriptions");

  // DELIVERY_PERSON has neither tiffin.read nor tiffin.manage
  let deliveryReadBlocked = false;
  try {
    await listTiffinProducts(deliveryPersonUser, {}, db);
  } catch (err: any) {
    if (err instanceof AuthorizationError || err.statusCode === 403) {
      deliveryReadBlocked = true;
    }
  }
  assert(deliveryReadBlocked, "Delivery Person is blocked from reading tiffin catalog");

  let deliverySubsBlocked = false;
  try {
    await listTiffinSubscriptions(deliveryPersonUser, {}, db);
  } catch (err: any) {
    if (err instanceof AuthorizationError || err.statusCode === 403) {
      deliverySubsBlocked = true;
    }
  }
  assert(deliverySubsBlocked, "Delivery Person is blocked from reading tiffin subscriptions");

  // --------------------------------------------------------------------------
  // SECTION 10: AUDIT LOGGING VERIFICATION
  // --------------------------------------------------------------------------
  console.log("\n--- Section 10: Audit Logging Verification ---");

  const auditEvents = await db.query<any>(
    "SELECT action, actor_id, metadata FROM audit_logs WHERE action LIKE 'tiffin.%' ORDER BY created_at ASC"
  );

  assert(auditEvents.length >= 10, `Recorded ${auditEvents.length} tiffin audit events`);
  const actions = auditEvents.map((a: any) => a.action);
  assert(actions.includes("tiffin.customer_created"), "Audit log contains 'tiffin.customer_created'");
  assert(actions.includes("tiffin.customer_updated"), "Audit log contains 'tiffin.customer_updated'");
  assert(actions.includes("tiffin.customer_deactivated"), "Audit log contains 'tiffin.customer_deactivated'");
  assert(actions.includes("tiffin.customer_activated"), "Audit log contains 'tiffin.customer_activated'");
  assert(actions.includes("tiffin.product_created"), "Audit log contains 'tiffin.product_created'");
  assert(actions.includes("tiffin.product_updated"), "Audit log contains 'tiffin.product_updated'");
  assert(actions.includes("tiffin.product_deactivated"), "Audit log contains 'tiffin.product_deactivated'");
  assert(actions.includes("tiffin.product_activated"), "Audit log contains 'tiffin.product_activated'");
  assert(actions.includes("tiffin.subscription_created"), "Audit log contains 'tiffin.subscription_created'");
  assert(actions.includes("tiffin.subscription_updated"), "Audit log contains 'tiffin.subscription_updated'");
  assert(actions.includes("tiffin.subscription_paused"), "Audit log contains 'tiffin.subscription_paused'");
  assert(actions.includes("tiffin.subscription_resumed"), "Audit log contains 'tiffin.subscription_resumed'");
  assert(actions.includes("tiffin.subscription_cancelled"), "Audit log contains 'tiffin.subscription_cancelled'");

  // --------------------------------------------------------------------------
  // SECTION 11: TIFFIN BILLING ELIGIBILITY & PREVIEW CALCULATIONS
  // --------------------------------------------------------------------------
  console.log("\n--- Section 11: Tiffin Billing Eligibility & Preview Calculations ---");

  // Create two customers and subscriptions specifically for billing verification
  const billCustomerA = await createTiffinCustomer(superAdminUser, {
    fullName: "Aman Gupta Billing Test",
    phone: "9876500001",
    deliveryAddress: "Unit 401, DLF Cyber City, Sector 24, Gurugram",
    customerType: "INDIVIDUAL",
    dietaryPreference: "VEG",
  });

  const billCustomerB = await createTiffinCustomer(superAdminUser, {
    fullName: "Acme Corp Lunch Catering",
    phone: "9876500002",
    deliveryAddress: "Tower B, Unitech Cyber Park, Sector 39, Gurugram",
    customerType: "CORPORATE",
    dietaryPreference: "NON_VEG",
  });

  // Customer A: Per-meal billing @ ₹150/meal
  const vegMealProduct = await getTiffinProductByCode(superAdminUser, "TIF-DAILY", db);
  const subA = await createTiffinSubscription(superAdminUser, {
    customerId: billCustomerA.id,
    productId: vegMealProduct!.id,
    startDate: "2026-10-01",
    mealTypes: "LUNCH",
    serviceDays: "ALL_DAYS",
    quantityPerMeal: 1,
    deliveryAddress: billCustomerA.deliveryAddress,
    customPrice: 150,
  });

  // Customer B: Monthly package billing @ ₹4500/month
  const monthlyProduct = await createTiffinProduct(superAdminUser, {
    code: "CORP_MONTHLY_PKG",
    name: "Corporate Executive Meal Plan",
    description: "Monthly subscription package",
    category: "SUBSCRIPTION_PACKAGE",
    billingUnit: "PER_MONTH",
    price: 4500,
  }, undefined, db);

  const subB = await createTiffinSubscription(superAdminUser, {
    customerId: billCustomerB.id,
    productId: monthlyProduct.id,
    startDate: "2026-10-01",
    mealTypes: "LUNCH",
    serviceDays: "MON_FRI",
    quantityPerMeal: 1,
    deliveryAddress: billCustomerB.deliveryAddress,
    customPrice: 4500,
  });

  // Ensure daily_meal_plans row exists to satisfy foreign key
  await db.execute(`
    INSERT OR IGNORE INTO daily_meal_plans (
      id, service_date, meal_type, planned_resident_count, status, created_by, created_at, updated_at
    ) VALUES (
      'plan_billing_test_oct', '2026-10-10', 'LUNCH', 20, 'CONFIRMED', 'usr_superadmin', '2026-10-10T06:00:00Z', '2026-10-10T06:00:00Z'
    )
  `);

  // Insert test delivery tasks:
  // - Customer A: 8 DELIVERED tasks in October 2026
  // - Customer A: 2 EXCEPTION tasks in October 2026 (must NOT be billed)
  // - Customer A: 1 DELIVERED task in September 2026 (outside billing period, excluded)
  for (let i = 1; i <= 8; i++) {
    const day = String(i).padStart(2, "0");
    await db.execute(`
      INSERT INTO delivery_tasks (
        id, order_type, plan_id, service_date, meal_type, status, subscription_id,
        customer_name, customer_phone, delivery_address, delivered_at, delivered_by,
        created_at, updated_at
      ) VALUES (
        ?, 'EXTERNAL', 'plan_billing_test_oct', ?, 'LUNCH', 'DELIVERED', ?,
        ?, ?, ?, ?, 'usr_delivery', ?, ?
      )
    `, [
      `del_task_a_${i}`,
      `2026-10-${day}`,
      subA.id,
      billCustomerA.fullName,
      billCustomerA.phone,
      billCustomerA.deliveryAddress,
      `2026-10-${day}T12:30:00Z`,
      `2026-10-${day}T08:00:00Z`,
      `2026-10-${day}T12:30:00Z`,
    ]);
  }

  // 2 Exception tasks
  for (let i = 9; i <= 10; i++) {
    const day = String(i).padStart(2, "0");
    await db.execute(`
      INSERT INTO delivery_tasks (
        id, order_type, plan_id, service_date, meal_type, status, subscription_id,
        customer_name, customer_phone, delivery_address, exception_type, exception_reason,
        created_at, updated_at
      ) VALUES (
        ?, 'EXTERNAL', 'plan_billing_test_oct', ?, 'LUNCH', 'EXCEPTION', ?,
        ?, ?, ?, 'RESIDENT_DECLINED', 'Customer cancelled meal', ?, ?
      )
    `, [
      `del_task_a_exc_${i}`,
      `2026-10-${day}`,
      subA.id,
      billCustomerA.fullName,
      billCustomerA.phone,
      billCustomerA.deliveryAddress,
      `2026-10-${day}T08:00:00Z`,
      `2026-10-${day}T12:30:00Z`,
    ]);
  }

  // 1 September task (outside Oct window)
  await db.execute(`
    INSERT INTO delivery_tasks (
      id, order_type, plan_id, service_date, meal_type, status, subscription_id,
      customer_name, customer_phone, delivery_address, delivered_at, delivered_by,
      created_at, updated_at
    ) VALUES (
      'del_task_a_sep', 'EXTERNAL', 'plan_billing_test_oct', '2026-09-28', 'LUNCH', 'DELIVERED', ?,
      ?, ?, ?, '2026-09-28T12:30:00Z', 'usr_delivery', '2026-09-28T08:00:00Z', '2026-09-28T12:30:00Z'
    )
  `, [subA.id, billCustomerA.fullName, billCustomerA.phone, billCustomerA.deliveryAddress]);

  // Preview billing for October 2026
  const previewOct = await previewTiffinBilling(superAdminUser, {
    billingPeriod: "2026-10",
    startDate: "2026-10-01",
    endDate: "2026-10-31",
  });

  assert(previewOct.totalEligibleCustomers >= 2, `Preview identified at least 2 eligible billing profiles (got ${previewOct.totalEligibleCustomers})`);

  const prevA = previewOct.customers.find((c) => c.customerId === billCustomerA.id)!;
  assert(Boolean(prevA), "Customer A found in October billing preview");
  assert(prevA.deliveredCount === 8, `Customer A verified delivered meals is exactly 8 (got ${prevA.deliveredCount})`);
  assert(prevA.excludedCount === 2, `Customer A excluded (exception) meals is 2 (got ${prevA.excludedCount})`);
  assert(prevA.billableQuantity === 8, `Customer A billable meal quantity is 8 (got ${prevA.billableQuantity})`);
  assert(prevA.unitPrice === 150, `Customer A unit price snapshot is ₹150 (got ₹${prevA.unitPrice})`);
  assert(prevA.totalAmount === 1200, `Customer A total amount is ₹1,200 (8 * 150 = 1200, got ₹${prevA.totalAmount})`);
  assert(prevA.alreadyBilled === false, "Customer A alreadyBilled flag is initially false");

  const prevB = previewOct.customers.find((c) => c.customerId === billCustomerB.id)!;
  assert(Boolean(prevB), "Customer B found in October billing preview");
  assert(prevB.billingUnit === "PER_MONTH", "Customer B billing unit is PER_MONTH");
  assert(prevB.billableQuantity === 1, "Customer B billable quantity for monthly package is 1");
  assert(prevB.totalAmount === 4500, `Customer B flat monthly fee is ₹4,500 (got ₹${prevB.totalAmount})`);
  assert(prevB.alreadyBilled === false, "Customer B alreadyBilled flag is initially false");

  // --------------------------------------------------------------------------
  // SECTION 12: TIFFIN INVOICE GENERATION & ATOMIC FULFILMENT STAMPING
  // --------------------------------------------------------------------------
  console.log("\n--- Section 12: Tiffin Invoice Generation & Atomic Fulfilment Stamping ---");

  const genResult = await generateTiffinInvoices(superAdminUser, {
    billingPeriod: "2026-10",
    startDate: "2026-10-01",
    endDate: "2026-10-31",
    dueDate: "2026-11-15",
    autoIssue: true,
    customerIds: [billCustomerA.id, billCustomerB.id],
    notes: "Monthly tiffin commercial invoice",
  });

  assert(genResult.generatedCount === 2, `Generated exactly 2 invoices (got ${genResult.generatedCount})`);
  assert(genResult.skippedCount === 0, `Skipped 0 invoices (got ${genResult.skippedCount})`);

  const invA = genResult.invoices.find((i) => i.customerId === billCustomerA.id)!;
  assert(Boolean(invA), "Invoice for Customer A returned");
  assert(invA.invoiceCategory === "TIFFIN", "Invoice A category is strictly 'TIFFIN'");
  assert(invA.status === "ISSUED", "Invoice A status is ISSUED");
  assert(invA.invoiceNumber !== null && invA.invoiceNumber.startsWith("INV-"), `Invoice A assigned official number (${invA.invoiceNumber})`);
  assert(invA.totalAmount === 1200, `Invoice A total is ₹1,200 (got ₹${invA.totalAmount})`);
  assert(invA.amountPaid === 0, "Invoice A initial amount paid is ₹0");
  assert(invA.balanceDue === 1200, "Invoice A initial balance due is ₹1,200");

  const invB = genResult.invoices.find((i) => i.customerId === billCustomerB.id)!;
  assert(Boolean(invB), "Invoice for Customer B returned");
  assert(invB.invoiceCategory === "TIFFIN", "Invoice B category is strictly 'TIFFIN'");
  assert(invB.totalAmount === 4500, `Invoice B total is ₹4,500 (got ₹${invB.totalAmount})`);

  // Verify delivery tasks were stamped with invoice_id and billed_at
  const stampedTasks = await db.query<any>(`
    SELECT id, invoice_id, billed_at FROM delivery_tasks WHERE subscription_id = ? AND status = 'DELIVERED' AND service_date >= '2026-10-01'
  `, [subA.id]);
  assert(stampedTasks.length === 8, "Found all 8 delivered tasks for Customer A");
  assert(stampedTasks.every((t) => t.invoice_id === invA.id), "All 8 delivered tasks stamped with Customer A invoice ID");
  assert(stampedTasks.every((t) => t.billed_at !== null), "All 8 delivered tasks stamped with non-null billed_at timestamp");

  // Verify excluded tasks remained unstamped
  const unstampedTasks = await db.query<any>(`
    SELECT id, invoice_id FROM delivery_tasks WHERE subscription_id = ? AND (status != 'DELIVERED' OR service_date < '2026-10-01')
  `, [subA.id]);
  assert(unstampedTasks.length === 3, "Found 3 excluded tasks (2 exception + 1 sep)");
  assert(unstampedTasks.every((t) => t.invoice_id === null), "All 3 excluded tasks strictly remained unstamped (invoice_id IS NULL)");

  // Verify financial transactions (TIFFIN_CHARGE posted to cashbook)
  const chargeA = await db.queryOne<any>(`
    SELECT * FROM financial_transactions WHERE customer_id = ? AND transaction_type = 'TIFFIN_CHARGE' AND status = 'POSTED'
  `, [billCustomerA.id]);
  assert(Boolean(chargeA), "Posted TIFFIN_CHARGE created in financial_transactions for Customer A");
  assert(Number(chargeA.amount) === 1200, `TIFFIN_CHARGE amount matches ₹1,200 (got ₹${chargeA.amount})`);
  assert(chargeA.invoice_id === invA.id, "TIFFIN_CHARGE is linked to invoice A");

  // --------------------------------------------------------------------------
  // SECTION 13: IDEMPOTENCY & DUPLICATE INVOICE PREVENTION
  // --------------------------------------------------------------------------
  console.log("\n--- Section 13: Idempotency & Duplicate Invoice Prevention ---");

  // Re-run preview: customers should now be marked alreadyBilled
  const previewAfter = await previewTiffinBilling(superAdminUser, {
    billingPeriod: "2026-10",
    startDate: "2026-10-01",
    endDate: "2026-10-31",
  });

  const prevAAfter = previewAfter.customers.find((c) => c.customerId === billCustomerA.id)!;
  assert(prevAAfter.alreadyBilled === true, "Customer A now marked alreadyBilled === true in preview");
  assert(prevAAfter.existingInvoiceId === invA.id, "Preview links to existing invoice A ID");
  assert(prevAAfter.existingInvoiceNumber === invA.invoiceNumber, `Preview displays existing invoice number (${prevAAfter.existingInvoiceNumber})`);

  // Attempt duplicate generation for October 2026
  const duplicateGenResult = await generateTiffinInvoices(superAdminUser, {
    billingPeriod: "2026-10",
    startDate: "2026-10-01",
    endDate: "2026-10-31",
    dueDate: "2026-11-15",
    autoIssue: true,
    customerIds: [billCustomerA.id, billCustomerB.id],
  });

  assert(duplicateGenResult.generatedCount === 0, `Duplicate generation generated 0 invoices (got ${duplicateGenResult.generatedCount})`);
  assert(duplicateGenResult.skippedCount === 2, `Duplicate generation skipped both already-billed customers (got ${duplicateGenResult.skippedCount})`);

  // Verify database contains exactly 1 invoice per customer for October
  const invCountA = await db.queryOne<any>(`
    SELECT COUNT(*) as count FROM invoices WHERE customer_id = ? AND billing_period = '2026-10'
  `, [billCustomerA.id]);
  assert(Number(invCountA.count) === 1, `Database contains strictly 1 invoice for Customer A in 2026-10 (got ${invCountA.count})`);

  // --------------------------------------------------------------------------
  // SECTION 14: TIFFIN PAYMENT RECORDING & CASHBOOK LEDGER ALLOCATION
  // --------------------------------------------------------------------------
  console.log("\n--- Section 14: Tiffin Payment Recording & Cashbook Ledger Allocation ---");

  // Record partial payment of ₹500 for Customer A
  const paymentA1 = await recordTiffinPayment(superAdminUser, {
    customerId: billCustomerA.id,
    amount: 500,
    transactionDate: "2026-10-16",
    paymentMethod: "UPI",
    referenceNumber: "UPI/OCT/9001",
    invoiceId: invA.id,
    notes: "Partial payment via UPI",
  });

  assert(paymentA1.transaction.transactionType === "TIFFIN_PAYMENT", "Payment transaction type is TIFFIN_PAYMENT");
  assert(paymentA1.transaction.customerId === billCustomerA.id, "Payment stamped with Customer A ID");
  assert(paymentA1.transaction.amount === 500, "Payment amount is ₹500");
  assert(paymentA1.transaction.status === "POSTED", "Payment status is POSTED");
  const updatedInvA = (await getInvoiceById(superAdminUser, invA.id, db))!;
  assert(updatedInvA.amountPaid === 500, `Invoice A amountPaid updated to ₹500 (got ₹${updatedInvA.amountPaid})`);
  assert(updatedInvA.balanceDue === 700, `Invoice A balanceDue updated to ₹700 (got ₹${updatedInvA.balanceDue})`);
  assert(updatedInvA.status === "PARTIALLY_PAID", "Invoice A status transitioned to PARTIALLY_PAID");

  // Record full payment of ₹4500 for Customer B
  const paymentB = await recordTiffinPayment(accountantUser, {
    customerId: billCustomerB.id,
    amount: 4500,
    transactionDate: "2026-10-18",
    paymentMethod: "BANK_TRANSFER",
    referenceNumber: "NEFT/CORP/44001",
    invoiceId: invB.id,
    notes: "Full payment via NEFT",
  });

  const updatedInvB = (await getInvoiceById(superAdminUser, invB.id, db))!;
  assert(updatedInvB.amountPaid === 4500, "Invoice B fully paid (₹4,500)");
  assert(updatedInvB.balanceDue === 0, "Invoice B balance due is ₹0");
  assert(updatedInvB.status === "PAID", "Invoice B status transitioned to PAID");

  // Anti-Over-Payment Guard: Attempting to allocate payment exceeding invoice balance due
  let overpayBlocked = false;
  try {
    await recordTiffinPayment(superAdminUser, {
      customerId: billCustomerB.id,
      amount: 100,
      transactionDate: "2026-10-19",
      paymentMethod: "UPI",
      invoiceId: invB.id,
    });
  } catch (err: any) {
    overpayBlocked = true;
    assert(err.message.includes("PAID") || err.message.includes("fully paid") || err.message.includes("exceeds"), `Anti-Over-Payment Guard: ${err.message}`);
  }
  assert(overpayBlocked, "Anti-Over-Payment Guard blocked payment against already settled invoice");

  // --------------------------------------------------------------------------
  // SECTION 15: CUSTOMER BALANCE DOSSIER & UNALLOCATED ADVANCE TRACKING
  // --------------------------------------------------------------------------
  console.log("\n--- Section 15: Customer Balance Dossier & Unallocated Advance Tracking ---");

  // Query Customer A balance
  const balA1 = await getTiffinCustomerBalance(superAdminUser, billCustomerA.id);
  assert(balA1.totalCharged === 1200, `Customer A totalCharged is ₹1,200 (got ₹${balA1.totalCharged})`);
  assert(balA1.totalPaid === 500, `Customer A totalPaid is ₹500 (got ₹${balA1.totalPaid})`);
  assert(balA1.outstandingBalance === 700, `Customer A outstandingBalance is ₹700 (got ₹${balA1.outstandingBalance})`);
  assert(balA1.unallocatedPaymentAmount === 0, `Customer A unallocatedPaymentAmount is ₹0 (got ₹${balA1.unallocatedPaymentAmount})`);
  assert(balA1.invoices.length === 1, "Customer A dossier has 1 invoice");
  assert(balA1.payments.length === 1, "Customer A dossier has 1 payment");

  // Record an unallocated advance payment of ₹300 for Customer A (no invoiceId specified)
  const advancePayment = await recordTiffinPayment(superAdminUser, {
    customerId: billCustomerA.id,
    amount: 300,
    transactionDate: "2026-10-20",
    paymentMethod: "CASH",
    notes: "Advance cash deposit from customer",
  });

  const balA2 = await getTiffinCustomerBalance(superAdminUser, billCustomerA.id);
  assert(balA2.totalPaid === 800, `Customer A totalPaid increased to ₹800 (500 + 300, got ₹${balA2.totalPaid})`);
  assert(balA2.outstandingBalance === 400, `Customer A outstandingBalance decreased to ₹400 (1200 - 800, got ₹${balA2.outstandingBalance})`);
  assert(balA2.unallocatedPaymentAmount === 300, `Customer A has ₹300 unallocated payment balance (got ₹${balA2.unallocatedPaymentAmount})`);

  // Check unallocated payments query
  const unallocatedList = await getUnallocatedPaymentsForCustomer(superAdminUser, billCustomerA.id);
  assert(unallocatedList.length === 1, "getUnallocatedPaymentsForCustomer returns exactly 1 unallocated payment");
  assert(unallocatedList[0].unallocatedAmount === 300, "Unallocated amount is ₹300");

  // Manually allocate the ₹300 advance to Invoice A
  const allocResult = await allocatePaymentToInvoice(superAdminUser, {
    invoiceId: invA.id,
    paymentTransactionId: advancePayment.transaction.id,
    amount: 300,
  });
  assert(allocResult.invoice.amountPaid === 800, `Invoice A amountPaid updated to ₹800 after manual allocation (got ₹${allocResult.invoice.amountPaid})`);
  assert(allocResult.invoice.balanceDue === 400, `Invoice A balanceDue updated to ₹400 (got ₹${allocResult.invoice.balanceDue})`);

  // --------------------------------------------------------------------------
  // SECTION 16: INVOICE CANCELLATION & DELIVERY TASK RELEASE INTEGRITY
  // --------------------------------------------------------------------------
  console.log("\n--- Section 16: Invoice Cancellation & Delivery Task Release Integrity ---");

  // Create temporary Customer C with 2 delivered meals
  const billCustomerC = await createTiffinCustomer(superAdminUser, {
    fullName: "Pooja Sharma Cancel Test",
    phone: "9876500003",
    deliveryAddress: "Tower 2, Cyber Hub, Gurugram",
    customerType: "INDIVIDUAL",
    dietaryPreference: "VEG",
  });

  const subC = await createTiffinSubscription(superAdminUser, {
    customerId: billCustomerC.id,
    productId: vegMealProduct!.id,
    startDate: "2026-10-01",
    mealTypes: "LUNCH",
    serviceDays: "ALL_DAYS",
    quantityPerMeal: 1,
    deliveryAddress: billCustomerC.deliveryAddress,
    customPrice: 150,
  });

  // Insert 2 tasks for Customer C
  await db.execute(`
    INSERT INTO delivery_tasks (
      id, order_type, plan_id, service_date, meal_type, status, subscription_id,
      customer_name, customer_phone, delivery_address, delivered_at, delivered_by,
      created_at, updated_at
    ) VALUES 
      ('del_task_c_1', 'EXTERNAL', 'plan_billing_test_oct', '2026-10-12', 'LUNCH', 'DELIVERED', ?, ?, ?, ?, '2026-10-12T12:30:00Z', 'usr_delivery', '2026-10-12T08:00:00Z', '2026-10-12T12:30:00Z'),
      ('del_task_c_2', 'EXTERNAL', 'plan_billing_test_oct', '2026-10-13', 'LUNCH', 'DELIVERED', ?, ?, ?, ?, '2026-10-13T12:30:00Z', 'usr_delivery', '2026-10-13T08:00:00Z', '2026-10-13T12:30:00Z')
  `, [subC.id, billCustomerC.fullName, billCustomerC.phone, billCustomerC.deliveryAddress,
      subC.id, billCustomerC.fullName, billCustomerC.phone, billCustomerC.deliveryAddress]);

  // Generate invoice for Customer C
  const genC = await generateTiffinInvoices(superAdminUser, {
    billingPeriod: "2026-10",
    startDate: "2026-10-01",
    endDate: "2026-10-31",
    dueDate: "2026-11-15",
    autoIssue: true,
    customerIds: [billCustomerC.id],
  });
  const invC = genC.invoices[0];
  assert(Boolean(invC), "Invoice for Customer C generated");

  // Verify Customer C tasks are currently stamped
  const cTasksBefore = await db.query<any>(`SELECT id, invoice_id FROM delivery_tasks WHERE subscription_id = ?`, [subC.id]);
  assert(cTasksBefore.every((t) => t.invoice_id === invC.id), "Customer C delivery tasks are stamped with invoice ID before cancellation");

  // Cancel Invoice C
  const cancelledInv = await cancelInvoice(superAdminUser, invC.id, "Customer billing address dispute - regenerating");
  assert(cancelledInv.status === "CANCELLED", "Invoice C transitioned to CANCELLED");

  // Verify delivery tasks were released!
  const cTasksAfter = await db.query<any>(`SELECT id, invoice_id, billed_at FROM delivery_tasks WHERE subscription_id = ?`, [subC.id]);
  assert(cTasksAfter.every((t) => t.invoice_id === null), "All Customer C delivery tasks released (invoice_id === null)");
  assert(cTasksAfter.every((t) => t.billed_at === null), "All Customer C delivery tasks released (billed_at === null)");

  // Verify linked TIFFIN_CHARGE was reversed
  const cChargeAfter = await db.queryOne<any>(`SELECT status FROM financial_transactions WHERE id = ? OR invoice_id = ?`, [invC.rentChargeId, invC.id]);
  assert(cChargeAfter?.status === "REVERSED", "Linked TIFFIN_CHARGE status updated to REVERSED upon invoice cancellation");

  // --------------------------------------------------------------------------
  // SECTION 17: ROLE-BASED ACCESS CONTROL (RBAC) ON TIFFIN BILLING
  // --------------------------------------------------------------------------
  console.log("\n--- Section 17: Role-Based Access Control (RBAC) on Tiffin Billing ---");

  // Least Privilege: DELIVERY_PERSON blocked from previewTiffinBilling
  let deliveryBlockedOnPreview = false;
  try {
    await previewTiffinBilling(deliveryPersonUser, {
      billingPeriod: "2026-10",
      startDate: "2026-10-01",
      endDate: "2026-10-31",
    });
  } catch (err: any) {
    deliveryBlockedOnPreview = true;
    assert(err instanceof AuthorizationError, "DELIVERY_PERSON throws AuthorizationError on previewTiffinBilling");
  }
  assert(deliveryBlockedOnPreview, "Privilege Guard: DELIVERY_PERSON blocked from previewTiffinBilling (HTTP 403)");

  // Least Privilege: KITCHEN_OPERATIONS blocked from previewTiffinBilling
  let kitchenBlockedOnPreview = false;
  try {
    await previewTiffinBilling(kitchenHeadUser, {
      billingPeriod: "2026-10",
      startDate: "2026-10-01",
      endDate: "2026-10-31",
    });
  } catch (err: any) {
    kitchenBlockedOnPreview = true;
    assert(err instanceof AuthorizationError, "KITCHEN_OPERATIONS throws AuthorizationError on previewTiffinBilling");
  }
  assert(kitchenBlockedOnPreview, "Privilege Guard: KITCHEN_OPERATIONS blocked from previewTiffinBilling (HTTP 403)");

  // Least Privilege: OPERATIONS_MANAGER (lacks finance.manage) blocked from generateTiffinInvoices
  let opsBlockedOnGenerate = false;
  try {
    await generateTiffinInvoices(opsManagerUser, {
      billingPeriod: "2026-10",
      startDate: "2026-10-01",
      endDate: "2026-10-31",
      dueDate: "2026-11-15",
      customerIds: [billCustomerA.id],
    });
  } catch (err: any) {
    opsBlockedOnGenerate = true;
    assert(err instanceof AuthorizationError, "OPERATIONS_MANAGER throws AuthorizationError on generateTiffinInvoices");
  }
  assert(opsBlockedOnGenerate, "Privilege Guard: OPERATIONS_MANAGER blocked from generateTiffinInvoices (HTTP 403)");

  // Least Privilege: KITCHEN_OPERATIONS blocked from recordTiffinPayment
  let kitchenBlockedOnPayment = false;
  try {
    await recordTiffinPayment(kitchenHeadUser, {
      customerId: billCustomerA.id,
      amount: 100,
      transactionDate: "2026-10-21",
      paymentMethod: "CASH",
    });
  } catch (err: any) {
    kitchenBlockedOnPayment = true;
    assert(err instanceof AuthorizationError, "KITCHEN_OPERATIONS throws AuthorizationError on recordTiffinPayment");
  }
  assert(kitchenBlockedOnPayment, "Privilege Guard: KITCHEN_OPERATIONS blocked from recordTiffinPayment (HTTP 403)");

  // OPERATIONS_MANAGER successfully reads customer balance
  const opsBalanceRead = await getTiffinCustomerBalance(opsManagerUser, billCustomerA.id);
  assert(Boolean(opsBalanceRead), "OPERATIONS_MANAGER successfully reads getTiffinCustomerBalance");

  // ACCOUNTANT successfully records tiffin payment
  const accountantPayment = await recordTiffinPayment(accountantUser, {
    customerId: billCustomerA.id,
    amount: 100,
    transactionDate: "2026-10-21",
    paymentMethod: "UPI",
    notes: "Accountant payment entry",
  });
  assert(Boolean(accountantPayment), "ACCOUNTANT successfully authorized to execute recordTiffinPayment");

  // --------------------------------------------------------------------------
  // SECTION 18: ZERO PRIMARY DATABASE MODIFICATION GUARD
  // --------------------------------------------------------------------------
  console.log("\n--- Section 18: Primary Database Protection Guard ---");

  if (primaryStatsBefore) {
    const primaryStatsAfter = fs.statSync(primaryDbPath);
    assert(
      primaryStatsBefore.mtimeMs === primaryStatsAfter.mtimeMs &&
      primaryStatsBefore.size === primaryStatsAfter.size,
      `Primary database 'data/erp.db' remained 100% UNTOUCHED (size: ${primaryStatsAfter.size} bytes, mtime preserved)`
    );
  } else {
    assert(!fs.existsSync(primaryDbPath), "Primary database 'data/erp.db' does not exist in repo and was never created");
  }

  // Final summary
  console.log("\n================================================================================");
  console.log(`TIFFIN TEST SUITE RESULTS: ${passCount} PASSED, ${failCount} FAILED`);
  console.log("================================================================================");

  cleanupTestDb();

  if (failCount > 0) {
    process.exit(1);
  }
}

runTiffinTests().catch((err) => {
  console.error("Unhandled test execution error:", err);
  cleanupTestDb();
  process.exit(1);
});
