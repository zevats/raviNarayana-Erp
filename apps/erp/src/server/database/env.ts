/**
 * Environment validation and security policy enforcement for Ravinarayan ERP.
 */
import crypto from "crypto";

export interface ValidatedAdminConfig {
  username: string;
  email: string;
  password: string;
  fullName: string;
  /**
   * True when no ERP_ADMIN_PASSWORD was configured (development only) and a random initial
   * password was generated. The bootstrap caller must show it once to the operator and must
   * never log, persist or return it anywhere else.
   */
  passwordGenerated?: boolean;
}

const MIN_PASSWORD_LENGTH = 12;

// SHA-256 digests of retired shared demo credentials. Stored as digests so the plaintext never
// appears in source; any configured password matching one of them is refused everywhere.
const RETIRED_PASSWORD_DIGESTS = new Set([
  "ea86dee8be20199dab221f23e746f3129c161e15f7ad65fe9e97d6b84ec923ad",
]);

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isRetiredDemoPassword(password: string): boolean {
  return RETIRED_PASSWORD_DIGESTS.has(crypto.createHash("sha256").update(password).digest("hex"));
}

/** Cryptographically secure initial password: 24 URL-safe characters (~144 bits). */
export function generateInitialAdminPassword(): string {
  return crypto.randomBytes(18).toString("base64url");
}

/**
 * Returns the configured administrator email (ERP_ADMIN_EMAIL), lower-cased, or null when unset.
 * There is deliberately no built-in default: the address must come from local configuration.
 */
export function getAdminEmail(): string | null {
  const email = process.env.ERP_ADMIN_EMAIL?.trim().toLowerCase();
  return email ? email : null;
}

export function validateAdminEnvironment(staffCount: number): ValidatedAdminConfig | null {
  // If staff users already exist in the database, seeding is not needed.
  if (staffCount > 0) {
    return null;
  }

  const isProduction = process.env.NODE_ENV === "production";
  const configuredPassword = process.env.ERP_ADMIN_PASSWORD;

  const email = getAdminEmail();
  if (!email || !EMAIL_PATTERN.test(email)) {
    throw new Error(
      "[FATAL SECURITY CONFIGURATION] ERP_ADMIN_EMAIL must be set to the administrator's email address before seeding the initial administrator (it receives login verification codes)."
    );
  }

  if (isProduction && !configuredPassword) {
    throw new Error(
      "[FATAL SECURITY CONFIGURATION] ERP_ADMIN_PASSWORD must be explicitly provided in production before seeding initial administrator."
    );
  }

  if (configuredPassword !== undefined) {
    if (isRetiredDemoPassword(configuredPassword)) {
      throw new Error(
        "[FATAL SECURITY CONFIGURATION] ERP_ADMIN_PASSWORD matches a retired, publicly known demonstration password and is prohibited."
      );
    }
    if (configuredPassword.length < MIN_PASSWORD_LENGTH) {
      throw new Error(
        `[FATAL SECURITY CONFIGURATION] ERP_ADMIN_PASSWORD must be at least ${MIN_PASSWORD_LENGTH} characters long.`
      );
    }
  }

  // Development without a configured password: generate a random one for one-time display.
  const passwordGenerated = !configuredPassword;
  const password = configuredPassword || generateInitialAdminPassword();

  const username = process.env.ERP_ADMIN_USERNAME || "admin";
  const fullName = process.env.ERP_ADMIN_NAME || "ERP Administrator";

  return {
    username: username.trim().toLowerCase(),
    email,
    password,
    fullName,
    passwordGenerated,
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


