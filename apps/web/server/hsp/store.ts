import "server-only";
import type { JSONValue, Sql } from "postgres";
import { addCalendarDays, londonIsoDate } from "@railscore/core";
import { decodeHspCalls, encodeHspCalls, type HspRun } from "./details";
import { database } from "../db";
import type { HspService } from "./metrics";

/**
 * What HSP said about the days before Darwin, kept so a second search asks it nothing:
 * list answers by route, day type, quarter-hour and dates, and runs in the stored Darwin shape.
 * The backlog runs only beside Darwin, which needs the database, so there is no other store.
 * A failed query throws: the search logs it and the page keeps Darwin's figures.
 */

/** A list call is claimed for this long, a little over one gateway timeout. */
const CLAIM_MS = 70_000;

/**
 * HSP calls in flight across every server. At busy times HSP refuses a second call beside a
 * list call, list or detail alike (measured 5 November 2026: a second list always refused,
 * detail calls beside a list mostly refused). A list call holds the slot for its call; a
 * history holds it for its whole run of detail calls. A database migrated before may hold more
 * rows than this; only the first `CALL_SLOTS` are used.
 */
const CALL_SLOTS = 1;

function db(): Sql {
  const sql = database();
  if (!sql) {
    throw new Error("The HSP backlog needs DATABASE_URL.");
  }
  return sql;
}

/** Stored list answers for these keys. Keys with none stored are absent. */
export async function storedMetrics(
  keys: readonly string[],
): Promise<Map<string, HspService[]>> {
  if (keys.length === 0) {
    return new Map();
  }
  const sql = db();
  const rows = await sql<{ key: string; services: HspService[] }[]>`
    select key, services from hsp_metrics
    where key in ${sql([...keys])} and services is not null
  `;
  return new Map(rows.map((row) => [row.key, row.services]));
}

/**
 * Claims the call for `key`, so two searches of the same quarter do not both ask HSP.
 * False while another claim is live; the caller then waits for its answer.
 */
export async function claimMetrics(key: string): Promise<boolean> {
  const rows = await db()`
    insert into hsp_metrics (key, claimed_until)
    values (${key}, now() + ${CLAIM_MS} * interval '1 millisecond')
    on conflict (key) do update set claimed_until = excluded.claimed_until
    where hsp_metrics.services is null and hsp_metrics.claimed_until < now()
    returning key
  `;
  return rows.length === 1;
}

export async function saveMetrics(
  key: string,
  services: readonly HspService[],
): Promise<void> {
  const sql = db();
  await sql`
    update hsp_metrics
    set services = ${sql.json(services as unknown as JSONValue)}, fetched_at = now()
    where key = ${key}
  `;
}

/** Gives a claim up after a failed call, so the next search may try again. */
export async function releaseMetrics(key: string): Promise<void> {
  await db()`
    update hsp_metrics set claimed_until = 'epoch'
    where key = ${key} and services is null
  `;
}

/** Takes a shared call slot for about a minute. Undefined while every slot is in use. */
export async function takeCallSlot(owner: string): Promise<number | undefined> {
  const [row] = await db()<{ slot: number }[]>`
    update hsp_slots
    set owner = ${owner}, leased_until = now() + ${CLAIM_MS} * interval '1 millisecond'
    where slot = (
      select slot from hsp_slots
      where leased_until < now() and slot <= ${CALL_SLOTS}
      order by slot limit 1 for update skip locked
    )
    returning slot
  `;
  return row?.slot;
}

/** Keeps a slot held for a long run of detail calls. */
export async function renewCallSlot(
  slot: number,
  owner: string,
): Promise<void> {
  await db()`
    update hsp_slots
    set leased_until = now() + ${CLAIM_MS} * interval '1 millisecond'
    where slot = ${slot} and owner = ${owner}
  `;
}

export async function releaseCallSlot(
  slot: number,
  owner: string,
): Promise<void> {
  await db()`
    update hsp_slots set owner = null, leased_until = 'epoch'
    where slot = ${slot} and owner = ${owner}
  `;
}

/** HSP calls made today (London) across every server. */
export async function callsToday(now = new Date()): Promise<number> {
  const day = londonIsoDate(now);
  const [row] = await db()<{ calls: number }[]>`
    select calls from hsp_usage where day = ${day}::date
  `;
  return row?.calls ?? 0;
}

/** Adds calls to today's count. Called once per search, not per call. */
export async function addCalls(count: number, now = new Date()): Promise<void> {
  if (count <= 0) {
    return;
  }
  const day = londonIsoDate(now);
  await db()`
    insert into hsp_usage (day, calls) values (${day}::date, ${count})
    on conflict (day) do update set calls = hsp_usage.calls + excluded.calls
  `;
}

/** Stored HSP runs by RID. */
export async function storedRuns(
  rids: readonly string[],
): Promise<Map<string, HspRun>> {
  if (rids.length === 0) {
    return new Map();
  }
  const sql = db();
  const rows = await sql<
    {
      rid: string;
      service_date: string;
      toc: string;
      calls: string;
      reasons: string;
    }[]
  >`
    select rid, service_date::text as service_date, toc, calls, reasons
    from hsp_backlog_runs where rid in ${sql([...rids])}
  `;
  return new Map(
    rows.map((row) => [
      row.rid,
      {
        rid: row.rid,
        serviceDate: row.service_date,
        toc: row.toc,
        calls: decodeHspCalls(row),
      },
    ]),
  );
}

export async function saveRuns(runs: readonly HspRun[]): Promise<void> {
  if (runs.length === 0) {
    return;
  }
  const rows = runs.map((run) => ({
    rid: run.rid,
    service_date: run.serviceDate,
    toc: run.toc,
    ...encodeHspCalls(run.calls),
  }));
  const sql = db();
  await sql`
    insert into hsp_backlog_runs ${sql(rows, "rid", "service_date", "toc", "calls", "reasons")}
    on conflict (rid) do nothing
  `;
}

/**
 * Drops HSP runs older than `keepDays`, and list answers from before yesterday: their dates
 * start on a day no search asks for any more. Once Darwin covers every period nothing new
 * is stored, and the runs age out.
 */
export async function deleteOldBacklog(
  sql: Sql,
  keepDays: number,
  now: Date,
): Promise<number> {
  const oldest = addCalendarDays(londonIsoDate(now), -keepDays);
  const runs =
    await sql`delete from hsp_backlog_runs where service_date < ${oldest}::date`;
  await sql`
    delete from hsp_metrics
    where coalesce(fetched_at, claimed_until) < now() - interval '2 days'
  `;
  await sql`delete from hsp_usage where day < ${oldest}::date`;
  return runs.count;
}
