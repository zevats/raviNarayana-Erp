/**
 * Phone number check for forms, the same rules as the server (normalizePhoneNumber): a 10-digit
 * mobile number (with or without +91 / 91 / 0 in front), or an international number written as
 * + followed by 7 to 15 digits. Residents follow their own rule (10-15 characters). Returns a short message to show under the field, or null when the
 * number is fine (or empty and optional).
 */
export function phoneProblem(raw: string, required = true, rule: "mobile" | "resident" = "mobile"): string | null {
  const value = (raw || "").trim();
  if (!value) return required ? "Enter a phone number." : null;
  if (rule === "resident") {
    // Residents (server: 10 to 15 characters of digits, +, spaces or dashes).
    if (/[^0-9+ -]/.test(value)) return "Use digits only (spaces, dashes and + are fine).";
    if (value.length < 10) return `Enter at least 10 digits (${value.replace(/\D/g, "").length} entered).`;
    if (value.length > 15) return "This number is too long (15 characters at most).";
    return null;
  }
  let s = value.replace(/[\s\-.()]/g, "");
  if (/[^\d+]/.test(s) || s.lastIndexOf("+") > 0) return "Use digits only (start with + for a number outside India).";
  if (s.startsWith("+")) {
    if (s.startsWith("+91") && s.length === 13) return null;
    const d = s.slice(1).length;
    if (d < 7) return "This international number is too short.";
    if (d > 15) return "This international number is too long.";
    return null;
  }
  if (s.startsWith("91") && s.length === 12) s = s.slice(2);
  else if (s.startsWith("0") && s.length === 11) s = s.slice(1);
  if (s.length === 10) return null;
  if (s.length < 10) return `Enter all 10 digits of the mobile number (${s.length} entered).`;
  return "Too many digits. Enter a 10-digit mobile number, or start with + for a number outside India.";
}
