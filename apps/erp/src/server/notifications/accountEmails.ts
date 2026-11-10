import { escapeHtml, RenderedEmail, brandEmail, brandText } from "./emailTemplate";

/**
 * Account emails in the shared Ravinarayan design: the verification codes (password change, email
 * change to the current and to the new address) and the notices sent once a change is done. The
 * code leads the subject and preview line so it shows in the notification.
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

const istTime = (d: Date) =>
  new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "long", year: "numeric", hour: "numeric", minute: "2-digit" }).format(d);

function render(subject: string, preheader: string, body: { title: string; lines: string[]; code?: string; details: Array<[string, string]>; note: string }): RenderedEmail {
  return { subject, html: brandEmail({ subject, preheader, ...body }), text: brandText(body) };
}

/** Verification code for a password or email change. */
export function renderAccountCodeEmail(purpose: AccountCodePurpose, code: string, ctx: AccountEmailContext): RenderedEmail {
  const details: Array<[string, string]> = [["Requested", istTime(ctx.when || new Date())], ...(ctx.device ? ([["Device", ctx.device]] as Array<[string, string]>) : [])];
  const newEmail = escapeHtml(ctx.newEmail || "a new address");
  const copy = {
    PASSWORD: { subject: `${code} is your code to change your password`, title: "Change your password", lines: [] as string[] },
    EMAIL_CURRENT: { subject: `${code} is your code to change your email`, title: "Change your email", lines: [`New email: <strong>${newEmail}</strong>`] },
    EMAIL_NEW: { subject: `${code} is your code to confirm this email`, title: "Confirm this email", lines: [] as string[] },
  }[purpose];
  return render(copy.subject, `${code} · expires in 10 minutes`, {
    title: copy.title,
    lines: copy.lines,
    code,
    details,
    note: "Not you? Do not share this code and tell your manager.",
  });
}

/** Notice sent after a change is done, so the owner of the inbox knows about it. */
export function renderAccountNoticeEmail(kind: AccountNoticeKind, ctx: AccountEmailContext): RenderedEmail {
  const details: Array<[string, string]> = [["When", istTime(ctx.when || new Date())], ...(ctx.device ? ([["Device", ctx.device]] as Array<[string, string]>) : [])];
  const newEmail = escapeHtml(ctx.newEmail || "a new address");
  const copy = {
    PASSWORD_CHANGED: { subject: "Your password was changed", title: "Password changed", lines: ["Other devices were signed out."] },
    EMAIL_CHANGED_OLD: { subject: "Your account email was changed", title: "Email changed", lines: [`Your account now uses <strong>${newEmail}</strong>.`] },
    EMAIL_CHANGED_NEW: { subject: "This is now your account email", title: "Email confirmed", lines: ["Sign-in codes will come to this address."] },
    DEVICES_SIGNED_OUT: { subject: "You signed out your other devices", title: "Other devices signed out", lines: [] as string[] },
  }[kind];
  return render(copy.subject, copy.title, { title: copy.title, lines: copy.lines, details, note: "Not you? Tell your manager right away." });
}
