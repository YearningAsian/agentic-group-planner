import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Next 16 writes agent instruction files on dev startup. This prototype doesn't use them.
  agentRules: false,
};

export default nextConfig;
