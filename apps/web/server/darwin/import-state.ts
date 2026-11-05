import "server-only";
import type { Sql } from "postgres";

/**
 * The one `darwin_import_state` row: the lease that keeps imports one at a time, the newest
 * message read, a gap Kafka left for snapshots to fill, and the day's timetable read.
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
