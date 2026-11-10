/**
 * Turns a technical error into a short sentence anyone can act on. Messages written for people
 * pass through unchanged (apart from internal ids, which are removed); database, network and
 * programming errors become plain language. Used by every API error response and by the screens.
 */
const RULES: Array<[RegExp, string]> = [
  [/failed to fetch|networkerror|load failed|network request failed|ERR_INTERNET|fetch failed/i, "No connection. Check the internet and try again."],
  [/ECONNREFUSED|ECONNRESET|ETIMEDOUT|CONNECT_TIMEOUT|Connection terminated|connection.*(timed out|closed)|too many clients|database (is )?not reachable/i, "The server is busy or unreachable right now. Please try again in a moment."],
  [/duplicate key value violates unique constraint/i, "This is already saved. Refresh the page to see it."],
  [/violates foreign key constraint/i, "This is linked to other records, so it cannot be changed this way."],
  [/violates check constraint|violates not-null constraint|null value in column/i, "Some details are missing or not valid. Check the form and try again."],
  [/invalid input syntax|invalid input value for enum|value too long for type|out of range for type|date\/time field value out of range/i, "Some details are not in the right format. Check the form and try again."],
  [/deadlock detected|could not serialize access|canceling statement due to/i, "Someone else was saving at the same moment. Please try again."],
  [/Unexpected token .* in JSON|JSON\.parse|is not valid JSON|Unexpected end of JSON/i, "Something went wrong reading the reply. Please try again."],
  [/Idempotency key .* (already used|different)|Mismatched payload reuse/i, "This was already saved with different details. Refresh the page and check before saving again."],
  [/Cannot read properties of|is not a function|is not defined|undefined is not|TypeError|ReferenceError/i, "Something went wrong on our side. Please try again; if it keeps happening, tell the owner."],
  [/^(Access denied|Forbidden|Insufficient permissions)/i, "You do not have access to do this."],
  [/^Unauthorized|session (has )?expired|not signed in/i, "Your session has ended. Please sign in again."],
  [/Invalid meal type/i, "Choose lunch or dinner."],
];

/** Internal ids (cust_…, ord_…, uuids) and "ID: …" notes are never shown to people. */
function stripIds(s: string): string {
  return s
    .replace(/\s*\((?:[^()]*\b)?ID: [^)]+\)/g, "")
    .replace(/\s*\bID: [A-Za-z0-9_-]{8,}\b/g, "")
    .replace(/\s*'?\b(?:cust|ord|del|dtask|ftx|tx|inv|sub|res|stay|room|bed|staff|usr|sess|dcol|dch|prod|plan)_[0-9a-f-]{8,}\b'?/gi, "")
    .replace(/\s*'?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'?/gi, "")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([.,;:])/g, "$1")
    .trim();
}

export function friendlyError(input: unknown, fallback = "Something went wrong. Please try again."): string {
  const raw = typeof input === "string" ? input : input instanceof Error ? input.message : input && typeof input === "object" && "message" in (input as any) ? String((input as any).message) : "";
  if (!raw || !raw.trim()) return fallback;
  for (const [re, text] of RULES) if (re.test(raw)) return text;
  const cleaned = stripIds(raw.replace(/^[A-Z_]{6,}:\s*/, ""));
  return cleaned || fallback;
}
