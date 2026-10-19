import { readFileSync } from "node:fs";
import postgres from "postgres";
import { requireEnv } from "../server/env.ts";

let url;
try {
  url = requireEnv("DATABASE_URL");
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}

const sql = postgres(url, { max: 1, prepare: false });
try {
  await sql.unsafe(
    readFileSync(new URL("../db/schema.sql", import.meta.url), "utf8"),
  );
  console.log("Database schema is up to date.");
} finally {
  await sql.end();
}
