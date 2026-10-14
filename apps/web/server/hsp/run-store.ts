import "server-only";
import type { JSONValue } from "postgres";
import { addCalendarDays, londonIsoDate } from "@railscore/core";
import { database } from "../db";
import { errorText } from "../error-text";
import { isUnreadableDetails, serviceDateOf } from "./map";
import { isStoredRunReusable, isUnreadablePlaceholderReusable } from "./policy";

type MemoryRun = { payload: unknown; serviceDate: string; fetchedAt: Date };

/** Same-process copy, so a continuation on this server still sees runs when the database is absent. */
const memoryRuns = new Map<string, MemoryRun>();

/** Stored serviceDetails payloads that are still trustworthy, keyed by RID. */
export async function loadStoredRuns(
  rids: readonly string[],
  now: Date,
): Promise<Map<string, unknown>> {
  const stored = new Map<string, unknown>();
  if (rids.length === 0) {
    return stored;
  }
  for (const rid of rids) {
    const remembered = memoryRuns.get(rid);
    if (
      remembered &&
      keepStored(
        remembered.serviceDate,
        remembered.fetchedAt,
        remembered.payload,
        now,
      )
    ) {
      stored.set(rid, remembered.payload);
    }
  }
  const sql = database();
  if (!sql) {
    return stored;
  }
  try {
    const rows = await sql<
      {
        rid: string;
        service_date: string;
        payload: unknown;
        fetched_at: Date;
      }[]
    >`
      select rid, service_date::text as service_date, payload, fetched_at
      from hsp_runs
      where rid in ${sql([...rids])}
    `;
    for (const row of rows) {
      const remembered = memoryRuns.get(row.rid);
      if (
        remembered &&
        stored.has(row.rid) &&
        remembered.fetchedAt.getTime() >= fetchedMs(row.fetched_at)
      ) {
        continue;
      }
      if (keepStored(row.service_date, row.fetched_at, row.payload, now)) {
        stored.set(row.rid, row.payload);
      }
    }
  } catch (error) {
    console.error(
      "Stored runs could not be read; fetching from HSP",
      errorText(error),
    );
  }
  return stored;
}

export async function saveRun(
  rid: string,
  payload: unknown,
  serviceDate = serviceDateOf(payload, rid),
): Promise<void> {
  const date = serviceDate ?? addCalendarDays(londonIsoDate(new Date()), -4);
  memoryRuns.set(rid, { payload, serviceDate: date, fetchedAt: new Date() });
  const sql = database();
  if (!sql) {
    return;
  }
  try {
    await sql`
      insert into hsp_runs (rid, service_date, payload, fetched_at)
      values (${rid}, ${date}::date, ${sql.json(payload as JSONValue)}, now())
      on conflict (rid) do update
      set service_date = excluded.service_date, payload = excluded.payload, fetched_at = excluded.fetched_at
    `;
  } catch (error) {
    console.error("A run could not be stored", errorText(error));
  }
}

function fetchedMs(value: Date | string): number {
  return value instanceof Date ? value.getTime() : new Date(value).getTime();
}

function keepStored(
  serviceDate: string,
  fetchedAt: Date,
  payload: unknown,
  now: Date,
): boolean {
  if (isUnreadableDetails(payload)) {
    return isUnreadablePlaceholderReusable(fetchedAt, now);
  }
  return isStoredRunReusable(serviceDate, fetchedAt, now);
}
