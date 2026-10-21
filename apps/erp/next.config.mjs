import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    serverComponentsExternalPackages: ["better-sqlite3", "postgres"],
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
