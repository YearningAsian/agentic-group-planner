import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // @agp/shared ships TypeScript source; Next compiles it with the app.
  transpilePackages: ["@agp/shared"],
};

export default nextConfig;
