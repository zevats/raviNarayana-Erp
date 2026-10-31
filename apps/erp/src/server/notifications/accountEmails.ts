import { escapeHtml, RenderedEmail } from "./emailTemplate";

/**
 * Branded emails for self-service account changes: the verification codes (password change,
 * email change to the current and to the new address) and the notices sent once a change is done.
 * Table layout with inline styles so they render the same in Gmail, Outlook and phone mail apps.
 */

export type AccountCodePurpose = "PASSWORD" | "EMAIL_CURRENT" | "EMAIL_NEW";
export type AccountNoticeKind = "PASSWORD_CHANGED" | "EMAIL_CHANGED_OLD" | "EMAIL_CHANGED_NEW" | "DEVICES_SIGNED_OUT";

export interface AccountEmailContext {
  name: string;
  /** e.g. "Chrome on Android" — the device the change was made from. */
  device?: string | null;
  /** The address the account is moving to (email change). */
  newEmail?: string | null;
  when?: Date;
}

const C = {
  page: "#F4F0E8",
  card: "#FFFFFF",
  line: "#ECE6DB",
  ink: "#1F2320",
  body: "#3E4540",
  muted: "#6E7F70",
  forest: "#263B2D",
  gold: "#C89F6B",
  orange: "#C9501C",
  tint: "#FCE9DD",
  soft: "#F8F5EE",
};

const istTime = (d: Date) =>
  new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "long", year: "numeric", hour: "numeric", minute: "2-digit" }).format(d);

function detailRows(rows: Array<[string, string]>): string {
  return rows
    .map(
      ([k, v]) => `<tr>
        <td style="padding:8px 0;font-size:13px;color:${C.muted};width:38%;vertical-align:top;">${escapeHtml(k)}</td>
        <td style="padding:8px 0;font-size:13px;color:${C.ink};font-weight:600;vertical-align:top;">${escapeHtml(v)}</td>
      </tr>`
    )
    .join("");
}

