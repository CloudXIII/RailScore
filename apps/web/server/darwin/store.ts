import "server-only";
import type { Sql } from "postgres";
import { addCalendarDays, londonIsoDate } from "@railscore/core";
import type { DarwinUpdate } from "./push-port";
import {
  decodeCalls,
  encodeCalls,
  hspPayloadFromDarwin,
  mergeUpdate,
  type DarwinRun,
} from "./run";

/** Rows per statement. Postgres takes at most 65,535 parameters, five per row here. */
const WRITE_ROWS = 2_000;

/** Folds updates into the stored runs. Returns how many runs changed. */
export async function applyUpdates(
  sql: Sql,
  updates: readonly DarwinUpdate[],
): Promise<number> {
  if (updates.length === 0) {
    return 0;
  }
  const rids = [...new Set(updates.map((update) => update.rid))];
  const runs = await loadRuns(sql, rids);
  const changed = new Set<string>();
  for (const update of updates) {
    const merged = mergeUpdate(runs.get(update.rid), update);
    if (merged) {
      runs.set(update.rid, merged);
      changed.add(update.rid);
    }
  }
  const rows = [...changed].map((rid) => {
    const run = runs.get(rid)!;
    return {
      rid,
      service_date: run.serviceDate,
      uid: run.uid,
      toc: run.toc,
      calls: encodeCalls(run.calls),
    };
  });
  for (let start = 0; start < rows.length; start += WRITE_ROWS) {
    const slice = rows.slice(start, start + WRITE_ROWS);
    await sql`
      insert into darwin_runs ${sql(slice, "rid", "service_date", "uid", "toc", "calls")}
      on conflict (rid) do update
      set service_date = excluded.service_date, uid = excluded.uid, toc = excluded.toc,
        calls = excluded.calls, updated_at = now()
    `;
  }
  return rows.length;
}

async function loadRuns(
  sql: Sql,
  rids: readonly string[],
): Promise<Map<string, DarwinRun>> {
  const runs = new Map<string, DarwinRun>();
  for (let start = 0; start < rids.length; start += WRITE_ROWS) {
    const rows = await sql<RunRow[]>`
      select rid, service_date::text as service_date, uid, toc, calls
      from darwin_runs
      where rid in ${sql(rids.slice(start, start + WRITE_ROWS))}
    `;
    for (const row of rows) {
      runs.set(row.rid, runOf(row));
    }
  }
  return runs;
}

/**
 * Darwin runs for these RIDs in HSP's serviceDetails shape, for days that have finished.
 * A run from today may still be under way, so it is left for HSP or a later import.
 */
export async function loadSettledDarwinRuns(
  sql: Sql,
  rids: readonly string[],
  now: Date,
): Promise<Map<string, unknown>> {
  const payloads = new Map<string, unknown>();
  if (rids.length === 0) {
    return payloads;
  }
  const today = londonIsoDate(now);
  const runs = await loadRuns(sql, rids);
  for (const [rid, run] of runs) {
    if (run.serviceDate < today) {
      payloads.set(rid, hspPayloadFromDarwin(run));
    }
  }
  return payloads;
}

/** Drops runs older than `keepDays`. */
export async function deleteOldRuns(
  sql: Sql,
  keepDays: number,
  now: Date,
): Promise<number> {
  const oldest = addCalendarDays(londonIsoDate(now), -keepDays);
  const result =
    await sql`delete from darwin_runs where service_date < ${oldest}::date`;
  return result.count;
}

/** Takes the import lease for `ms`. False while another import holds it. */
export async function acquireImport(sql: Sql, ms: number): Promise<boolean> {
  const rows = await sql`
    update darwin_import_state
    set leased_until = now() + ${ms} * interval '1 millisecond'
    where id = 1 and leased_until < now()
    returning id
  `;
  return rows.length === 1;
}

export async function releaseImport(sql: Sql): Promise<void> {
  await sql`update darwin_import_state set leased_until = 'epoch' where id = 1`;
}

export type ImportState = {
  lastMessageAt?: Date;
  gap?: { from: Date; to: Date };
};

