import "server-only";
import { randomUUID } from "node:crypto";
import { database, databaseBudgetMs, isDatabaseTimeout } from "../db";
import { hspListSlotCount, hspListStartGapMs } from "../env";
import { errorText } from "../error-text";
import { HspRequestError } from "./client";
import {
  LIST_SLOT_LEASE_MS,
  releaseListSlot,
  takeListSlot,
  type ListSlot,
} from "./policy";

const memorySlots: ListSlot[] = [];

/** The in-process slots for the current count. Extra rows from a higher count are dropped. */
function activeMemorySlots(): ListSlot[] {
  const count = hspListSlotCount();
  while (memorySlots.length < count) {
    memorySlots.push({ startedAt: 0, leasedUntil: 0 });
  }
  memorySlots.length = count;
  return memorySlots;
}

let databaseSlotsUnavailable = false;

type Held = { readonly shared: boolean; readonly index: number };

/**
 * Runs one serviceMetrics call inside a list slot. With a database the slots are shared
 * by every server instance; without one they only cover this process.
 * Throws "busy" when no slot is free before `deadline`.
 */
const LEASE_RENEW_MS = 15_000;

export async function withListSlot<T>(
  deadline: number,
  run: () => Promise<T>,
): Promise<T> {
  const owner = randomUUID();
  const held = await waitForSlot(owner, deadline);
  if (!held) {
    throw new HspRequestError("busy");
  }
  const renew = held.shared
    ? setInterval(() => {
        void renewLease(held, owner);
      }, LEASE_RENEW_MS)
    : undefined;
  try {
    return await run();
  } finally {
    if (renew) clearInterval(renew);
    await release(held, owner);
  }
}

async function waitForSlot(
  owner: string,
  deadline: number,
): Promise<Held | undefined> {
  const first = await tryTake(owner, deadline);
  if (first !== "gap") return first;
  const wait = Math.min(hspListStartGapMs(), deadline - Date.now());
  if (wait <= 0) return undefined;
  await new Promise((resolve) => setTimeout(resolve, wait));
  const second = await tryTake(owner, deadline);
  return second === "gap" ? undefined : second;
}

async function tryTake(
  owner: string,
  deadline: number,
): Promise<Held | "gap" | undefined> {
  const sql = database();
  if (sql && !databaseSlotsUnavailable) {
    const budgetMs = databaseBudgetMs(deadline);
    try {
      // SKIP LOCKED: a row another request is claiming is not a queue. If every
      // slot is already taken, this returns at once instead of waiting.
      const slot = await sql.begin(async (tx) => {
        await tx.unsafe(`set local lock_timeout = '${budgetMs}ms'`);
        await tx.unsafe(`set local statement_timeout = '${budgetMs}ms'`);
        const rows = await tx<
          { slot: number; free: boolean; recent: boolean }[]
        >`
          select slot,
            leased_until <= clock_timestamp() as free,
            started_at > clock_timestamp() - ${hspListStartGapMs()}::int * interval '1 millisecond' as recent
          from hsp_list_slots
          where slot <= ${hspListSlotCount()}
          order by slot
          for update skip locked
        `;
        if (rows.length < hspListSlotCount()) {
          const [present] = await tx<{ count: number }[]>`
            select count(*)::int as count
            from hsp_list_slots
            where slot <= ${hspListSlotCount()}
          `;
          if (!present || present.count === 0) {
            throw new Error("hsp_list_slots has no rows");
          }
          if (rows.length === 0) return undefined;
        }
        const free = rows.find((row) => row.free);
        if (!free) return undefined;
        if (rows.some((row) => row.recent)) return "gap";
        await tx`
          update hsp_list_slots
          set owner = ${owner},
            started_at = clock_timestamp(),
            leased_until = clock_timestamp() + ${LIST_SLOT_LEASE_MS}::int * interval '1 millisecond'
          where slot = ${free.slot}
        `;
        return free.slot;
      });
      if (slot === "gap") return "gap";
      return slot === undefined ? undefined : { shared: true, index: slot };
    } catch (error) {
      if (isDatabaseTimeout(error)) throw new HspRequestError("busy");
      databaseSlotsUnavailable = true;
      console.error(
        "HSP list slots unavailable, using the in-process limit",
        errorText(error),
      );
    }
  }
  const now = Date.now();
  const slots = activeMemorySlots();
  const gapMs = hspListStartGapMs();
  if (slots.some((slot) => now - slot.startedAt < gapMs)) {
    return "gap";
  }
  const index = takeListSlot(slots, owner, now, gapMs, LIST_SLOT_LEASE_MS);
  return index === undefined ? undefined : { shared: false, index };
}

async function renewLease(held: Held, owner: string): Promise<void> {
  const sql = database();
  if (!sql) return;
  try {
    await sql`
      update hsp_list_slots
      set leased_until = clock_timestamp() + ${LIST_SLOT_LEASE_MS}::int * interval '1 millisecond'
      where slot = ${held.index} and owner = ${owner}
    `;
  } catch (error) {
    console.error("An HSP list slot could not be renewed", errorText(error));
  }
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
