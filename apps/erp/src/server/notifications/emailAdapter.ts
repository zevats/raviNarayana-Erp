import fs from "fs";
import path from "path";
import crypto from "crypto";
import nodemailer, { Transporter } from "nodemailer";
import { renderOtpEmail, RenderedEmail } from "./emailTemplate";

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text?: string;
  timestamp: string;
}

export interface SmtpLifecycleMetrics {
  adapterId: string;
  isAdapterReused: boolean;
  transporterId: string;
  connectionId?: number;
  isConnectionReused: boolean;
  poolConnectionCounter: number;
  poolActiveConnections: number;
  connectionAcquireMs: number;
  submissionMs: number;
  totalSmtpMs: number;
  accepted: boolean;
  responseSummary?: string;
  timestamp: string;
}

export interface EmailAdapter {
  sendOtp(to: string, otp: string): Promise<boolean>;
  sendPasswordReset(to: string, resetUrl: string): Promise<boolean>;
  /** Sends an already rendered email (account codes and notices). `meta.otp` is kept only by the dev outbox. */
  sendRendered?(to: string, email: RenderedEmail, meta: { kind: string; otp?: string }): Promise<boolean>;
  verifyConnection?(): Promise<{ success: boolean; error?: string }>;
  verifyDetailed?(): Promise<{
    success: boolean;
    timings: {
      tcpTlsMs: number;
      authGreetingMs: number;
      totalVerifyMs: number;
    };
    error?: string;
  }>;
  warmUp?(): Promise<boolean>;
  getLastMetrics?(): SmtpLifecycleMetrics | null;
  getPoolStats?(): { connectionCounter: number; activeConnections: number; availableConnections: number };
}

export interface SmtpConfig {
  host?: string;
  port?: number;
  secure?: boolean;
  user: string;
  pass: string;
  from?: string;
}

// No built-in sender mailbox (ISSUE-011): SMTP_USER must be configured; EMAIL_FROM defaults to it.
const DEFAULT_SENDER_NAME = "Ravinarayan ERP";

// In-memory mock storage for testing and offline development
export const mockSentEmails: EmailMessage[] = [];

export function clearMockSentEmails(): void {
  mockSentEmails.length = 0;
}

/**
 * Development-only "mail catcher": every message is written as a JSON file to a local directory
 * (one file per message, owner-only permissions). Lets the full login/OTP and password-reset flows
 * be exercised locally and in browser verification without a real mail server. Refused in production.
 */
export class OutboxEmailAdapter implements EmailAdapter {
  constructor(private readonly dir: string) {}

  private write(kind: string, message: Record<string, unknown>): boolean {
    fs.mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    const file = path.join(this.dir, `${Date.now()}_${crypto.randomBytes(3).toString("hex")}_${kind}.json`);
    fs.writeFileSync(file, JSON.stringify({ kind, ...message, timestamp: new Date().toISOString() }, null, 2), { mode: 0o600 });
    return true;
  }

  async sendOtp(to: string, otp: string): Promise<boolean> {
    const rendered = renderOtpEmail({ otp, recipientEmail: to, expiresInMinutes: 10 });
    return this.write("otp", { to, subject: rendered.subject, otp, text: rendered.text });
  }

  async sendPasswordReset(to: string, resetUrl: string): Promise<boolean> {
    return this.write("password_reset", { to, subject: "Ravinarayan ERP Password Reset Request", resetUrl });
  }

  async sendRendered(to: string, email: RenderedEmail, meta: { kind: string; otp?: string }): Promise<boolean> {
    return this.write(meta.kind, { to, subject: email.subject, ...(meta.otp ? { otp: meta.otp } : {}), text: email.text, html: email.html });
  }
}

/**
 * Test/Mock Email Adapter for local development and automated testing.
 * Never persists or exposes plain text secrets outside of test inspection.
 */
export class MockEmailAdapter implements EmailAdapter {
  public isReusedInstance = false;

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

