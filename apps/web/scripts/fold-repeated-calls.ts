/**
 * One-off: folds the repeated last stops of runs stored before `mergeUpdate` matched a call
 * by one public time (see `foldRepeatedCalls`) into the stored rows, `darwin_runs` and
 * `darwin_months`, so reads no longer need to fold them.
 *
 *   npm run db:fold-calls -w @railscore/web             counts the rows it would change
 *   npm run db:fold-calls -w @railscore/web -- --write  rewrites them
 *
 * It reads `DATABASE_URL` (from `.env.local` unless the shell sets one) and prints its host
 * first. Only rows naming one station twice are read. Each row is written only if it still
 * holds the text read, so an import running alongside is never overwritten: such a row is
 * reported as skipped, and a second run picks it up. A run after a finished one changes nothing.
 */
import { existsSync } from "node:fs";
import postgres from "postgres";
import { refoldMonthRuns, refoldRunCalls } from "../server/darwin/refold";
import { requireEnv } from "../server/env";

const PAGE = 2_000;
const WRITE_ROWS = 500;

/** A station code starting a call twice: `;CRS,` again later in the text. */
const REPEATED_CALL = String.raw`(^|;)([^,;]+),.*;\2,`;
/** The same within one planned pattern line, `P<crs>,<pta>,<ptd>;…`, of a month text. */
const REPEATED_PATTERN_CALL = String.raw`(?n)^P(.*;)?([^,;]+),.*;\2,`;

const write = process.argv.includes("--write");
if (existsSync(".env.local")) {
  process.loadEnvFile(".env.local");
}
const url = requireEnv("DATABASE_URL");
console.log(
  write
    ? `Rewriting ${new URL(url).hostname}`
    : `Dry run on ${new URL(url).hostname} (add --write to rewrite)`,
);

const sql = postgres(url, { max: 1, prepare: false });
try {
  await foldRuns();
  await foldMonths();
} finally {
  await sql.end();
}

async function foldRuns(): Promise<void> {
  let after = "";
  let read = 0;
  const changes: { rid: string; old: string; calls: string }[] = [];
  for (;;) {
    const rows = await sql<{ rid: string; calls: string }[]>`
      select rid, calls from darwin_runs
      where rid > ${after} and calls ~ ${REPEATED_CALL}
      order by rid limit ${PAGE}
    `;
    for (const row of rows) {
      const calls = refoldRunCalls(row.calls);
      if (calls !== undefined) {
        changes.push({ rid: row.rid, old: row.calls, calls });
      }
    }
    read += rows.length;
    if (rows.length < PAGE) {
      break;
    }
    after = rows.at(-1)!.rid;
  }
  let written = 0;
  if (write) {
    for (let start = 0; start < changes.length; start += WRITE_ROWS) {
      const slice = changes
        .slice(start, start + WRITE_ROWS)
        .map((change) => [change.rid, change.old, change.calls]);
      const result = await sql`
        update darwin_runs set calls = change.calls
        from (values ${sql(slice)}) as change (rid, old, calls)
        where darwin_runs.rid = change.rid and darwin_runs.calls = change.old
      `;
      written += result.count;
    }
  }
  report("darwin_runs", read, changes.length, written);
}

async function foldMonths(): Promise<void> {
  let after = { uid: "", month: "0001-01-01" };
  let read = 0;
  const changes: { uid: string; month: string; old: string; runs: string }[] =
    [];
  for (;;) {
    const rows = await sql<{ uid: string; month: string; runs: string }[]>`
      select uid, month::text as month, runs from darwin_months
      where (uid, month) > (${after.uid}, ${after.month}::date)
        and runs ~ ${REPEATED_PATTERN_CALL}
      order by uid, month limit ${PAGE}
    `;
    for (const row of rows) {
      const runs = refoldMonthRuns(row.month, row.uid, row.runs);
      if (runs !== undefined) {
        changes.push({ uid: row.uid, month: row.month, old: row.runs, runs });
      }
    }
    read += rows.length;
    if (rows.length < PAGE) {
      break;
    }
    after = rows.at(-1)!;
  }
  let written = 0;
  if (write) {
    for (const change of changes) {
      const result = await sql`
        update darwin_months set runs = ${change.runs}
        where uid = ${change.uid} and month = ${change.month}::date
          and runs = ${change.old}
      `;
      written += result.count;
    }
  }
  report("darwin_months", read, changes.length, written);
}

function report(
  table: string,
  read: number,
  changes: number,
  written: number,
): void {
  const skipped = changes - written;
  const outcome = write
    ? `${written} rewritten` +
      (skipped > 0
        ? `, ${skipped} skipped as they changed meanwhile: run again`
        : "")
    : `${changes} would change`;
  console.log(`${table}: ${read} rows with a station twice, ${outcome}`);
}
