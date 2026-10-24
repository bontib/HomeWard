import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV !== "production";

// Next.js writes small inline scripts into every page, so script-src needs 'unsafe-inline'
// (a nonce setup would make every page dynamic). Everything else is locked to this origin.
// No upgrade-insecure-requests: the app is often opened over plain http on the home network.
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "same-origin" },
  { key: "X-Frame-Options", value: "DENY" },
];

const nextConfig: NextConfig = {
  // Standalone output keeps the Docker image small (Phase 9).
  output: "standalone",
  // No sharp in the image; the app shows few raster images.
  images: { unoptimized: true },
  poweredByHeader: false,
  // Do not write agent rule files into the project.
  agentRules: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