  async sendRendered(to: string, email: RenderedEmail): Promise<boolean> {
    mockSentEmails.push({ to, subject: email.subject, html: email.html, text: email.text, timestamp: new Date().toISOString() });
    return true;
  }

  async warmUp(): Promise<boolean> {
    return true;
  }

  getLastMetrics(): SmtpLifecycleMetrics | null {
    return null;
  }

  getPoolStats() {
    return { connectionCounter: 0, activeConnections: 0, availableConnections: 0 };
  }
}

interface LastSendMeta {
  connId: number;
  reused: boolean;
  connectMs: number;
  submissionMs: number;
  accepted: boolean;
  response?: string;
}

/**
 * Production-ready Gmail SMTP Email Adapter using Nodemailer.
 * Uses smtp.gmail.com over TLS (port 465) or STARTTLS (port 587) with App Passwords.
 * Features structured SMTP lifecycle timing, pool connection reuse, and optional pre-warming.
 */
export class GmailSmtpEmailAdapter implements EmailAdapter {
  private transporter: Transporter;
  private from: string;
  private user: string;
  private pass: string;
  private host: string;
  private port: number;
  private secure: boolean;

  public readonly adapterId: string;
  public readonly transporterId: string;
  public readonly initTimestamp: string;
  public isReusedInstance = false;

  private latestMetrics: SmtpLifecycleMetrics | null = null;
  private lastSendMeta: LastSendMeta | null = null;
  private warmingPromise: Promise<boolean> | null = null;

  constructor(config: SmtpConfig, customTransporter?: Transporter) {
    if (!config.user || !config.pass) {
      throw new Error(
        "SMTP configuration error: SMTP_USER and SMTP_APP_PASSWORD are required for Gmail SMTP delivery."
      );
    }
    this.user = config.user;
    this.pass = config.pass;
    this.host = config.host || "smtp.gmail.com";
    this.port = config.port ?? 465;
    this.secure = config.secure ?? (this.port === 465);
    this.from = config.from || `${DEFAULT_SENDER_NAME} <${config.user}>`;

    this.adapterId = `adapter_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    this.transporterId = `txp_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    this.initTimestamp = new Date().toISOString();

    if (customTransporter) {
      this.transporter = customTransporter;
    } else {
      this.transporter = nodemailer.createTransport({
        host: this.host,
        port: this.port,
        secure: this.secure,
        pool: true,
        maxConnections: 3,
        maxMessages: 100,
        rateDelta: 1000,
        rateLimit: 5,
        idleTimeout: 120000, // 2 minutes (safely below Gmail idle disconnect limit)
        socketTimeout: 30000, // 30 seconds socket read/write timeout
        connectionTimeout: 15000, // 15 seconds connection acquisition timeout
        greetingTimeout: 10000, // 10 seconds greeting timeout
        auth: {
          user: config.user,
          pass: config.pass,
        },
        tls: {
          rejectUnauthorized: true,
        },
      });
    }

    // Attach structured timing hooks to the internal Nodemailer pool
    this.attachPoolInstrumentation();
  }

  private attachPoolInstrumentation(): void {
    const innerPool = (this.transporter as any)?.transporter;
    if (!innerPool || typeof innerPool._createConnection !== "function") {
      return;
    }

    const origCreate = innerPool._createConnection.bind(innerPool);
    innerPool._createConnection = () => {
      const resource = origCreate();
      const connId = resource.id;

      // Wrap resource.connect to record socket acquisition, greeting, and auth
      const origConnect = resource.connect.bind(resource);
      resource.connect = (cb: any) => {
        const connectStart = Date.now();
        return origConnect((err: any, res: any) => {
          resource._lastConnectMs = Date.now() - connectStart;
          return cb(err, res);
        });
      };

      // Wrap resource.send to record message transmission and detect socket reuse
      const origSend = resource.send.bind(resource);
      resource.send = (mail: any, cb: any) => {
        const reused = resource.messages > 0;
        const sendStart = Date.now();
        return origSend(mail, (err: any, info: any) => {
          const sendDuration = Date.now() - sendStart;
          this.lastSendMeta = {
            connId,
            reused,
            connectMs: resource._lastConnectMs || 0,
            submissionMs: sendDuration,
            accepted: Boolean(info && Array.isArray(info.accepted) && info.accepted.length > 0),
            response: typeof info?.response === "string" ? info.response.slice(0, 100).trim() : undefined,
          };
          return cb(err, info);
        });
      };

      return resource;
    };
  }

