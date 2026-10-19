import "server-only";
import { database } from "../db";
import { errorText } from "../error-text";
import { LEASE_MS, processGate } from "./calculation-chunk";

let databaseLockUnavailable = false;

/**
 * One calculation talks to HSP for this service. Others read stored runs.
 * The database lease covers every server instance; the process gate covers
 * the case with no database.
 */
export async function acquireCalculation(
  serviceKey: string,
  owner: string,
  now = Date.now(),
  leaseMs = LEASE_MS,
): Promise<boolean> {
  if (!processGate.tryAcquire(serviceKey, owner, now, leaseMs)) {
    return false;
  }
  const shared = await tryDatabaseLease(serviceKey, owner, leaseMs);
  if (shared === false) {
    processGate.release(serviceKey, owner);
    return false;
  }
  return true;
}

export async function releaseCalculation(
  serviceKey: string,
  owner: string,
): Promise<void> {
  processGate.release(serviceKey, owner);
  const sql = database();
  if (!sql || databaseLockUnavailable) {
    return;
  }
  try {
    await sql`
      update hsp_calculation_lock
      set leased_until = clock_timestamp()
      where service_key = ${serviceKey} and owner = ${owner}
    `;
  } catch (error) {
    databaseLockUnavailable = true;
    console.error("Calculation lock could not be released", errorText(error));
  }
}

/** `true` acquired, `false` held by someone else, `undefined` when the table is unavailable. */
async function tryDatabaseLease(
  serviceKey: string,
  owner: string,
  leaseMs: number,
): Promise<boolean | undefined> {
  const sql = database();
  if (!sql || databaseLockUnavailable) {
    return undefined;
  }
  try {
    const rows = await sql`
      insert into hsp_calculation_lock (service_key, owner, leased_until)
      values (${serviceKey}, ${owner}, clock_timestamp() + ${leaseMs}::int * interval '1 millisecond')
      on conflict (service_key) do update
      set owner = excluded.owner, leased_until = excluded.leased_until
      where hsp_calculation_lock.leased_until < clock_timestamp()
      returning service_key
    `;
    return rows.length > 0;
  } catch (error) {
    databaseLockUnavailable = true;
    console.error(
      "Calculation lock unavailable, using the in-process gate",
      errorText(error),
    );
    return undefined;
  }
}
