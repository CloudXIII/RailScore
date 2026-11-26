/**
 * The TRUST captures and fills the Darwin import left (server/trust/backup.ts), by hand.
 *
 *   npm run db:trust-fill -w @railscore/web                      lists captures and fills, and
 *                                                                 measures each capture's fill
 *   npm run db:trust-fill -w @railscore/web -- --write <outage>  fills that outage even if the
 *                                                                 checks refused it
 *   npm run db:trust-fill -w @railscore/web -- --revert <filled> puts back the calls of that fill
 *
 * <outage> is a capture's outage start and <filled> a fill's time, as the listing prints them.
 * It reads `DATABASE_URL` (from `.env.local` unless the shell sets one) and prints its host
 * first. A write takes the Darwin import's lease, and refuses while an import holds it. A run is changed only while its
 * calls are still the text read, so neither a fill nor a revert overwrites a later import.
 */
import { existsSync } from "node:fs";
import postgres from "postgres";
import { acquireImport, releaseImport } from "../server/darwin/import-state";
import { requireEnv } from "../server/env";
import { fillOutage, OVERLAP_MS, revertFill } from "../server/trust/backup";

const args = process.argv.slice(2);
const writeAt = valueOf("--write");
const revertAt = valueOf("--revert");
if (existsSync(".env.local")) {
  process.loadEnvFile(".env.local");
}
const url = requireEnv("DATABASE_URL");
console.log(`Database ${new URL(url).hostname}`);

const sql = postgres(url, { max: 1, prepare: false });
/** The import's lease, held while writing so no import holds runs read before the write. */
const LEASE_MS = 10 * 60_000;
let leased = false;
try {
  if (writeAt || revertAt) {
    leased = await acquireImport(sql, LEASE_MS);
    if (!leased) {
      throw new Error(
        "A Darwin import is running; try again in a few minutes.",
      );
    }
  }
  if (revertAt) {
    const reverted = await revertFill(sql, revertAt);
    console.log(`Reverted ${reverted} runs.`);
  } else {
    const outages = await sql<
      {
        outage_from: Date;
        read_to: Date;
        captures: number;
        movements: number;
      }[]
    >`
      select outage_from, max(read_to) as read_to, count(*)::int as captures,
        sum(movements)::int as movements
      from trust_captures group by outage_from order by outage_from
    `;
    for (const outage of outages) {
      if (writeAt && outage.outage_from.getTime() !== writeAt.getTime()) {
        continue;
      }
      console.log(
        `Outage from ${outage.outage_from.toISOString()}: ${outage.captures} captures to ${outage.read_to.toISOString()}, ${outage.movements} movements`,
      );
      const result = await fillOutage(
        sql,
        outage.outage_from,
        {
          from: outage.outage_from.getTime() - OVERLAP_MS,
          to: outage.read_to.getTime(),
        },
        writeAt ? { force: true } : { dryRun: true },
      );
      console.log(JSON.stringify(result, null, 2));
    }
    if (outages.length === 0) {
      console.log("No TRUST captures waiting.");
    }
    const fills = await sql<{ filled_at: Date; runs: number }[]>`
      select filled_at, count(*)::int as runs from trust_fills
      group by filled_at order by filled_at
    `;
    for (const fill of fills) {
      console.log(
        `Fill ${fill.filled_at.toISOString()}: ${fill.runs} runs (undo with --revert ${fill.filled_at.toISOString()})`,
      );
    }
  }
} finally {
  if (leased) {
    await releaseImport(sql);
  }
  await sql.end();
}

function valueOf(flag: string): Date | undefined {
  const index = args.indexOf(flag);
  if (index === -1) {
    return undefined;
  }
  const at = new Date(args[index + 1] ?? "");
  if (Number.isNaN(at.getTime())) {
    console.error(`${flag} needs a time, as the listing prints it.`);
    process.exit(2);
  }
  return at;
}
