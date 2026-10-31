/**
 * Email over HTTPS (Brevo / Resend) for hosts that block SMTP ports: the adapter is chosen from
 * EMAIL_ADAPTER, sends the right request to each provider, never puts the key in the body, and
 * reports provider errors and timeouts as "not sent" (so login answers clearly instead of hanging).
 * No network: fetch is replaced by a recorder.
 */
let passed = 0;
let failed = 0;
function assert(cond: unknown, label: string) {
  if (cond) {
    passed++;
    console.log(`  ✓ PASS: ${label}`);
  } else {
    failed++;
    console.log(`  ✗ FAIL: ${label}`);
  }
}

type Call = { url: string; init: any };
const calls: Call[] = [];
let reply: () => Promise<Response> = async () => new Response("{}", { status: 201 });
(globalThis as any).fetch = async (url: string, init: any) => {
  calls.push({ url, init });
  return reply();
};

async function main() {
  console.log("EMAIL OVER HTTPS (BREVO / RESEND) VERIFICATION");
  const mod = await import("../apps/erp/src/server/notifications/emailAdapter");
  const g = globalThis as any;
  const fresh = (env: Record<string, string | undefined>) => {
    for (const k of ["EMAIL_ADAPTER", "BREVO_API_KEY", "RESEND_API_KEY", "EMAIL_FROM"]) delete process.env[k];
    Object.assign(process.env, env);
    g._rnActiveEmailAdapter = undefined;
    return mod.getEmailAdapter();
  };

  // Brevo
  const brevo = fresh({ EMAIL_ADAPTER: "brevo", BREVO_API_KEY: "test-brevo-key", EMAIL_FROM: "Ravinarayan ERP <sender@example.com>" });
  assert(brevo instanceof mod.HttpApiEmailAdapter, "EMAIL_ADAPTER=brevo selects the HTTPS adapter");
  calls.length = 0;
  const okOtp = await brevo.sendOtp("owner@example.com", "123456");
  const b = JSON.parse(calls[0].init.body);
  assert(okOtp && calls[0].url === "https://api.brevo.com/v3/smtp/email", "OTP goes to the Brevo API over HTTPS");
  assert(calls[0].init.headers["api-key"] === "test-brevo-key" && !calls[0].init.body.includes("test-brevo-key"), "API key only in the header, never in the body");
  assert(b.sender.email === "sender@example.com" && b.sender.name === "Ravinarayan ERP" && b.to[0].email === "owner@example.com", "Sender name/address parsed from EMAIL_FROM; recipient set");
  assert(/123456/.test(b.htmlContent) && /123456/.test(b.textContent), "Branded OTP email (HTML and text) carries the code");

  calls.length = 0;
  const okRendered = await brevo.sendRendered!("owner@example.com", { subject: "S", html: "<p>H</p>", text: "T" }, { kind: "account_notice" });
  assert(okRendered && JSON.parse(calls[0].init.body).subject === "S", "Account emails (rendered) are sent too");

  reply = async () => new Response('{"message":"sender not verified"}', { status: 400 });
  assert((await brevo.sendOtp("owner@example.com", "123456")) === false, "Provider error → not sent (login then says it could not email the code)");
  reply = async () => {
    const e: any = new Error("aborted");
    e.name = "AbortError";
    throw e;
  };
  assert((await brevo.sendPasswordReset("owner@example.com", "https://x/reset")) === false, "Timeout → not sent");
  reply = async () => new Response("{}", { status: 200 });

  // Resend
  const resend = fresh({ EMAIL_ADAPTER: "resend", RESEND_API_KEY: "test-resend-key", EMAIL_FROM: "noreply@example.com" });
  calls.length = 0;
  await resend.sendOtp("owner@example.com", "654321");
  const r = JSON.parse(calls[0].init.body);
  assert(calls[0].url === "https://api.resend.com/emails" && calls[0].init.headers.authorization === "Bearer test-resend-key", "Resend: right endpoint and bearer key");
  assert(r.from === "Ravinarayan ERP <noreply@example.com>" && r.to[0] === "owner@example.com", "Resend: plain EMAIL_FROM gets the default sender name");

  // Missing configuration is reported clearly
  let msg = "";
  try {
    fresh({ EMAIL_ADAPTER: "brevo", EMAIL_FROM: "a@b.co" });
  } catch (e: any) {
    msg = e.message;
  }
  assert(/BREVO_API_KEY is required/.test(msg), "Missing BREVO_API_KEY is a clear configuration error");
  try {
    msg = "";
    fresh({ EMAIL_ADAPTER: "resend", RESEND_API_KEY: "k" });
  } catch (e: any) {
    msg = e.message;
  }
  assert(/EMAIL_FROM/.test(msg), "Missing EMAIL_FROM is a clear configuration error");

  console.log(`\nEMAIL HTTP RESULTS: ${passed} PASSED, ${failed} FAILED`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
