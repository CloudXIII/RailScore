import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { FlatCompat } from "@eslint/eslintrc";

const compat = new FlatCompat({
  baseDirectory: dirname(fileURLToPath(import.meta.url)),
});

/** One lint for the whole repository: Next's rules (React hooks included) and TypeScript's. */
const config = [
  {
    ignores: [
      "**/node_modules/**",
      "**/.next/**",
      "**/next-env.d.ts",
      ".claude/**",
    ],
  },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    settings: { next: { rootDir: "apps/web" } },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  {
    // The client and the shared types run in the browser: server code stays on the server.
    files: ["apps/web/features/**", "apps/web/shared/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/server", "@/server/*", "**/server/*"],
              message:
                "Client and shared code must not import server code. Move the pure part to shared/ or packages/core.",
            },
          ],
        },
      ],
    },
  },
  {
    // The domain core depends on nothing: not the app, not the framework.
    files: ["packages/core/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "@/*",
                "@railscore/web",
                "@railscore/web/*",
                "**/apps/*",
                "next",
                "next/*",
                "react",
                "react-dom",
                "server-only",
              ],
              message:
                "packages/core must not depend on the app or a framework.",
            },
          ],
        },
      ],
    },
  },
];

export default config;
