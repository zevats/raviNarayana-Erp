/**
 * Environment validation and security policy enforcement for Ravinarayan ERP.
 */

export interface ValidatedAdminConfig {
  username: string;
  email: string;
  password: string;
  fullName: string;
}

const DEMO_PASSWORD = "Ravinarayan@2026";
const MIN_PASSWORD_LENGTH = 12;

export const DEFAULT_ADMIN_EMAIL = "rishabh27kumar2006@gmail.com";

/**
 * Returns the authoritative administrator email address.
 * Prefers ERP_ADMIN_EMAIL if explicitly set, defaulting to DEFAULT_ADMIN_EMAIL.
 */
export function getAdminEmail(): string {
  return (process.env.ERP_ADMIN_EMAIL || DEFAULT_ADMIN_EMAIL).trim().toLowerCase();
}

export function validateAdminEnvironment(staffCount: number): ValidatedAdminConfig | null {
  // If staff users already exist in the database, seeding is not needed.
  if (staffCount > 0) {
    return null;
  }

  const isProduction = process.env.NODE_ENV === "production";
  const configuredPassword = process.env.ERP_ADMIN_PASSWORD;

  if (isProduction) {
    if (!configuredPassword) {
      throw new Error(
        "[FATAL SECURITY CONFIGURATION] ERP_ADMIN_PASSWORD must be explicitly provided in production before seeding initial administrator."
      );
    }

    if (configuredPassword === DEMO_PASSWORD) {
      throw new Error(
        "[FATAL SECURITY CONFIGURATION] Known demonstration password 'Ravinarayan@2026' is prohibited in production environments."
      );
    }

    if (configuredPassword.length < MIN_PASSWORD_LENGTH) {
      throw new Error(
        `[FATAL SECURITY CONFIGURATION] ERP_ADMIN_PASSWORD must be at least ${MIN_PASSWORD_LENGTH} characters long in production.`
      );
    }
  }

  // Development fallback
  const password = configuredPassword || DEMO_PASSWORD;
  if (!isProduction && !configuredPassword) {
    console.warn(
      "[DEV NOTICE] ERP_ADMIN_PASSWORD not set. Seeding initial administrator with development demo credential."
    );
  }

  const username = process.env.ERP_ADMIN_USERNAME || "admin";
  const email = getAdminEmail();
  const fullName = process.env.ERP_ADMIN_NAME || "Dr. Ravinder Gulia";

  return {
    username: username.trim().toLowerCase(),
    email: email.trim().toLowerCase(),
    password,
    fullName,
  };
}

export function validateProductionDatabaseEnvironment(): void {
  const isProduction = process.env.NODE_ENV === "production";
  if (isProduction) {
    const pgUrl = process.env.DATABASE_URL || process.env.DIRECT_URL;
    if (!pgUrl) {
      throw new Error(
        "[FATAL PRODUCTION CONFIGURATION] PostgreSQL database URL (DATABASE_URL) is required in production (NODE_ENV=production). Silent fallback to local ephemeral SQLite is strictly prohibited in production."
      );
    }
  }
}

// -----------------------------------------------------------------------------
// Invoicing & Tax Billing Configuration
// -----------------------------------------------------------------------------

export interface CompanyBillingConfig {
  companyName: string;
  companyAddress: string;
  companyGstin: string | null;
  companyStateCode: string;
}

export const DEFAULT_COMPANY_NAME = "Ravinarayan PG Guesthouse";
export const DEFAULT_COMPANY_ADDRESS = "Met City, Yakubpur, Jhajjar, Haryana 124103";
export const DEFAULT_COMPANY_STATE_CODE = "06"; // Haryana state code for GST

export function getCompanyBillingConfig(): CompanyBillingConfig {
  const companyName = (process.env.ERP_COMPANY_NAME || DEFAULT_COMPANY_NAME).trim();
  const companyAddress = (process.env.ERP_COMPANY_ADDRESS || DEFAULT_COMPANY_ADDRESS).trim();
  const rawGstin = process.env.ERP_COMPANY_GSTIN?.trim();
  const companyGstin = rawGstin && rawGstin.length > 0 ? rawGstin : null;
  const companyStateCode = (process.env.ERP_COMPANY_STATE_CODE || DEFAULT_COMPANY_STATE_CODE).trim();

  return {
    companyName,
    companyAddress,
    companyGstin,
    companyStateCode,
  };
}


