const fs = require("fs");
const path = require("path");

require("../tests/register_paths.js");

// Load apps/erp/.env.local and apps/erp/.env.development.local
const envDevLocal = path.resolve("apps/erp/.env.development.local");
if (fs.existsSync(envDevLocal)) {
  fs.readFileSync(envDevLocal, "utf8").split(/\r?\n/).forEach(l => {
    const t = l.trim();
    if (t && !t.startsWith("#")) {
      const eq = t.indexOf("=");
      if (eq !== -1) {
        process.env[t.slice(0, eq).trim()] = t.slice(eq + 1).trim();
      }
    }
  });
}

const envLocal = path.resolve("apps/erp/.env.local");
if (fs.existsSync(envLocal)) {
  fs.readFileSync(envLocal, "utf8").split(/\r?\n/).forEach(l => {
    const t = l.trim();
    if (t && !t.startsWith("#")) {
      const eq = t.indexOf("=");
      if (eq !== -1) {
        const k = t.slice(0, eq).trim();
        const v = t.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
        if (!process.env[k]) {
          process.env[k] = v;
        }
      }
    }
  });
}

const { getEmailAdapter } = require("../tests/dist/apps/erp/src/server/notifications/emailAdapter");

async function check() {
  console.log("=== EMAIL ADAPTER INSPECTION ===");
  console.log("EMAIL_ADAPTER env:", process.env.EMAIL_ADAPTER);
  console.log("SMTP_HOST:", process.env.SMTP_HOST);
  console.log("SMTP_PORT:", process.env.SMTP_PORT);
  console.log("SMTP_USER:", process.env.SMTP_USER);
  console.log("SMTP_APP_PASSWORD configured:", Boolean(process.env.SMTP_APP_PASSWORD));
  console.log("ERP_ADMIN_EMAIL:", process.env.ERP_ADMIN_EMAIL);

  const adapter = getEmailAdapter();
  console.log("Adapter instantiated:", adapter.constructor.name);

  if (typeof adapter.verifyConnection === "function") {
    console.log("Verifying SMTP connection...");
    const t0 = Date.now();
    try {
      const res = await adapter.verifyConnection();
      console.log(`SMTP verifyConnection finished in ${Date.now() - t0}ms:`, res);
    } catch (e) {
      console.log("SMTP verifyConnection exception:", e.message);
    }
  }
}

check().catch(console.error);
