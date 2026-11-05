import "server-only";
import type { Sql } from "postgres";
import { addCalendarDays, londonIsoDate } from "@railscore/core";
import { decodeMonth, encodeMonthChunk, monthOf } from "./month";
import type { DarwinUpdate } from "./push-port";
import {
  decodeCalls,
  encodeCalls,
  foldRepeatedCalls,
  mergeUpdate,
  type DarwinRun,
} from "./run";

/** Rows per statement. Postgres takes at most 65,535 parameters, seven per row here. */
const WRITE_ROWS = 2_000;

/** Month rows per statement. A packed day is a few hundred bytes per row before compression. */
const MONTH_ROWS = 500;

/**
 * Days kept as one row per run: today and the 7 before it, so the latest day of every day type
 * is there for a search to start from. Older days are packed into `darwin_months`.
 */
const OPEN_DAYS = 8;

/** First day still kept as one row per run. Earlier days are packed and no longer change. */
export function openFrom(now: Date): string {
  return addCalendarDays(londonIsoDate(now), 1 - OPEN_DAYS);
}

/**
 * Folds updates into the stored runs. Returns how many runs changed. An update for a day that
 * is already packed is dropped: a lone late message would otherwise start a partial copy.
 */
export async function applyUpdates(
  sql: Sql,
  received: readonly DarwinUpdate[],
  now = new Date(),
): Promise<number> {
  const from = openFrom(now);
  const updates = received.filter((update) => update.serviceDate >= from);
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
      late_reason: run.lateReason ?? "",
      cancel_reason: run.cancelReason ?? "",
    };
  });
  for (let start = 0; start < rows.length; start += WRITE_ROWS) {
    const slice = rows.slice(start, start + WRITE_ROWS);
    await sql`
      insert into darwin_runs ${sql(slice, "rid", "service_date", "uid", "toc", "calls", "late_reason", "cancel_reason")}
      on conflict (rid) do update
      set service_date = excluded.service_date, uid = excluded.uid, toc = excluded.toc,
        calls = excluded.calls, late_reason = excluded.late_reason,
        cancel_reason = excluded.cancel_reason, updated_at = now()
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
      select rid, service_date::text as service_date, uid, toc, calls, late_reason, cancel_reason
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
 * Drops runs older than `keepDays`. A month row goes once its whole month is older, so up to a
 * month more can stay readable; searches never ask for it.
 */
export async function deleteOldRuns(
  sql: Sql,
  keepDays: number,
  now: Date,
): Promise<number> {
  const oldest = addCalendarDays(londonIsoDate(now), -keepDays);
  const result =
    await sql`delete from darwin_runs where service_date < ${oldest}::date`;
  await sql`delete from darwin_months where month < ${monthOf(oldest)}::date`;
  return result.count;
}

/**
 * Packs the oldest day before `openFrom` into month rows, one day at a time while there is
 * time. Each day is appended to its rows and taken out of `darwin_runs` in one transaction,
 * so a run is never in both places or in neither. Returns the days packed.
 */
export async function packFinishedDays(
  sql: Sql,
  now: Date,
  deadline: number,
): Promise<string[]> {
  const packed: string[] = [];
  while (Date.now() < deadline) {
    const [next] = await sql<{ day: string | null }[]>`
      select min(service_date)::text as day from darwin_runs
      where service_date < ${openFrom(now)}::date
    `;
    const day = next?.day;
    if (!day) {
      break;
    }
    await sql.begin(async (tx) => {
      const rows = await tx<RunRow[]>`
        select rid, service_date::text as service_date, uid, toc, calls, late_reason, cancel_reason
        from darwin_runs where service_date = ${day}::date
      `;
      const byUid = new Map<string, DarwinRun[]>();
      for (const row of rows) {
        const run = runOf(row);
        byUid.set(run.uid, [...(byUid.get(run.uid) ?? []), run]);
      }
      const months = [...byUid].map(([uid, runs]) => ({
        uid,
        month: monthOf(day),
        first_day: day,
        runs: encodeMonthChunk(runs),
      }));
      for (let start = 0; start < months.length; start += MONTH_ROWS) {
        await tx`
          insert into darwin_months ${tx(months.slice(start, start + MONTH_ROWS), "uid", "month", "first_day", "runs")}
          on conflict (uid, month) do update
          set runs = darwin_months.runs || E'\n' || excluded.runs,
            first_day = least(darwin_months.first_day, excluded.first_day)
        `;
      }
      await tx`delete from darwin_runs where service_date = ${day}::date`;
    });
    packed.push(day);
  }
  return packed;
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
  late_reason: string;
  cancel_reason: string;
};

function runOf(row: RunRow): DarwinRun {
  return {
    rid: row.rid,
    serviceDate: row.service_date,
    uid: row.uid,
    toc: row.toc,
    calls: foldRepeatedCalls(decodeCalls(row.calls)),
    ...(row.late_reason ? { lateReason: row.late_reason } : {}),
    ...(row.cancel_reason ? { cancelReason: row.cancel_reason } : {}),
  };
}

/**
 * One open day's runs calling at both stations, in any order. Packed days are not searched. A CRS only starts a call in the
 * stored text, so matching `CRS,` finds the station.
 */
export async function runsOnDay(
  sql: Sql,
  input: { fromCrs: string; toCrs: string; date: string },
): Promise<DarwinRun[]> {
  const rows = await sql<RunRow[]>`
    select rid, service_date::text as service_date, uid, toc, calls, late_reason, cancel_reason
    from darwin_runs
    where service_date = ${input.date}::date
      and calls like ${`%${input.fromCrs},%`}
      and calls like ${`%${input.toCrs},%`}
  `;
  return rows.map(runOf);
}

/** Runs of these schedule UIDs between two dates, both inclusive, open and packed. */
export async function runsOfTrains(
  sql: Sql,
  input: { uids: readonly string[]; fromDate: string; toDate: string },
): Promise<DarwinRun[]> {
  if (input.uids.length === 0) {
    return [];
  }
  const uids = sql([...input.uids]);
  const [open, months] = await Promise.all([
    sql<RunRow[]>`
      select rid, service_date::text as service_date, uid, toc, calls, late_reason, cancel_reason
      from darwin_runs
      where uid in ${uids}
        and service_date between ${input.fromDate}::date and ${input.toDate}::date
    `,
    sql<{ uid: string; month: string; runs: string }[]>`
      select uid, month::text as month, runs
      from darwin_months
      where uid in ${uids}
        and month between ${monthOf(input.fromDate)}::date and ${monthOf(input.toDate)}::date
    `,
  ]);
  const runs = new Map<string, DarwinRun>();
  for (const row of months) {
    for (const run of decodeMonth(row.month, row.uid, row.runs)) {
      if (
        run.serviceDate >= input.fromDate &&
        run.serviceDate <= input.toDate
      ) {
        runs.set(run.rid, run);
      }
    }
  }
  for (const row of open) {
    runs.set(row.rid, runOf(row));
  }
  return [...runs.values()];
}

/** Oldest service date stored, open or packed. Undefined when there are no runs yet. */
export async function oldestRunDate(sql: Sql): Promise<string | undefined> {
  const [row] = await sql<{ oldest: string | null }[]>`
    select least(
      (select min(service_date) from darwin_runs),
      (select min(first_day) from darwin_months)
    )::text as oldest
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
