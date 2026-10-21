import nodemailer, { Transporter } from "nodemailer";

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text?: string;
  timestamp: string;
}

export interface EmailAdapter {
  sendOtp(to: string, otp: string): Promise<boolean>;
  sendPasswordReset(to: string, resetUrl: string): Promise<boolean>;
}

export interface SmtpConfig {
  host?: string;
  port?: number;
  secure?: boolean;
  user: string;
  pass: string;
  from?: string;
}

export const DEFAULT_SMTP_USER = "zevats@gmail.com";
export const DEFAULT_EMAIL_FROM = "Ravinarayan ERP <zevats@gmail.com>";

// In-memory mock storage for testing and offline development
export const mockSentEmails: EmailMessage[] = [];

export function clearMockSentEmails(): void {
  mockSentEmails.length = 0;
}

/**
 * Test/Mock Email Adapter for local development and automated testing.
 * Never persists or exposes plain text secrets outside of test inspection.
 */
export class MockEmailAdapter implements EmailAdapter {
  async sendOtp(to: string, otp: string): Promise<boolean> {
    mockSentEmails.push({
      to,
      subject: "Your Ravinarayan ERP Login Verification Code",
      html: `<p>Your 6-digit verification code is: <strong>${otp}</strong>. It expires in 10 minutes.</p>`,
      text: `Your 6-digit verification code is: ${otp}. It expires in 10 minutes.`,
      timestamp: new Date().toISOString(),
    });
    return true;
  }

  async sendPasswordReset(to: string, resetUrl: string): Promise<boolean> {
    mockSentEmails.push({
      to,
      subject: "Ravinarayan ERP Password Reset Request",
      html: `<p>Please click the link below to reset your password: <a href="${resetUrl}">${resetUrl}</a></p>`,
      text: `Please reset your password using this link: ${resetUrl}`,
      timestamp: new Date().toISOString(),
    });
    return true;
  }
}

/**
 * Production-ready Gmail SMTP Email Adapter using Nodemailer.
 * Uses smtp.gmail.com over TLS (port 465) or STARTTLS (port 587) with App Passwords.
 */
export class GmailSmtpEmailAdapter implements EmailAdapter {
  private transporter: Transporter;
  private from: string;
  private user: string;

  constructor(config: SmtpConfig, customTransporter?: Transporter) {
    if (!config.user || !config.pass) {
      throw new Error(
        "SMTP configuration error: SMTP_USER and SMTP_APP_PASSWORD are required for Gmail SMTP delivery."
      );
    }
    this.user = config.user;
    this.from = config.from || `Ravinarayan ERP <${config.user || DEFAULT_SMTP_USER}>`;

    if (customTransporter) {
      this.transporter = customTransporter;
    } else {
      const port = config.port ?? 465;
      const secure = config.secure ?? (port === 465);
      this.transporter = nodemailer.createTransport({
        host: config.host || "smtp.gmail.com",
        port,
        secure,
        auth: {
          user: config.user,
          pass: config.pass,
        },
        tls: {
          rejectUnauthorized: true,
        },
      });
    }
  }

  async sendOtp(to: string, otp: string): Promise<boolean> {
    try {
      const info = await this.transporter.sendMail({
        from: this.from,
        to,
        subject: "Your Ravinarayan ERP Verification Code",
        text: `Your 6-digit verification code is: ${otp}. Valid for 10 minutes.`,
        html: `<p>Your 6-digit verification code is: <strong>${otp}</strong>.</p><p>This code expires in 10 minutes. Do not share it with anyone.</p>`,
      });
      const accepted = Boolean(info && Array.isArray(info.accepted) && info.accepted.length > 0);
      return accepted;
    } catch (err: any) {
      // Safe sanitized logging: NEVER log OTP code, credentials, or auth headers
      console.error(
        "[SMTP Delivery Error] Failed to send OTP email:",
        err?.message || "Unknown SMTP transport error"
      );
      return false;
    }
  }

