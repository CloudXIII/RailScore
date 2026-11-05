import "server-only";
import type { JSONValue, Sql } from "postgres";
import { addCalendarDays, londonIsoDate } from "@railscore/core";
import { decodeCalls, encodeCalls } from "../darwin/run";
import { decodeReasons, encodeReasons, type HspRun } from "./details";
import { database } from "../db";
import { errorText } from "../error-text";
import type { HspService } from "./metrics";

/**
 * What HSP said about the days before Darwin, kept so a second search asks it nothing:
 * list answers by route, day type, quarter-hour and dates, and runs in the stored Darwin shape.
 * Without a database (or before the tables exist) the same is kept in this process only.
 */

/** A list call is claimed for this long, a little over one gateway timeout. */
const CLAIM_MS = 70_000;

/**
 * HSP calls in flight across every server. At busy times HSP refuses a second call beside a
 * list call, list or detail alike (measured 5 November 2026: a second list always refused,
 * detail calls beside a list mostly refused). A list call holds the slot for its call; a
 * history holds it for its whole run of detail calls. The table may hold more rows than this.
 */
export const CALL_SLOTS = 1;

const memoryMetrics = new Map<string, HspService[]>();
const memoryClaims = new Map<string, number>();
const memoryRuns = new Map<string, HspRun>();
const memorySlots = Array.from({ length: CALL_SLOTS }, () => ({
  owner: "",
  until: 0,
}));
let memoryUsage = { day: "", calls: 0 };

let tablesMissing = false;

async function withDatabase<T>(
  work: (sql: Sql) => Promise<T>,
): Promise<T | undefined> {
  const sql = database();
  if (!sql || tablesMissing) {
    return undefined;
  }
  try {
    return await work(sql);
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "42P01"
    ) {
      tablesMissing = true;
      console.error("HSP tables are missing; run npm run db:migrate");
    } else {
      console.error("HSP store failed", errorText(error));
    }
    return undefined;
  }
}

/** Stored list answers for these keys. Keys with none stored are absent. */
export async function storedMetrics(
  keys: readonly string[],
): Promise<Map<string, HspService[]>> {
  const found = new Map<string, HspService[]>();
  for (const key of keys) {
    const services = memoryMetrics.get(key);
    if (services) {
      found.set(key, services);
    }
  }
  const missing = keys.filter((key) => !found.has(key));
  if (missing.length === 0) {
    return found;
  }
  const rows = await withDatabase(
    (sql) => sql<{ key: string; services: HspService[] }[]>`
      select key, services from hsp_metrics
      where key in ${sql([...missing])} and services is not null
    `,
  );
  for (const row of rows ?? []) {
    found.set(row.key, row.services);
    memoryMetrics.set(row.key, row.services);
  }
  return found;
}

/**
 * Claims the call for `key`, so two searches of the same quarter do not both ask HSP.
 * False while another claim is live; the caller then waits for its answer.
 */
export async function claimMetrics(key: string): Promise<boolean> {
  const claimed = await withDatabase(async (sql) => {
    const rows = await sql`
      insert into hsp_metrics (key, claimed_until)
      values (${key}, now() + ${CLAIM_MS} * interval '1 millisecond')
      on conflict (key) do update set claimed_until = excluded.claimed_until
      where hsp_metrics.services is null and hsp_metrics.claimed_until < now()
      returning key
    `;
    return rows.length === 1;
  });
  if (claimed !== undefined) {
    return claimed;
  }
  const now = Date.now();
  if ((memoryClaims.get(key) ?? 0) > now) {
    return false;
  }
  memoryClaims.set(key, now + CLAIM_MS);
  return true;
}

export async function saveMetrics(
  key: string,
  services: readonly HspService[],
): Promise<void> {
  memoryMetrics.set(key, [...services]);
  memoryClaims.delete(key);
  await withDatabase(
    (sql) => sql`
      update hsp_metrics
      set services = ${sql.json(services as unknown as JSONValue)}, fetched_at = now()
      where key = ${key}
    `,
  );
}

/** Gives a claim up after a failed call, so the next search may try again. */
export async function releaseMetrics(key: string): Promise<void> {
  memoryClaims.delete(key);
  await withDatabase(
    (sql) => sql`
      update hsp_metrics set claimed_until = 'epoch'
      where key = ${key} and services is null
    `,
  );
}

