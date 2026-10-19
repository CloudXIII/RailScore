import "server-only";
import { hspMaxRequestsPerSecond } from "../env";
import { database } from "../db";
import { errorText } from "../error-text";
import { takeToken, type TokenBucket } from "./policy";

/**
 * One detail call at a time, three a second. Two at once draws 503s, and the
 * time spent retrying them is longer than the time saved. Shared by every
 * server instance.
 */
let memoryBucket: TokenBucket | undefined;

/**
 * Waits for one HSP request slot. With a database the bucket is shared by every
 * server instance; without one it only covers this process.
 * Returns false when no slot is free before the deadline.
 */
export async function waitForHspSlot(deadline: number): Promise<boolean> {
  const perSecond = hspMaxRequestsPerSecond();
  for (;;) {
    if (await tryTake(perSecond)) {
      return true;
    }
    const wait = (1000 / perSecond) * (0.5 + Math.random());
    if (Date.now() + wait > deadline) {
      return false;
    }
    await new Promise((resolve) => setTimeout(resolve, wait));
  }
}

async function tryTake(perSecond: number): Promise<boolean> {
  const sql = database();
  if (sql) {
    try {
      const rows = await sql`
        update hsp_rate_limit
        set tokens = least(${perSecond}::float8, tokens + extract(epoch from clock_timestamp() - updated_at)::float8 * ${perSecond}::float8) - 1,
            updated_at = clock_timestamp()
        where id = 1
          and least(${perSecond}::float8, tokens + extract(epoch from clock_timestamp() - updated_at)::float8 * ${perSecond}::float8) >= 1::float8
        returning id
      `;
      return rows.length > 0;
    } catch (error) {
      console.error(
        "HSP rate limit table unavailable, using the in-process limit",
        errorText(error),
      );
    }
  }
  memoryBucket ??= { tokens: perSecond, updatedAt: Date.now() };
  return takeToken(memoryBucket, Date.now(), perSecond, perSecond);
}