export async function importState(sql: Sql): Promise<ImportState> {
  const [row] = await sql<
    {
      last_message_at: Date | null;
      gap_from: Date | null;
      gap_to: Date | null;
    }[]
  >`
    select last_message_at, gap_from, gap_to from darwin_import_state where id = 1
  `;
  return {
    ...(row?.last_message_at ? { lastMessageAt: row.last_message_at } : {}),
    ...(row?.gap_from && row.gap_to && row.gap_from < row.gap_to
      ? { gap: { from: row.gap_from, to: row.gap_to } }
      : {}),
  };
}

/** Marks messages from `from` to `to` as lost from Kafka. Widens a gap still being filled. */
export async function noteGap(sql: Sql, from: Date, to: Date): Promise<void> {
  await sql`
    update darwin_import_state
    set gap_from = least(coalesce(gap_from, ${from}::timestamptz), ${from}::timestamptz),
      gap_to = greatest(coalesce(gap_to, ${to}::timestamptz), ${to}::timestamptz)
    where id = 1
  `;
}

/** Everything up to `through` has been read from snapshots. */
export async function noteGapFilled(sql: Sql, through: Date): Promise<void> {
  await sql`update darwin_import_state set gap_from = ${through}::timestamptz where id = 1`;
}

/** UTC date whose morning snapshot was last read for the timetable. */
export async function timetableDate(sql: Sql): Promise<string | undefined> {
  const [row] = await sql<{ timetable_date: string | null }[]>`
    select timetable_date::text as timetable_date from darwin_import_state where id = 1
  `;
  return row?.timetable_date ?? undefined;
}

export async function noteTimetable(sql: Sql, date: string): Promise<void> {
  await sql`update darwin_import_state set timetable_date = ${date}::date where id = 1`;
}

type RunRow = {
  rid: string;
  service_date: string;
  uid: string;
  toc: string;
  calls: string;
};

function runOf(row: RunRow): DarwinRun {
  return {
    rid: row.rid,
    serviceDate: row.service_date,
    uid: row.uid,
    toc: row.toc,
    calls: decodeCalls(row.calls),
  };
}

/**
 * One day's runs calling at both stations, in any order. A CRS only starts a call in the
 * stored text, so matching `CRS,` finds the station.
 */
export async function runsOnDay(
  sql: Sql,
  input: { fromCrs: string; toCrs: string; date: string },
): Promise<DarwinRun[]> {
  const rows = await sql<RunRow[]>`
    select rid, service_date::text as service_date, uid, toc, calls
    from darwin_runs
    where service_date = ${input.date}::date
      and calls like ${`%${input.fromCrs},%`}
      and calls like ${`%${input.toCrs},%`}
  `;
  return rows.map(runOf);
}

/** Runs of these schedule UIDs between two dates, both inclusive. */
export async function runsOfTrains(
  sql: Sql,
  input: { uids: readonly string[]; fromDate: string; toDate: string },
): Promise<DarwinRun[]> {
  if (input.uids.length === 0) {
    return [];
  }
  const rows = await sql<RunRow[]>`
    select rid, service_date::text as service_date, uid, toc, calls
    from darwin_runs
    where uid in ${sql([...input.uids])}
      and service_date between ${input.fromDate}::date and ${input.toDate}::date
  `;
  return rows.map(runOf);
}

/** Oldest service date stored. Undefined when there are no runs yet. */
export async function oldestRunDate(sql: Sql): Promise<string | undefined> {
  const [row] = await sql<{ oldest: string | null }[]>`
    select min(service_date)::text as oldest from darwin_runs
  `;
  return row?.oldest ?? undefined;
}

/** Records the newest message read. Never moves it back. */
export async function noteProgress(
  sql: Sql,
  messageAt: Date | undefined,
): Promise<void> {
  await sql`
    update darwin_import_state
    set last_message_at = greatest(last_message_at, ${messageAt ?? null}::timestamptz),
      last_finished_at = now()
    where id = 1
  `;
}
