import "server-only";
import { randomUUID } from "node:crypto";
import { database } from "../db";
import { errorText } from "../error-text";
import { HspRequestError } from "./client";
import {
  LIST_SLOT_COUNT,
  LIST_SLOT_LEASE_MS,
  LIST_START_GAP_MS,
  releaseListSlot,
  takeListSlot,
  type ListSlot,
} from "./policy";

const memorySlots: ListSlot[] = Array.from({ length: LIST_SLOT_COUNT }, () => ({
  startedAt: 0,
  leasedUntil: 0,
}));

let databaseSlotsUnavailable = false;

type Held = { readonly shared: boolean; readonly index: number };

/**
 * Runs one serviceMetrics call inside a list slot. With a database the slots are shared
 * by every server instance; without one they only cover this process.
 * Throws "busy" when no slot is free before `deadline`.
 */
export async function withListSlot<T>(
  deadline: number,
  run: () => Promise<T>,
): Promise<T> {
  const owner = randomUUID();
  const held = await waitForSlot(owner, deadline);
  if (!held) {
    throw new HspRequestError("busy");
  }
  try {
    return await run();
  } finally {
    await release(held, owner);
  }
}

async function waitForSlot(
  owner: string,
  deadline: number,
): Promise<Held | undefined> {
  for (;;) {
    const held = await tryTake(owner);
    if (held) {
      return held;
    }
    const wait = 250 + Math.random() * 250;
    if (Date.now() + wait > deadline) {
      return undefined;
    }
    await new Promise((resolve) => setTimeout(resolve, wait));
  }
}

async function tryTake(owner: string): Promise<Held | undefined> {
  const sql = database();
  if (sql && !databaseSlotsUnavailable) {
    try {
      // Every slot row is locked, so two instances cannot both see the gap as clear.
      const slot = await sql.begin(async (tx) => {
        const rows = await tx<
          { slot: number; free: boolean; recent: boolean }[]
        >`
          select slot,
            leased_until <= clock_timestamp() as free,
            started_at > clock_timestamp() - ${LIST_START_GAP_MS}::int * interval '1 millisecond' as recent
          from hsp_list_slots
          where slot <= ${LIST_SLOT_COUNT}
          order by slot
          for update
        `;
        if (rows.length === 0) {
          throw new Error("hsp_list_slots has no rows");
        }
        const free = rows.find((row) => row.free);
        if (!free || rows.some((row) => row.recent)) {
          return undefined;
        }
        await tx`
          update hsp_list_slots
          set owner = ${owner},
            started_at = clock_timestamp(),
            leased_until = clock_timestamp() + ${LIST_SLOT_LEASE_MS}::int * interval '1 millisecond'
          where slot = ${free.slot}
        `;
        return free.slot;
      });
      return slot === undefined ? undefined : { shared: true, index: slot };
    } catch (error) {
      databaseSlotsUnavailable = true;
      console.error(
        "HSP list slots unavailable, using the in-process limit",
        errorText(error),
      );
    }
  }
  const index = takeListSlot(
    memorySlots,
    owner,
    Date.now(),
    LIST_START_GAP_MS,
    LIST_SLOT_LEASE_MS,
  );
  return index === undefined ? undefined : { shared: false, index };
}

async function release(held: Held, owner: string): Promise<void> {
  if (!held.shared) {
    releaseListSlot(memorySlots, held.index, owner, Date.now());
    return;
  }
  const sql = database();
  if (!sql) {
    return;
  }
  try {
    await sql`
      update hsp_list_slots
      set owner = null, leased_until = clock_timestamp()
      where slot = ${held.index} and owner = ${owner}
    `;
  } catch (error) {
    console.error("An HSP list slot could not be released", errorText(error));
  }
}
