import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** @type {import('next').NextConfig} */
const nextConfig = {
  distDir: process.env.NEXT_DIST_DIR || (process.env.NODE_ENV === "development" ? ".next-dev" : ".next"),
  reactStrictMode: true,
  // `next dev` only: by default a compiled route idle for 60 s (beyond the last 5 used) is dropped
  // at the next compilation of any other route, so sections recompiled (3-4 s) after short pauses
  // and the background warm-up evicted its own earliest routes. Keep every compiled route for the
  // working day instead. No effect on production builds.
  onDemandEntries: {
    maxInactiveAge: 24 * 60 * 60 * 1000,
    pagesBufferLength: 500,
  },
  experimental: {
    serverComponentsExternalPackages: ["better-sqlite3", "postgres"],
    // Client router cache: revisiting a server-rendered page (dashboard, staff) within 2 min reuses
    // its payload instead of re-rendering and re-querying. Mutations call router.refresh() (see
    // ErpShell), which purges this cache, so changes made in the app show on the next visit.
    staleTimes: { dynamic: 120, static: 120 },
  },
  async headers() {
    const isProd = process.env.NODE_ENV === "production";

    // Content Security Policy (CSP):
    // Note on 'unsafe-inline': Next.js App Router (14.2) requires inline bootstrap
    // scripts (self.__next_f.push) during React hydration. Safer alternatives require
    // per-request middleware nonce injection wired into layout props.
    // 'unsafe-eval' is strictly eliminated in production.
    const scriptSrc = isProd
      ? "script-src 'self' 'unsafe-inline'"
      : "script-src 'self' 'unsafe-inline' 'unsafe-eval'";

    const csp = [
      "default-src 'self'",
      scriptSrc,
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "img-src 'self' data: https:",
      "font-src 'self' data: https://fonts.gstatic.com",
      "connect-src 'self'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join("; ");

    const headers = [
      { key: "Content-Security-Policy", value: csp },
      { key: "X-Frame-Options", value: "DENY" },
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
    ];

    if (isProd) {
      // HSTS: max-age 1 year. Omit includeSubDomains/preload until subdomains are verified HTTPS-ready.
      headers.push({
        key: "Strict-Transport-Security",
        value: "max-age=31536000",
      });
    }

    return [
      {
        source: "/(.*)",
        headers,
      },
    ];
  },
  webpack: (config, { isServer }) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      "@": path.resolve(__dirname, "src"),
    };
    if (isServer) {
      config.externals = [...(config.externals || []), "better-sqlite3"];
    }
    return config;
  },
};

export default nextConfig;
