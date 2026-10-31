import { NextResponse } from "next/server";

const UNAVAILABLE_CODES = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ENOTFOUND",
  "ETIMEDOUT",
  "EHOSTUNREACH",
  "CONNECT_TIMEOUT",
  "CONNECTION_CLOSED",
  "CONNECTION_ENDED",
  "CONNECTION_DESTROYED",
  "57P01", // admin_shutdown
  "57P03", // cannot_connect_now
]);

/** True when an error means the database could not be reached (as opposed to a query/business error). */
export function isDatabaseUnavailableError(err: unknown): boolean {
  const e = err as { code?: string; errno?: string; cause?: unknown; message?: string } | null;
  if (!e) return false;
  if ((e.code && UNAVAILABLE_CODES.has(e.code)) || (e.errno && UNAVAILABLE_CODES.has(String(e.errno)))) return true;
  if (typeof e.message === "string" && /connect (ECONNREFUSED|ETIMEDOUT)|getaddrinfo ENOTFOUND/.test(e.message)) return true;
  return e.cause ? isDatabaseUnavailableError(e.cause) : false;
}

/**
 * 503 response for an unreachable database. The raw driver error (host, port, code) is logged on
 * the server only and never sent to the browser.
 */
export function databaseUnavailableResponse(context: string, err: unknown): NextResponse {
  console.error(`[${context}] Database unavailable:`, (err as any)?.code || "", (err as any)?.message || err);
  return NextResponse.json(
    {
      error: "The ERP database is not reachable right now. Please try again in a moment or contact the administrator.",
      code: "SERVICE_UNAVAILABLE",
    },
    { status: 503 }
  );
}

/**
 * True for errors raised by PostgreSQL itself (missing table or column, constraint violation,
 * syntax...): they carry a 5-character SQLSTATE `code` and a `severity`. Business-rule
 * validation in the services throws plain errors without these, which remain 400s.
 */
export function isDatabaseError(err: unknown): boolean {
  const e = err as { code?: unknown; severity?: unknown; name?: unknown } | null;
  return Boolean(e && typeof e.code === "string" && /^[0-9A-Z]{5}$/.test(e.code) && (e.severity || e.name === "PostgresError"));
}

/**
 * Maps database failures to honest server responses instead of "400 Bad Request":
 * unreachable → 503; integrity-constraint violation (SQLSTATE class 23) → 409; any other database
 * error (e.g. 42P01 missing table after a skipped migration) → 500. The SQL detail is logged on the
 * server only. Returns null for non-database errors so the route keeps its own 400 validation reply.
 */
export function databaseErrorResponse(context: string, err: unknown): NextResponse | null {
  if (isDatabaseUnavailableError(err)) return databaseUnavailableResponse(context, err);
  if (!isDatabaseError(err)) return null;
  const e = err as { code: string; message?: string };
  console.error(`[${context}] Database error ${e.code}:`, e.message || err);
  if (e.code.startsWith("23")) {
    return NextResponse.json(
      { error: "This change conflicts with data that already exists. Refresh and try again.", code: "DATA_CONFLICT" },
      { status: 409 }
    );
  }
  return NextResponse.json(
    {
      error: "The server could not complete this request because of a database error. It has been logged; please contact the administrator.",
      code: "DATABASE_ERROR",
    },
    { status: 500 }
  );
}
