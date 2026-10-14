import { execFileSync, spawn } from "node:child_process";
import { createRequire } from "node:module";
import { devPort } from "../server/env.ts";

const require = createRequire(import.meta.url);
const port = devPort();

function tailscaleIpv4() {
  try {
    return execFileSync("tailscale", ["ip", "-4"], {
      encoding: "utf8",
      timeout: 4000,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
}

const ip = tailscaleIpv4();
if (ip) {
  process.stdout.write(
    `\n  Open this on the phone (Tailscale): http://${ip}:${port}\n\n`,
  );
}

const nextBin = require.resolve("next/dist/bin/next");
const child = spawn(
  process.execPath,
  [nextBin, "dev", "--hostname", "0.0.0.0", "--port", port],
  {
    stdio: "inherit",
  },
);

child.on("exit", (code) => {
  process.exit(code ?? 0);
});
