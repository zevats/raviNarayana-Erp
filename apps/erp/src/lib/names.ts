/** Titles that are not a person's name ("Dr. Ravinder Gulia" -> "Ravinder"). */
const HONORIFICS = /^(dr|mr|mrs|ms|miss|shri|sri|smt|kumari|prof|er|adv|capt|col|maj)\.?$/i;

/**
 * The name to greet someone by: the first word of their name that is a real name (titles and
 * initials skipped). Null when there is none, so callers can fall back to a plain greeting.
 */
export function greetingName(fullName: string | null | undefined): string | null {
  const words = (fullName || "").trim().split(/\s+/).filter(Boolean);
  for (const w of words) {
    const clean = w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
    if (HONORIFICS.test(w) || HONORIFICS.test(clean)) continue;
    // Initials ("R." / "K") are skipped; a real name has two or more characters and a letter.
    if (clean.length >= 2 && /\p{L}/u.test(clean)) return clean.charAt(0).toUpperCase() + clean.slice(1);
  }
  return null;
}

export function greeting(fullName: string | null | undefined): string {
  const name = greetingName(fullName);
  return name ? `Namaste, ${name}!` : "Namaste!";
}
