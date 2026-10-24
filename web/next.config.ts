import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Standalone output keeps the Docker image small (Phase 9).
  output: "standalone",
  // No sharp in the image; the app shows few raster images.
  images: { unoptimized: true },
  poweredByHeader: false,
  // Do not write agent rule files into the project.
  agentRules: false,
};

export default nextConfig;
