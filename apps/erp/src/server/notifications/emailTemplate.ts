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
  /** Minutes the code works for (shown under the code). */
  codeMinutes?: number;
  button?: { label: string; url: string };
  details?: Array<[string, string]>;
  /** The short "Not you?" line. */
  note?: string;
}

/** The shared layout: the original Ravinarayan design (forest header, gold line, white card). */
export function brandEmail(o: BrandEmailOptions): string {
  const F = FONT;
  const lines = (o.lines || []).map((l) => `<p style="margin:0 0 8px 0;font-size:14px;line-height:22px;color:#445448;">${l}</p>`).join("");
  const code = o.code
    ? `<tr><td align="center" style="padding:12px 0 8px 0;">
          <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color:#FAF9F6;border:1px solid #D5CEBF;border-radius:12px;">
            <tr><td align="center" style="padding:24px 16px 20px 16px;">
              <div style="font-size:11px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;color:#654735;margin-bottom:8px;">Your code</div>
              <div class="otp-display" style="font-family:'Courier New',Courier,Consolas,monospace;font-size:38px;font-weight:700;letter-spacing:12px;text-indent:12px;color:#1A2E20;line-height:1.2;">${escapeHtml(o.code)}</div>
              <div style="margin-top:12px;font-size:12px;font-weight:500;color:#5D7656;">Valid for ${o.codeMinutes || 10} minutes</div>
            </td></tr>
          </table>
        </td></tr>`
    : "";
  const button = o.button
    ? `<tr><td align="center" style="padding:16px 0 8px 0;">
          <table role="presentation" border="0" cellpadding="0" cellspacing="0"><tr>
            <td style="border-radius:10px;background-color:#1A2E20;">
              <a href="${escapeHtml(o.button.url)}" style="display:inline-block;padding:14px 30px;font-family:${F};font-size:15px;font-weight:700;color:#FFFFFF;text-decoration:none;border-radius:10px;">${escapeHtml(o.button.label)}</a>
            </td>
          </tr></table>
        </td></tr>`
    : "";
  const details = (o.details || []).length
    ? `<tr><td style="padding-top:16px;">
          <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="border-top:1px solid #E6E0D2;">
            ${(o.details || [])
              .map(
                ([k, v]) => `<tr>
              <td style="padding:10px 0 0 0;font-size:13px;color:#738475;width:36%;vertical-align:top;">${escapeHtml(k)}</td>
              <td style="padding:10px 0 0 0;font-size:13px;color:#1A2E20;font-weight:600;vertical-align:top;">${escapeHtml(v)}</td>
            </tr>`
              )
              .join("")}
          </table>
        </td></tr>`
    : "";
  const note = o.note
    ? `<tr><td style="padding-top:22px;">
          <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
            <tr><td style="padding:14px 16px;background-color:#F8F5EE;border-left:3px solid #B58A57;border-radius:4px;font-size:12px;line-height:18px;color:#5B6B5F;">${escapeHtml(o.note)}</td></tr>
          </table>
        </td></tr>`
    : "";
  return `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" lang="en">
<head>
  <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="x-apple-disable-message-reformatting" />
  <meta name="color-scheme" content="light" />
  <meta name="supported-color-schemes" content="light" />
  <title>${escapeHtml(o.subject)}</title>
  <style type="text/css">
    body, table, td, a { -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
    table, td { mso-table-lspace: 0pt; mso-table-rspace: 0pt; }
    body { margin: 0; padding: 0; width: 100% !important; background-color: #FAF8F5; }
    @media only screen and (max-width: 620px) {
      .container-table { width: 100% !important; max-width: 100% !important; }
      .content-cell { padding: 26px 20px !important; }
      .otp-display { font-size: 30px !important; letter-spacing: 8px !important; }
    }
  </style>
</head>
<body style="margin:0;padding:0;background-color:#FAF8F5;font-family:${F};-webkit-font-smoothing:antialiased;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escapeHtml(o.preheader)}${"&#8199;&#65279;&#847; ".repeat(40)}</div>
  <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color:#FAF8F5;width:100%;">
    <tr><td align="center" style="padding:40px 16px 48px 16px;">
      <table role="presentation" class="container-table" border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width:580px;width:100%;background-color:#FFFFFF;border-radius:16px;border:1px solid #E6E0D2;overflow:hidden;">
        <tr><td style="background-color:#1A2E20;padding:28px 32px;text-align:center;">
          <h1 style="margin:0;font-size:24px;font-weight:700;color:#FFFFFF;letter-spacing:-0.02em;font-family:Georgia,'Times New Roman',serif;">Ravinarayan</h1>
          <p style="margin:6px 0 0 0;font-size:11px;font-weight:700;letter-spacing:0.18em;text-transform:uppercase;color:#C89F6B;">PG &amp; Tiffin</p>
        </td></tr>
        <tr><td height="3" style="background-color:#B58A57;line-height:3px;font-size:3px;">&nbsp;</td></tr>
        <tr><td class="content-cell" style="padding:36px 36px 32px 36px;font-family:${F};">
          <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
            <tr><td style="padding-bottom:12px;">
              <h2 style="margin:0;font-size:20px;font-weight:700;color:#1A2E20;letter-spacing:-0.01em;">${escapeHtml(o.title)}</h2>
            </td></tr>
            <tr><td>${lines}</td></tr>
            ${code}
            ${button}
            ${details}
            ${note}
          </table>
        </td></tr>
        <tr><td height="1" style="background-color:#E6E0D2;line-height:1px;font-size:1px;">&nbsp;</td></tr>
        <tr><td style="background-color:#FAF8F5;padding:20px 36px;text-align:center;font-family:${F};font-size:11px;line-height:17px;color:#738475;">
          Ravinarayan PG &amp; Tiffin
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

/** The plain-text part: the same words, no markup. */
export function brandText(o: { title: string; lines?: string[]; code?: string; codeMinutes?: number; button?: { label: string; url: string }; details?: Array<[string, string]>; note?: string }): string {
  const plain = (s: string) => s.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&#039;/g, "'").replace(/&quot;/g, '"');
  return [
    "Ravinarayan",
    "",
    o.title,
    "",
    ...(o.lines || []).map(plain),
    ...(o.code ? ["", o.code, `Valid for ${o.codeMinutes || 10} minutes`, ""] : []),
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
    lines: ["Use this code to sign in."],
    code,
    codeMinutes: minutes,
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
