import "server-only";
import postgres, { type Sql } from "postgres";
import { databasePoolMax, databaseUrl } from "./env";

let client: Sql | undefined;

/** Undefined when `DATABASE_URL` is not set, so the app still runs without a database. */
export function database(): Sql | undefined {
  const url = databaseUrl();
  if (!url) {
    return undefined;
  }
  // Pooled Neon URLs (pgbouncer in transaction mode) do not support prepared statements.
  // connect_timeout bounds how long a new connection may take.
  client ??= postgres(url, {
    max: databasePoolMax(),
    prepare: false,
    idle_timeout: 20,
    connect_timeout: 10,
  });
  return client;
}
