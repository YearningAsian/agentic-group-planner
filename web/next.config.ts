import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // @agp/shared ships TypeScript source; Next compiles it with the app.
  transpilePackages: ["@agp/shared"],
  // Trip-draft fixtures use Unsplash sample photos (prototype port, client-only).
  images: { remotePatterns: [{ protocol: "https", hostname: "images.unsplash.com" }] },
};

export default nextConfig;
