import os from "node:os";
import type { NextConfig } from "next";

function allowedDevOrigins(): string[] {
  const origins = new Set<string>(["**.ts.net"]);
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family === "IPv4" && entry.address !== "127.0.0.1") {
        origins.add(entry.address);
      }
    }
  }
  return [...origins];
}

const nextConfig: NextConfig = {
  transpilePackages: ["@railscore/core"],
  allowedDevOrigins: allowedDevOrigins(),
};

export default nextConfig;
