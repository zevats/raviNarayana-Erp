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

// In-memory mock storage for testing
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
 * Resend Email Adapter using native fetch (zero extra dependencies).
 */
export class ResendEmailAdapter implements EmailAdapter {
  private apiKey: string;
  private from: string;

  constructor(apiKey: string, from = "Ravinarayan ERP <auth@ravinarayan.in>") {
    this.apiKey = apiKey;
    this.from = from;
  }

  async sendOtp(to: string, otp: string): Promise<boolean> {
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: this.from,
          to: [to],
          subject: "Your Ravinarayan ERP Verification Code",
          text: `Your 6-digit verification code is: ${otp}. Valid for 10 minutes.`,
          html: `<p>Your 6-digit verification code is: <strong>${otp}</strong>.</p><p>This code expires in 10 minutes. Do not share it with anyone.</p>`,
        }),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  async sendPasswordReset(to: string, resetUrl: string): Promise<boolean> {
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: this.from,
          to: [to],
          subject: "Ravinarayan ERP Password Reset Request",
          text: `Reset your password at: ${resetUrl}. Valid for 1 hour.`,
          html: `<p>A password reset was requested for your account.</p><p><a href="${resetUrl}">Click here to reset your password</a></p><p>This link expires in 1 hour.</p>`,
        }),
      });
      return res.ok;
    } catch {
      return false;
    }
  }
}

let activeAdapter: EmailAdapter | null = null;

export function getEmailAdapter(): EmailAdapter {
  if (activeAdapter) {
    return activeAdapter;
  }

  if (process.env.NODE_ENV === "test" || process.env.EMAIL_ADAPTER === "mock" || !process.env.RESEND_API_KEY) {
    activeAdapter = new MockEmailAdapter();
    return activeAdapter;
  }

  activeAdapter = new ResendEmailAdapter(process.env.RESEND_API_KEY, process.env.EMAIL_FROM);
  return activeAdapter;
}

export function setEmailAdapterForTesting(adapter: EmailAdapter | null): void {
  activeAdapter = adapter;
}
