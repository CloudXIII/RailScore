import "server-only";
import type { JSONValue } from "postgres";
import { database } from "../db";
import { errorText } from "../error-text";
import type { StoredBlock } from "./list-blocks";
import type { ScheduledService } from "./map";

/** Stored blocks by key. Whether each one may still be used is decided by the caller. */
export async function loadStoredBlocks(
  keys: readonly string[],
): Promise<Map<string, StoredBlock>> {
  const found = new Map<string, StoredBlock>();
  const sql = database();
  if (!sql || keys.length === 0) {
    return found;
  }
  try {
    // One parameter per key. Passing them as one array makes Postgres reject the list.
    const rows = await sql<
      {
        slice_key: string;
        services: ScheduledService[];
        covered_to: string;
        fetched_at: Date;
      }[]
    >`
      select slice_key, services, covered_to::text as covered_to, fetched_at
      from hsp_service_lists
      where slice_key in ${sql([...keys])}
        and covered_to is not null
    `;
    for (const row of rows) {
      found.set(row.slice_key, {
        services: row.services,
        coveredTo: row.covered_to,
        fetchedAt:
          row.fetched_at instanceof Date
            ? row.fetched_at
            : new Date(row.fetched_at),
      });
    }
  } catch (error) {
    console.error(
      "Stored service lists could not be read; fetching from HSP",
      errorText(error),
    );
  }
  return found;
}

export async function saveBlock(
  key: string,
  services: readonly ScheduledService[],
  coveredTo: string,
): Promise<void> {
  const sql = database();
  if (!sql) {
    return;
  }
  try {
    await sql`
      insert into hsp_service_lists (slice_key, services, covered_to, fetched_at)
      values (${key}, ${sql.json(services as unknown as JSONValue)}, ${coveredTo}::date, now())
      on conflict (slice_key) do update
      set services = excluded.services, covered_to = excluded.covered_to, fetched_at = excluded.fetched_at
    `;
  } catch (error) {
    console.error("A service list could not be stored", errorText(error));
  }
}