/** Takes a shared call slot for about a minute. Undefined while every slot is in use. */
export async function takeCallSlot(owner: string): Promise<number | undefined> {
  const taken = await withDatabase(async (sql) => {
    const [row] = await sql<{ slot: number }[]>`
      update hsp_slots
      set owner = ${owner}, leased_until = now() + ${CLAIM_MS} * interval '1 millisecond'
      where slot = (
        select slot from hsp_slots
        where leased_until < now() and slot <= ${CALL_SLOTS}
        order by slot limit 1 for update skip locked
      )
      returning slot
    `;
    return row ? row.slot : null;
  });
  if (taken !== undefined) {
    return taken ?? undefined;
  }
  const now = Date.now();
  const index = memorySlots.findIndex((slot) => slot.until < now);
  if (index === -1) {
    return undefined;
  }
  memorySlots[index] = { owner, until: now + CLAIM_MS };
  return index + 1;
}

/** Keeps a slot held for a long run of detail calls. */
export async function renewCallSlot(
  slot: number,
  owner: string,
): Promise<void> {
  const memory = memorySlots[slot - 1];
  if (memory?.owner === owner) {
    memory.until = Date.now() + CLAIM_MS;
  }
  await withDatabase(
    (sql) => sql`
      update hsp_slots
      set leased_until = now() + ${CLAIM_MS} * interval '1 millisecond'
      where slot = ${slot} and owner = ${owner}
    `,
  );
}

export async function releaseCallSlot(
  slot: number,
  owner: string,
): Promise<void> {
  if (memorySlots[slot - 1]?.owner === owner) {
    memorySlots[slot - 1] = { owner: "", until: 0 };
  }
  await withDatabase(
    (sql) => sql`
      update hsp_slots set owner = null, leased_until = 'epoch'
      where slot = ${slot} and owner = ${owner}
    `,
  );
}

/** HSP calls made today (London) across every server. */
export async function callsToday(now = new Date()): Promise<number> {
  const day = londonIsoDate(now);
  const stored = await withDatabase(async (sql) => {
    const [row] = await sql<{ calls: number }[]>`
      select calls from hsp_usage where day = ${day}::date
    `;
    return row?.calls ?? 0;
  });
  return Math.max(stored ?? 0, memoryUsage.day === day ? memoryUsage.calls : 0);
}

/** Adds calls to today's count. Called once per search, not per call. */
export async function addCalls(count: number, now = new Date()): Promise<void> {
  if (count <= 0) {
    return;
  }
  const day = londonIsoDate(now);
  memoryUsage =
    memoryUsage.day === day
      ? { day, calls: memoryUsage.calls + count }
      : { day, calls: count };
  await withDatabase(
    (sql) => sql`
      insert into hsp_usage (day, calls) values (${day}::date, ${count})
      on conflict (day) do update set calls = hsp_usage.calls + excluded.calls
    `,
  );
}

/** Stored HSP runs by RID. */
export async function storedRuns(
  rids: readonly string[],
): Promise<Map<string, HspRun>> {
  const found = new Map<string, HspRun>();
  for (const rid of rids) {
    const run = memoryRuns.get(rid);
    if (run) {
      found.set(rid, run);
    }
  }
  const missing = rids.filter((rid) => !found.has(rid));
  if (missing.length === 0) {
    return found;
  }
  const rows = await withDatabase(
    (sql) => sql<
      {
        rid: string;
        service_date: string;
        toc: string;
        calls: string;
        reasons: string;
      }[]
    >`
      select rid, service_date::text as service_date, toc, calls, reasons
      from hsp_backlog_runs where rid in ${sql([...missing])}
    `,
  );
  for (const row of rows ?? []) {
    const calls = decodeCalls(row.calls);
    found.set(row.rid, {
      rid: row.rid,
      serviceDate: row.service_date,
      uid: "",
      toc: row.toc,
      calls,
      reasons: decodeReasons(row.reasons, calls.length),
    });
  }
  return found;
}

export async function saveRuns(runs: readonly HspRun[]): Promise<void> {
  if (runs.length === 0) {
    return;
  }
  for (const run of runs) {
    memoryRuns.set(run.rid, run);
  }
  const rows = runs.map((run) => ({
    rid: run.rid,
    service_date: run.serviceDate,
    toc: run.toc,
    calls: encodeCalls(run.calls),
    reasons: encodeReasons(run.reasons),
  }));
  await withDatabase(
    (sql) => sql`
      insert into hsp_backlog_runs ${sql(rows, "rid", "service_date", "toc", "calls", "reasons")}
      on conflict (rid) do nothing
    `,
  );
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
