import "server-only";
import type { Sql } from "postgres";
import type { OutageState } from "../trust/outage";

/**
 * The one `darwin_import_state` row: the lease that keeps imports one at a time, the newest
 * message read, a gap Kafka left for snapshots to fill, the day's timetable read, and the
 * Darwin outage the TRUST backup follows.
 */

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
  outage: OutageState;
  /** How far the TRUST backup has read. */
  trustReadTo?: Date;
  /** London date of the last daily TRUST check. */
  trustCanaryDate?: string;
};

export async function importState(sql: Sql): Promise<ImportState> {
  const [row] = await sql<
    {
      last_message_at: Date | null;
      gap_from: Date | null;
      gap_to: Date | null;
      last_actual_at: Date | null;
      outage_from: Date | null;
      outage_closed_at: Date | null;
      outage_ok_since: Date | null;
      trust_read_to: Date | null;
      trust_canary_date: string | null;
    }[]
  >`
    select last_message_at, gap_from, gap_to, last_actual_at, outage_from, outage_closed_at,
      outage_ok_since, trust_read_to, trust_canary_date::text as trust_canary_date
    from darwin_import_state where id = 1
  `;
  return {
    ...(row?.last_message_at ? { lastMessageAt: row.last_message_at } : {}),
    ...(row?.gap_from && row.gap_to && row.gap_from < row.gap_to
      ? { gap: { from: row.gap_from, to: row.gap_to } }
      : {}),
    outage: {
      ...(row?.last_actual_at ? { lastActualAt: row.last_actual_at } : {}),
      ...(row?.outage_from ? { outageFrom: row.outage_from } : {}),
      ...(row?.outage_closed_at ? { closedAt: row.outage_closed_at } : {}),
      ...(row?.outage_ok_since ? { okSince: row.outage_ok_since } : {}),
    },
    ...(row?.trust_read_to ? { trustReadTo: row.trust_read_to } : {}),
    ...(row?.trust_canary_date
      ? { trustCanaryDate: row.trust_canary_date }
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

/** Records the newest message read, and the newest carrying an actual time. Never moves them back. */
export async function noteProgress(
  sql: Sql,
  messageAt: Date | undefined,
  actualAt: Date | undefined,
): Promise<void> {
  await sql`
    update darwin_import_state
    set last_message_at = greatest(last_message_at, ${messageAt ?? null}::timestamptz),
      last_actual_at = greatest(last_actual_at, ${actualAt ?? null}::timestamptz),
      last_finished_at = now()
    where id = 1
  `;
}

/** Stores the outage as `nextOutage` left it. `lastActualAt` is `noteProgress`'s to write. */
export async function noteOutage(sql: Sql, outage: OutageState): Promise<void> {
  await sql`
    update darwin_import_state
    set outage_from = ${outage.outageFrom ?? null}::timestamptz,
      outage_closed_at = ${outage.closedAt ?? null}::timestamptz,
      outage_ok_since = ${outage.okSince ?? null}::timestamptz
    where id = 1
  `;
}

/** TRUST has been read up to `to`; `undefined` once an outage is over. */
export async function noteTrustRead(
  sql: Sql,
  to: Date | undefined,
): Promise<void> {
  await sql`update darwin_import_state set trust_read_to = ${to ?? null}::timestamptz where id = 1`;
}

export async function noteTrustCanary(sql: Sql, date: string): Promise<void> {
  await sql`update darwin_import_state set trust_canary_date = ${date}::date where id = 1`;
}
