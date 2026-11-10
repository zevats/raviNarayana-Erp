/**
 * Ravinarayan transactional emails: one design for every message (sign-in codes, password reset,
 * account codes and notices). Built for delivery and for every mail app:
 * - table layout with inline styles, a plain-text part with the same words, no images (text
 *   wordmark), one clear action, no tracking links;
 * - the code is in the subject and the inbox preview line, so it shows in the phone notification;
 * - short wording: what it is, the code or the button, when it expires, and "not you?".
 */

export interface OtpEmailProps {
  otp: string;
  recipientEmail?: string;
  expiresInMinutes?: number;
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

/** Escapes HTML characters to prevent markup injection in email clients. */
export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/** Brand palette (the ERP's forest theme on an ivory canvas). */
export const EMAIL_COLORS = {
  canvas: "#F2F0E9",
  card: "#FFFFFF",
  line: "#E7E2D6",
  ink: "#1A2E20",
  body: "#3A403C",
  muted: "#6B716C",
  forest: "#1E3A2B",
  tint: "#EEF3EA",
  gold: "#B58A57",
  ivory: "#FAF8F5",
};
const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const MONO = "'SF Mono', Menlo, Consolas, 'Roboto Mono', monospace";

export interface BrandEmailOptions {
  subject: string;
  /** Inbox preview line (shown in notifications next to the subject). */
  preheader: string;
  title: string;
  /** One or two short lines under the title (already escaped HTML allowed). */
  lines?: string[];
  code?: string;
  button?: { label: string; url: string };
  details?: Array<[string, string]>;
  /** The short "Not you?" line. */
  note?: string;
}

/** The shared layout. */
export function brandEmail(o: BrandEmailOptions): string {
  const C = EMAIL_COLORS;
  const lines = (o.lines || []).map((l) => `<p style="margin:0 0 10px 0;font-family:${FONT};font-size:15px;line-height:23px;color:${C.body};">${l}</p>`).join("");
  const code = o.code
    ? `<tr><td style="padding:22px 0 6px 0;">
        <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color:${C.tint};border-radius:16px;">
          <tr><td align="center" style="padding:22px 12px;font-family:${MONO};font-size:36px;line-height:40px;font-weight:700;letter-spacing:10px;color:${C.forest};">${escapeHtml(o.code)}</td></tr>
        </table>
      </td></tr>`
    : "";
  const button = o.button
    ? `<tr><td style="padding:22px 0 4px 0;">
        <table role="presentation" border="0" cellpadding="0" cellspacing="0"><tr>
          <td style="border-radius:999px;background-color:${C.forest};">
            <a href="${escapeHtml(o.button.url)}" style="display:inline-block;padding:14px 28px;font-family:${FONT};font-size:15px;font-weight:600;color:#FFFFFF;text-decoration:none;border-radius:999px;">${escapeHtml(o.button.label)}</a>
          </td>
        </tr></table>
      </td></tr>`
    : "";
  const details = (o.details || []).length
    ? `<tr><td style="padding:22px 0 0 0;">
        <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="border-top:1px solid ${C.line};">
          ${(o.details || [])
            .map(
              ([k, v]) => `<tr>
            <td style="padding:12px 0 0 0;font-family:${FONT};font-size:13px;color:${C.muted};width:36%;vertical-align:top;">${escapeHtml(k)}</td>
            <td style="padding:12px 0 0 0;font-family:${FONT};font-size:13px;color:${C.ink};font-weight:600;vertical-align:top;">${escapeHtml(v)}</td>
          </tr>`
            )
            .join("")}
        </table>
      </td></tr>`
    : "";
  const note = o.note ? `<tr><td style="padding:24px 0 0 0;font-family:${FONT};font-size:13px;line-height:20px;color:${C.muted};">${escapeHtml(o.note)}</td></tr>` : "";
  return `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="x-apple-disable-message-reformatting" />
  <meta name="color-scheme" content="light only" />
  <meta name="supported-color-schemes" content="light" />
  <title>${escapeHtml(o.subject)}</title>
</head>
<body style="margin:0;padding:0;background-color:${C.canvas};-webkit-font-smoothing:antialiased;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escapeHtml(o.preheader)}${"&#8199;&#65279;&#847; ".repeat(40)}</div>
  <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color:${C.canvas};">
    <tr><td align="center" style="padding:36px 14px;">
      <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width: 520px;">
        <tr><td style="padding:0 6px 18px 6px;font-family:${FONT};font-size:20px;font-weight:700;letter-spacing:-0.4px;color:${C.ink};">
          Ravinarayan<span style="color:${C.gold};">.</span>
        </td></tr>
        <tr><td style="background-color:${C.card};border:1px solid ${C.line};border-radius:22px;padding:32px 30px;">
          <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
            <tr><td style="padding:0 0 12px 0;font-family:${FONT};font-size:22px;line-height:28px;font-weight:600;letter-spacing:-0.3px;color:${C.ink};">${escapeHtml(o.title)}</td></tr>
            <tr><td>${lines}</td></tr>
            ${code}
            ${button}
            ${details}
            ${note}
          </table>
        </td></tr>
        <tr><td align="center" style="padding:18px 8px 0 8px;font-family:${FONT};font-size:12px;line-height:18px;color:${C.muted};">
          Ravinarayan PG &amp; Tiffin
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

/** The plain-text part: the same words, no markup. */
export function brandText(o: { title: string; lines?: string[]; code?: string; button?: { label: string; url: string }; details?: Array<[string, string]>; note?: string }): string {
  const plain = (s: string) => s.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&#039;/g, "'").replace(/&quot;/g, '"');
  return [
    "Ravinarayan",
    "",
    o.title,
    "",
    ...(o.lines || []).map(plain),
    ...(o.code ? ["", o.code, ""] : []),
    ...(o.button ? ["", `${o.button.label}: ${o.button.url}`, ""] : []),
    ...(o.details || []).map(([k, v]) => `${k}: ${v}`),
    ...(o.note ? ["", o.note] : []),
    "",
    "Ravinarayan PG & Tiffin",
  ].join("\n");
}

/** Sign-in code. The code leads the subject and the preview line, so it shows in the notification. */
export function renderOtpEmail(props: OtpEmailProps): RenderedEmail {
  const code = props.otp.trim();
  const minutes = props.expiresInMinutes || 10;
  const subject = `${code} is your Ravinarayan sign-in code`;
  const body = {
    title: "Your sign-in code",
    lines: [`Expires in ${minutes} minutes.`],
    code,
    note: "Not you? Ignore this email. Never share this code.",
  };
  return {
    subject,
    html: brandEmail({ subject, preheader: `${code} · expires in ${minutes} minutes`, ...body }),
    text: brandText(body),
  };
}

/** Password reset link. */
export function renderPasswordResetEmail(resetUrl: string): RenderedEmail {
  const subject = "Reset your Ravinarayan password";
  const body = {
    title: "Reset your password",
    lines: ["This link expires in 1 hour."],
    button: { label: "Set a new password", url: resetUrl },
    note: "Not you? Ignore this email. Your password stays the same.",
  };
  return {
    subject,
    html: brandEmail({ subject, preheader: "Set a new password · link expires in 1 hour", ...body }),
    text: brandText(body),
  };
}
