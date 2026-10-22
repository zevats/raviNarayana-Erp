import nodemailer, { Transporter } from "nodemailer";
import { renderOtpEmail } from "./emailTemplate";

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
    const rendered = renderOtpEmail({ otp, recipientEmail: to, expiresInMinutes: 10 });
    mockSentEmails.push({
      to,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
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
        pool: true,
        maxConnections: 3,
        maxMessages: 100,
        rateDelta: 1000,
        rateLimit: 5,
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
      const rendered = renderOtpEmail({ otp, recipientEmail: to, expiresInMinutes: 10 });
      const info = await this.transporter.sendMail({
        from: this.from,
        to,
        subject: rendered.subject,
        text: rendered.text,
        html: rendered.html,
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

interface GlobalEmailContext {
  _rnActiveEmailAdapter?: EmailAdapter | null;
}

const globalForEmail = globalThis as unknown as GlobalEmailContext;

export function getEmailAdapter(): EmailAdapter {
  if (globalForEmail._rnActiveEmailAdapter) {
    return globalForEmail._rnActiveEmailAdapter;
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
    globalForEmail._rnActiveEmailAdapter = new MockEmailAdapter();
    return globalForEmail._rnActiveEmailAdapter;
  }

  // 2. Automated test suite default (unless testing SMTP explicitly)
  if (isTest && adapterType !== "smtp") {
    globalForEmail._rnActiveEmailAdapter = new MockEmailAdapter();
    return globalForEmail._rnActiveEmailAdapter;
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
    globalForEmail._rnActiveEmailAdapter = new GmailSmtpEmailAdapter({
      host: smtpHost,
      port: smtpPort,
      secure: smtpSecure,
      user: smtpUser,
      pass: smtpPass,
      from: emailFrom,
    });
    return globalForEmail._rnActiveEmailAdapter;
  }

  // 5. Production requirement: must configure real email delivery
  if (isProd) {
    if (!smtpPass) {
      throw new Error(
        "Email configuration error: Production requires valid SMTP_APP_PASSWORD for Gmail SMTP delivery."
      );
    }
    globalForEmail._rnActiveEmailAdapter = new GmailSmtpEmailAdapter({
      host: smtpHost,
      port: smtpPort,
      secure: smtpSecure,
      user: smtpUser,
      pass: smtpPass,
      from: emailFrom,
    });
    return globalForEmail._rnActiveEmailAdapter;
  }

  // 6. Local development: use SMTP if password is provided, otherwise fall back to mock
  if (smtpPass) {
    globalForEmail._rnActiveEmailAdapter = new GmailSmtpEmailAdapter({
      host: smtpHost,
      port: smtpPort,
      secure: smtpSecure,
      user: smtpUser,
      pass: smtpPass,
      from: emailFrom,
    });
    return globalForEmail._rnActiveEmailAdapter;
  }

  globalForEmail._rnActiveEmailAdapter = new MockEmailAdapter();
  return globalForEmail._rnActiveEmailAdapter;
}

export function setEmailAdapterForTesting(adapter: EmailAdapter | null): void {
  globalForEmail._rnActiveEmailAdapter = adapter;
}