  async sendOtp(to: string, otp: string): Promise<boolean> {
    const t0 = Date.now();
    this.lastSendMeta = null;
    const innerPool = (this.transporter as any)?.transporter;
    const poolStatsBefore = {
      counter: innerPool?._connectionCounter || 0,
      active: innerPool?._connections?.length || 0,
    };

    try {
      const rendered = renderOtpEmail({ otp, recipientEmail: to, expiresInMinutes: 10 });
      const info = await this.transporter.sendMail({
        from: this.from,
        to,
        subject: rendered.subject,
        text: rendered.text,
        html: rendered.html,
      });

      const totalSmtpMs = Date.now() - t0;
      const sendMeta = this.lastSendMeta as LastSendMeta | null;
      const accepted = Boolean(info && Array.isArray(info.accepted) && info.accepted.length > 0);
      const isReused = Boolean(sendMeta?.reused);
      const connAcquireMs = isReused ? 0 : (sendMeta?.connectMs || 0);
      const submissionMs = sendMeta?.submissionMs ?? (totalSmtpMs - connAcquireMs);

      this.latestMetrics = {
        adapterId: this.adapterId,
        isAdapterReused: this.isReusedInstance,
        transporterId: this.transporterId,
        connectionId: sendMeta?.connId,
        isConnectionReused: isReused,
        poolConnectionCounter: innerPool?._connectionCounter || poolStatsBefore.counter,
        poolActiveConnections: innerPool?._connections?.length || poolStatsBefore.active,
        connectionAcquireMs: connAcquireMs,
        submissionMs,
        totalSmtpMs,
        accepted,
        responseSummary: sendMeta?.response || (accepted ? "250 OK" : "Rejected"),
        timestamp: new Date().toISOString(),
      };

      // Structured logging without secrets
      console.log(
        `[SMTP Delivery] cid=#${this.latestMetrics.connectionId || 1} | reused=${isReused} | acquire=${connAcquireMs}ms | submission=${submissionMs}ms | total=${totalSmtpMs}ms | accepted=${accepted}`
      );

      return accepted;
    } catch (err: any) {
      const totalSmtpMs = Date.now() - t0;
      console.error(
        `[SMTP Delivery Error] Failed after ${totalSmtpMs}ms:`,
        err?.message || "Unknown SMTP transport error"
      );
      return false;
    }
  }

