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
  const email = process.env.ERP_ADMIN_EMAIL || "admin@ravinarayan.in";
  const fullName = process.env.ERP_ADMIN_NAME || "Dr. Ravinder Gulia";

  return {
    username: username.trim().toLowerCase(),
    email: email.trim().toLowerCase(),
    password,
    fullName,
  };
}
