import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@railscore/core"],
  // Lint runs once for the whole repository, from the root: `npm run lint`.
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