function layout(opts: { subject: string; preheader: string; title: string; intro: string; code?: string; details: Array<[string, string]>; warning: string }): string {
  const codeBlock = opts.code
    ? `<tr><td align="center" style="padding:8px 0 24px 0;">
        <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color:${C.tint};border-radius:14px;">
          <tr><td align="center" style="padding:22px 16px 18px 16px;">
            <div style="font-size:11px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:#B4440F;margin-bottom:8px;">Your code</div>
            <div style="font-family:'SFMono-Regular',Consolas,'Courier New',monospace;font-size:36px;font-weight:700;letter-spacing:10px;text-indent:10px;color:${C.ink};line-height:1.2;">${escapeHtml(opts.code)}</div>
            <div style="margin-top:10px;font-size:12px;color:${C.body};">Works for 10 minutes &bull; Use it once</div>
          </td></tr>
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
  <title>${escapeHtml(opts.subject)}</title>
  <style type="text/css">
    body, table, td, a { -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
    table, td { mso-table-lspace: 0pt; mso-table-rspace: 0pt; }
    body { margin: 0; padding: 0; width: 100% !important; background-color: ${C.page}; }
    @media only screen and (max-width: 620px) {
      .rn-card { width: 100% !important; }
      .rn-pad { padding: 24px 20px !important; }
    }
  </style>
</head>
<body style="margin:0;padding:0;background-color:${C.page};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:${C.page};">${escapeHtml(opts.preheader)}</div>
  <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color:${C.page};">
    <tr><td align="center" style="padding:32px 16px 40px 16px;">
      <table role="presentation" class="rn-card" border="0" cellpadding="0" cellspacing="0" width="560" style="max-width:560px;width:100%;">
        <tr><td style="padding:0 4px 16px 4px;">
          <table role="presentation" border="0" cellpadding="0" cellspacing="0"><tr>
            <td width="36" height="36" align="center" valign="middle" style="width:36px;height:36px;background-color:${C.forest};border-radius:10px;color:${C.gold};font-family:Georgia,'Times New Roman',serif;font-size:18px;font-weight:700;line-height:36px;">R</td>
            <td style="padding-left:10px;font-family:Georgia,'Times New Roman',serif;font-size:19px;font-weight:700;color:${C.forest};letter-spacing:-0.01em;">Ravinarayan</td>
          </tr></table>
        </td></tr>
        <tr><td style="background-color:${C.card};border:1px solid ${C.line};border-radius:18px;">
          <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
            <tr><td class="rn-pad" style="padding:32px 32px 28px 32px;">
              <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
                <tr><td style="padding-bottom:12px;">
                  <h1 style="margin:0;font-size:21px;line-height:28px;font-weight:700;color:${C.ink};letter-spacing:-0.01em;">${escapeHtml(opts.title)}</h1>
                </td></tr>
                <tr><td style="padding-bottom:20px;font-size:14px;line-height:22px;color:${C.body};">${opts.intro}</td></tr>
                ${codeBlock}
                <tr><td style="border-top:1px solid ${C.line};padding-top:8px;">
                  <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">${detailRows(opts.details)}</table>
                </td></tr>
                <tr><td style="padding-top:20px;">
                  <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color:${C.soft};border-radius:12px;">
                    <tr><td style="padding:14px 16px;font-size:12px;line-height:18px;color:${C.body};"><strong style="color:${C.ink};">Not you?</strong> ${escapeHtml(opts.warning)}</td></tr>
                  </table>
                </td></tr>
              </table>
            </td></tr>
          </table>
        </td></tr>
        <tr><td align="center" style="padding:18px 8px 0 8px;font-size:11px;line-height:17px;color:${C.muted};">
          Sent by Ravinarayan PG &amp; Tiffin because of a change to your staff account.<br />Ravinarayan staff will never ask you for this code.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function textVersion(title: string, introText: string, code: string | undefined, details: Array<[string, string]>, warning: string): string {
  return [
    "Ravinarayan",
    "",
    title,
    "",
    introText,
    ...(code ? ["", `Your code: ${code}`, "Works for 10 minutes. Use it once."] : []),
    "",
    ...details.map(([k, v]) => `${k}: ${v}`),
    "",
    `Not you? ${warning}`,
    "",
    "Ravinarayan staff will never ask you for this code.",
  ].join("\n");
}

const strip = (html: string) => html.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&");

/** Verification code for a password or email change. */
export function renderAccountCodeEmail(purpose: AccountCodePurpose, code: string, ctx: AccountEmailContext): RenderedEmail {
  const name = escapeHtml(ctx.name || "there");
  const when = istTime(ctx.when || new Date());
  const copy = {
    PASSWORD: {
      subject: `${code} is your code to change your password`,
      title: "Confirm your new password",
      intro: `Hi ${name}, someone asked to change the password of your Ravinarayan account. Enter this code to confirm it.`,
      warning: "Do not share the code. Your password stays the same until the code is entered. Tell your manager right away.",
    },
    EMAIL_CURRENT: {
      subject: `${code} is your code to change your email`,
      title: "Confirm the email change",
      intro: `Hi ${name}, someone asked to move your Ravinarayan account to <strong style="color:${C.ink};">${escapeHtml(ctx.newEmail || "a new address")}</strong>. Enter this code together with the one sent to the new address.`,
      warning: "Do not share the code. Your email stays the same until both codes are entered. Tell your manager right away.",
    },
    EMAIL_NEW: {
      subject: `${code} is your code to confirm this email`,
      title: "Confirm your new email",
      intro: `Hi ${name}, this address is being added to your Ravinarayan staff account. Enter this code together with the one sent to your current email.`,
      warning: "If you do not work with Ravinarayan, ignore this email. Nothing changes without the code.",
    },
  }[purpose];
  const details: Array<[string, string]> = [
    ["Requested", when],
    ...(ctx.device ? ([["Device", ctx.device]] as Array<[string, string]>) : []),
  ];
  return {
    subject: copy.subject,
    html: layout({ subject: copy.subject, preheader: `Code ${code} · works for 10 minutes`, title: copy.title, intro: copy.intro, code, details, warning: copy.warning }),
    text: textVersion(copy.title, strip(copy.intro), code, details, copy.warning),
  };
}

/** Notice sent after a change is done, so the owner of the inbox knows about it. */
export function renderAccountNoticeEmail(kind: AccountNoticeKind, ctx: AccountEmailContext): RenderedEmail {
  const name = escapeHtml(ctx.name || "there");
  const when = istTime(ctx.when || new Date());
  const copy = {
    PASSWORD_CHANGED: {
      subject: "Your password was changed",
      title: "Your password was changed",
      intro: `Hi ${name}, the password of your Ravinarayan account was just changed. Other phones and computers were signed out.`,
      warning: "Tell your manager right away so they can lock the account and set a new password.",
    },
    EMAIL_CHANGED_OLD: {
      subject: "Your account email was changed",
      title: "Your account email was changed",
      intro: `Hi ${name}, your Ravinarayan account now uses <strong style="color:${C.ink};">${escapeHtml(ctx.newEmail || "a new address")}</strong>. Sign-in codes will go there from now on, not to this address.`,
      warning: "Tell your manager right away so they can move the account back to you.",
    },
    EMAIL_CHANGED_NEW: {
      subject: "This is now your account email",
      title: "Email confirmed",
      intro: `Hi ${name}, this address is now the email of your Ravinarayan account. Sign-in codes will come here.`,
      warning: "Tell your manager right away.",
    },
    DEVICES_SIGNED_OUT: {
      subject: "You signed out your other devices",
      title: "Other devices signed out",
      intro: `Hi ${name}, every other phone and computer signed in to your Ravinarayan account was signed out.`,
      warning: "Change your password and tell your manager.",
    },
  }[kind];
  const details: Array<[string, string]> = [
    ["When", when],
    ...(ctx.device ? ([["Device", ctx.device]] as Array<[string, string]>) : []),
  ];
  return {
    subject: copy.subject,
    html: layout({ subject: copy.subject, preheader: copy.title, title: copy.title, intro: copy.intro, details, warning: copy.warning }),
    text: textVersion(copy.title, strip(copy.intro), undefined, details, copy.warning),
  };
}