  async sendRendered(to: string, email: RenderedEmail, meta: { kind: string }): Promise<boolean> {
    try {
      const info = await this.transporter.sendMail({ from: this.from, to, subject: email.subject, text: email.text, html: email.html });
      return Boolean(info && Array.isArray(info.accepted) && info.accepted.length > 0);
    } catch (err: any) {
      console.error(`[SMTP Delivery Error] Failed to send ${meta.kind} email:`, err?.message || "Unknown SMTP transport error");
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

  /**
   * Diagnostic verification helper that measures individual SMTP stages
   * (TCP/TLS connect, EHLO greeting, AUTH LOGIN) without sending an email.
   */
  async verifyDetailed(): Promise<{
    success: boolean;
    timings: {
      tcpTlsMs: number;
      authGreetingMs: number;
      totalVerifyMs: number;
    };
    error?: string;
  }> {
    const v0 = Date.now();
    try {
      // Direct fine-grained measurement using SMTPConnection
      const SMTPConnection = require(require.resolve("nodemailer/lib/smtp-connection", { paths: [process.cwd()] }));
      const conn = new SMTPConnection({
        host: this.host,
        port: this.port,
        secure: this.secure,
        tls: { rejectUnauthorized: true },
      });

      const tConnectStart = Date.now();
      await new Promise<void>((resolve, reject) => {
        conn.connect((err: any) => {
          if (err) return reject(err);
          resolve();
        });
      });
      const tcpTlsMs = Date.now() - tConnectStart;

      const tAuthStart = Date.now();
      await new Promise<void>((resolve, reject) => {
        conn.login({ user: this.user, pass: this.pass }, (err: any) => {
          if (err) return reject(err);
          resolve();
        });
      });
      const authGreetingMs = Date.now() - tAuthStart;

      conn.quit();
      const totalVerifyMs = Date.now() - v0;

      return {
        success: true,
        timings: {
          tcpTlsMs,
          authGreetingMs,
          totalVerifyMs,
        },
      };
    } catch (err: any) {
      try {
        await this.transporter.verify();
        const totalVerifyMs = Date.now() - v0;
        return {
          success: true,
          timings: {
            tcpTlsMs: 0,
            authGreetingMs: totalVerifyMs,
            totalVerifyMs,
          },
        };
      } catch (fallbackErr: any) {
        return {
          success: false,
          timings: {
            tcpTlsMs: 0,
            authGreetingMs: 0,
            totalVerifyMs: Date.now() - v0,
          },
          error: fallbackErr?.message || err?.message || "Verification failed",
        };
      }
    }
  }

  /**
   * Safe background pre-warming for SMTP connection pool.
   * Ensures an authenticated connection is standing by in the pool,
   * eliminating connection acquisition overhead from user OTP requests.
   */
  async warmUp(): Promise<boolean> {
    const innerPool = (this.transporter as any)?.transporter;
    if (!innerPool || innerPool._closed || typeof innerPool._createConnection !== "function") {
      return false;
    }

    const hasAvailable =
      Array.isArray(innerPool._connections) &&
      innerPool._connections.some((c: any) => c.available && c._connected);
    if (hasAvailable) {
      return true;
    }

    if (this.warmingPromise) {
      return this.warmingPromise;
    }

    this.warmingPromise = (async () => {
      try {
        const conn = innerPool._createConnection();
        await new Promise<void>((resolve, reject) => {
          conn.connect((err: any) => {
            if (err) return reject(err);
            conn.available = true;
            conn._startIdleTimer();
            conn.emit("available");
            resolve();
          });
        });
        return true;
      } catch (err: any) {
        console.warn("[SMTP Warmup] Non-fatal warmup failure:", err?.message || "Connection failed");
        return false;
      } finally {
        this.warmingPromise = null;
      }
    })();

    return this.warmingPromise;
  }

  getLastMetrics(): SmtpLifecycleMetrics | null {
    return this.latestMetrics;
  }

  getPoolStats(): { connectionCounter: number; activeConnections: number; availableConnections: number } {
    const innerPool = (this.transporter as any)?.transporter;
    if (!innerPool || !Array.isArray(innerPool._connections)) {
      return { connectionCounter: 0, activeConnections: 0, availableConnections: 0 };
    }
    const available = innerPool._connections.filter((c: any) => c.available && c._connected).length;
    return {
      connectionCounter: innerPool._connectionCounter || 0,
      activeConnections: innerPool._connections.length,
      availableConnections: available,
    };
  }
}

interface GlobalEmailContext {
  _rnActiveEmailAdapter?: EmailAdapter | null;
}

const globalForEmail = globalThis as unknown as GlobalEmailContext;

/**
 * Email over HTTPS (Brevo or Resend). Hosts that block outgoing SMTP ports (e.g. Render's free
 * instances block 25/465/587) can still send: the request goes to the provider's API on port 443.
 *   EMAIL_ADAPTER=brevo  + BREVO_API_KEY   (sender address verified in Brevo)
 *   EMAIL_ADAPTER=resend + RESEND_API_KEY  (sender domain verified in Resend)
 *   EMAIL_FROM="Ravinarayan ERP <sender@example.com>"
 * Errors are logged without the key or message content.
 */
export class HttpApiEmailAdapter implements EmailAdapter {
  private readonly fromName: string;
  private readonly fromEmail: string;

  constructor(private readonly provider: "brevo" | "resend", private readonly apiKey: string, from: string) {
    const m = /^\s*"?([^"<]*?)"?\s*<\s*([^>\s]+)\s*>\s*$/.exec(from);
    this.fromName = (m ? m[1] : "").trim() || DEFAULT_SENDER_NAME;
    this.fromEmail = (m ? m[2] : from).trim();
  }