  async sendPasswordReset(to: string, resetUrl: string): Promise<boolean> {
    try {
      const info = await this.transporter.sendMail({
        from: this.from,
        to,
        subject: "Ravinarayan ERP Password Reset Request",
        text: `Reset your password at: ${resetUrl}. Valid for 1 hour.`,
        html: `<p>A password reset was requested for your account.</p><p><a href="${resetUrl}">Click here to reset your password</a></p><p>This link expires in 1 hour.</p>`,
      });
      return Boolean(info && Array.isArray(info.accepted) && info.accepted.length > 0);
    } catch (err: any) {
      console.error(
        "[SMTP Delivery Error] Failed to send password reset email:",
        err?.message || "Unknown SMTP transport error"
      );
      return false;
    }
  }

  /**
   * Diagnostic verification helper to check SMTP connection health.
   */
  async verifyConnection(): Promise<{ success: boolean; error?: string }> {
    try {
      await this.transporter.verify();
      return { success: true };
    } catch (err: any) {
      return {
        success: false,
        error: err?.message || "SMTP connection verification failed",
      };
    }
  }
}

let activeAdapter: EmailAdapter | null = null;

export function getEmailAdapter(): EmailAdapter {
  if (activeAdapter) {
    return activeAdapter;
  }

  const adapterType = (process.env.EMAIL_ADAPTER || "").trim().toLowerCase();
  const isTest = process.env.NODE_ENV === "test";
  const isProd = process.env.NODE_ENV === "production";

  // 1. Explicit mock request
  if (adapterType === "mock") {
    if (isProd) {
      throw new Error(
        "Configuration error: MockEmailAdapter is strictly forbidden in production environments."
      );
    }
    activeAdapter = new MockEmailAdapter();
    return activeAdapter;
  }

  // 2. Automated test suite default (unless testing SMTP explicitly)
  if (isTest && adapterType !== "smtp") {
    activeAdapter = new MockEmailAdapter();
    return activeAdapter;
  }

  // 3. SMTP configuration parameters
  const smtpUser = process.env.SMTP_USER || DEFAULT_SMTP_USER;
  const smtpPass = process.env.SMTP_APP_PASSWORD || process.env.SMTP_PASS || "";
  const smtpHost = process.env.SMTP_HOST || "smtp.gmail.com";
  const smtpPort = parseInt(process.env.SMTP_PORT || "465", 10);
  const smtpSecure =
    process.env.SMTP_SECURE !== undefined
      ? process.env.SMTP_SECURE === "true"
      : smtpPort === 465;
  const emailFrom = process.env.EMAIL_FROM || DEFAULT_EMAIL_FROM;

  // 4. Explicit SMTP selection
  if (adapterType === "smtp" || adapterType === "gmail") {
    if (!smtpPass) {
      throw new Error(
        "Email configuration error: SMTP_APP_PASSWORD is required when EMAIL_ADAPTER=smtp."
      );
    }
    activeAdapter = new GmailSmtpEmailAdapter({
      host: smtpHost,
      port: smtpPort,
      secure: smtpSecure,
      user: smtpUser,
      pass: smtpPass,
      from: emailFrom,
    });
    return activeAdapter;
  }

  // 5. Production requirement: must configure real email delivery
  if (isProd) {
    if (!smtpPass) {
      throw new Error(
        "Email configuration error: Production requires valid SMTP_APP_PASSWORD for Gmail SMTP delivery."
      );
    }
    activeAdapter = new GmailSmtpEmailAdapter({
      host: smtpHost,
      port: smtpPort,
      secure: smtpSecure,
      user: smtpUser,
      pass: smtpPass,
      from: emailFrom,
    });
    return activeAdapter;
  }

  // 6. Local development: use SMTP if password is provided, otherwise fall back to mock
  if (smtpPass) {
    activeAdapter = new GmailSmtpEmailAdapter({
      host: smtpHost,
      port: smtpPort,
      secure: smtpSecure,
      user: smtpUser,
      pass: smtpPass,
      from: emailFrom,
    });
    return activeAdapter;
  }

  activeAdapter = new MockEmailAdapter();
  return activeAdapter;
}

export function setEmailAdapterForTesting(adapter: EmailAdapter | null): void {
  activeAdapter = adapter;
}
