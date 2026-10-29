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
  // connect_timeout bounds how long a new connection may take. A full pool still
  // waits inside the query, which sets its own lock_timeout from the time left.
  client ??= postgres(url, {
    max: databasePoolMax(),
    prepare: false,
    idle_timeout: 20,
    connect_timeout: 10,
  });
  return client;
}

/** Milliseconds a database wait may use. Never longer than the 50 s page budget, never past `deadline`. */
export function databaseBudgetMs(deadline: number, now = Date.now()): number {
  return Math.max(1, Math.min(50_000, deadline - now));
}

/** Postgres cancelled the statement because lock_timeout or statement_timeout fired. */
export function isDatabaseTimeout(error: unknown): boolean {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String(error.code)
      : "";
  return code === "55P03" || code === "57014";
}