  private async post(to: string, subject: string, html: string, text: string, kind: string): Promise<boolean> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15000);
    try {
      const res =
        this.provider === "brevo"
          ? await fetch("https://api.brevo.com/v3/smtp/email", {
              method: "POST",
              headers: { "api-key": this.apiKey, "content-type": "application/json", accept: "application/json" },
              body: JSON.stringify({ sender: { name: this.fromName, email: this.fromEmail }, to: [{ email: to }], subject, htmlContent: html, textContent: text }),
              signal: ctrl.signal,
            })
          : await fetch("https://api.resend.com/emails", {
              method: "POST",
              headers: { authorization: `Bearer ${this.apiKey}`, "content-type": "application/json" },
              body: JSON.stringify({ from: `${this.fromName} <${this.fromEmail}>`, to: [to], subject, html, text }),
              signal: ctrl.signal,
            });
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        console.error(`[Email API Error] ${this.provider} rejected ${kind} email: HTTP ${res.status} ${detail.slice(0, 200)}`);
        return false;
      }
      return true;
    } catch (err: any) {
      console.error(`[Email API Error] ${this.provider} ${kind} email failed:`, err?.name === "AbortError" ? "timed out" : err?.message || "network error");
      return false;
    } finally {
      clearTimeout(timer);
    }
  }

  async sendOtp(to: string, otp: string): Promise<boolean> {
    const r = renderOtpEmail({ otp, recipientEmail: to, expiresInMinutes: 10 });
    return this.post(to, r.subject, r.html, r.text, "otp");
  }

  async sendPasswordReset(to: string, resetUrl: string): Promise<boolean> {
    return this.post(
      to,
      "Ravinarayan ERP Password Reset Request",
      `<p>A password reset was requested for your account.</p><p><a href="${resetUrl}">Click here to reset your password</a></p><p>This link expires in 1 hour.</p>`,
      `Reset your password at: ${resetUrl}. Valid for 1 hour.`,
      "password_reset"
    );
  }

  async sendRendered(to: string, email: RenderedEmail, meta: { kind: string }): Promise<boolean> {
    return this.post(to, email.subject, email.html, email.text, meta.kind);
  }

  async warmUp(): Promise<boolean> {
    return true;
  }
}

export function getEmailAdapter(): EmailAdapter {
  if (globalForEmail._rnActiveEmailAdapter) {
    if ("isReusedInstance" in (globalForEmail._rnActiveEmailAdapter as any)) {
      (globalForEmail._rnActiveEmailAdapter as any).isReusedInstance = true;
    }
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

  // 1b. Development outbox (local mail catcher): writes each message to ERP_EMAIL_OUTBOX_DIR.
  if (adapterType === "outbox") {
    if (isProd) {
      throw new Error("Configuration error: the outbox email adapter is strictly forbidden in production environments.");
    }
    const dir = process.env.ERP_EMAIL_OUTBOX_DIR?.trim();
    if (!dir) {
      throw new Error("Configuration error: ERP_EMAIL_OUTBOX_DIR is required when EMAIL_ADAPTER=outbox.");
    }
    globalForEmail._rnActiveEmailAdapter = new OutboxEmailAdapter(dir);
    return globalForEmail._rnActiveEmailAdapter;
  }

  // 2. Automated test suite default (unless testing SMTP explicitly)
  if (isTest && adapterType !== "smtp") {
    globalForEmail._rnActiveEmailAdapter = new MockEmailAdapter();
    return globalForEmail._rnActiveEmailAdapter;
  }

  // 2b. Email over HTTPS (for hosts that block SMTP ports)
  if (adapterType === "brevo" || adapterType === "resend") {
    const key = (adapterType === "brevo" ? process.env.BREVO_API_KEY : process.env.RESEND_API_KEY)?.trim();
    const from = (process.env.EMAIL_FROM || "").trim();
    if (!key) throw new Error(`Email configuration error: ${adapterType === "brevo" ? "BREVO_API_KEY" : "RESEND_API_KEY"} is required when EMAIL_ADAPTER=${adapterType}.`);
    if (!from) throw new Error(`Email configuration error: EMAIL_FROM (a sender verified in ${adapterType}) is required when EMAIL_ADAPTER=${adapterType}.`);
    globalForEmail._rnActiveEmailAdapter = new HttpApiEmailAdapter(adapterType, key, from);
    return globalForEmail._rnActiveEmailAdapter;
  }

  // 3. SMTP configuration parameters
  const smtpUser = (process.env.SMTP_USER || "").trim();
  const smtpPass = process.env.SMTP_APP_PASSWORD || process.env.SMTP_PASS || "";
  const smtpHost = process.env.SMTP_HOST || "smtp.gmail.com";
  const smtpPort = parseInt(process.env.SMTP_PORT || "465", 10);
  const smtpSecure =
    process.env.SMTP_SECURE !== undefined
      ? process.env.SMTP_SECURE === "true"
      : smtpPort === 465;
  const emailFrom = process.env.EMAIL_FROM || (smtpUser ? `${DEFAULT_SENDER_NAME} <${smtpUser}>` : undefined);

  // 4. Explicit SMTP selection
  if (adapterType === "smtp" || adapterType === "gmail") {
    if (!smtpUser) {
      throw new Error("Email configuration error: SMTP_USER is required when EMAIL_ADAPTER=smtp.");
    }
    if (!smtpPass) {
      throw new Error(
        "Email configuration error: SMTP_APP_PASSWORD is required when EMAIL_ADAPTER=smtp."
      );
    }
    const adapter = new GmailSmtpEmailAdapter({
      host: smtpHost,
      port: smtpPort,
      secure: smtpSecure,
      user: smtpUser,
      pass: smtpPass,
      from: emailFrom,
    });
    // Trigger non-blocking pool warmup
    if (!isTest) {
      adapter.warmUp().catch(() => {});
    }
    globalForEmail._rnActiveEmailAdapter = adapter;
    return globalForEmail._rnActiveEmailAdapter;
  }

  // 5. Production requirement: must configure real email delivery
  if (isProd) {
    if (!smtpPass) {
      throw new Error(
        "Email configuration error: Production requires valid SMTP_APP_PASSWORD for Gmail SMTP delivery."
      );
    }
    const adapter = new GmailSmtpEmailAdapter({
      host: smtpHost,
      port: smtpPort,
      secure: smtpSecure,
      user: smtpUser,
      pass: smtpPass,
      from: emailFrom,
    });
    adapter.warmUp().catch(() => {});
    globalForEmail._rnActiveEmailAdapter = adapter;
    return globalForEmail._rnActiveEmailAdapter;
  }

  // 6. Local development: use SMTP if password is provided, otherwise fall back to mock
  if (smtpPass) {
    const adapter = new GmailSmtpEmailAdapter({
      host: smtpHost,
      port: smtpPort,
      secure: smtpSecure,
      user: smtpUser,
      pass: smtpPass,
      from: emailFrom,
    });
    if (!isTest) {
      adapter.warmUp().catch(() => {});
    }
    globalForEmail._rnActiveEmailAdapter = adapter;
    return globalForEmail._rnActiveEmailAdapter;
  }

  globalForEmail._rnActiveEmailAdapter = new MockEmailAdapter();
  return globalForEmail._rnActiveEmailAdapter;
}

export function setEmailAdapterForTesting(adapter: EmailAdapter | null): void {
  globalForEmail._rnActiveEmailAdapter = adapter;
}
