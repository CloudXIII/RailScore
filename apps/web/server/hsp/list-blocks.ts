import { addCalendarDays, londonIsoDate } from "@railscore/core";
import { serviceDateOf, serviceKey, type ScheduledService } from "./map";
import { RECENT_RUN_REFRESH_MS, SETTLED_AFTER_DAYS } from "./policy";

/**
 * A service list is stored in Monday-to-Sunday blocks, so a period that moves by a day,
 * or a longer period over the same weeks, reuses the blocks it shares.
 */
export type DateBlock = { readonly start: string; readonly end: string };

export type StoredBlock = {
  readonly services: readonly ScheduledService[];
  /** Last date the stored list covers. Below the block's end when the week was still running. */
  readonly coveredTo: string;
  readonly fetchedAt: Date;
};

const BLOCK_DAYS = 7;

/** Blocks from the Monday on or before `from`. The last block stops at `to`. */
export function weekBlocks(period: { from: string; to: string }): DateBlock[] {
  const blocks: DateBlock[] = [];
  for (
    let start = mondayOnOrBefore(period.from);
    start <= period.to;
    start = addCalendarDays(start, BLOCK_DAYS)
  ) {
    const fullEnd = addCalendarDays(start, BLOCK_DAYS - 1);
    blocks.push({ start, end: fullEnd < period.to ? fullEnd : period.to });
  }
  return blocks;
}

/**
 * A stored block serves when it reaches the block's end. It is kept for good once it
 * was fetched a few days after its last date; before that, HSP may still add runs.
 */
export function isBlockUsable(
  block: DateBlock,
  stored: StoredBlock | undefined,
  now: Date,
): boolean {
  if (!stored || stored.coveredTo < block.end) {
    return false;
  }
  if (
    londonIsoDate(stored.fetchedAt) >=
    addCalendarDays(stored.coveredTo, SETTLED_AFTER_DAYS)
  ) {
    return true;
  }
  return now.getTime() - stored.fetchedAt.getTime() < RECENT_RUN_REFRESH_MS;
}

/** Runs of blocks that need fetching, joined so each run is one HSP call. */
export function missingRanges(
  blocks: readonly DateBlock[],
  usable: readonly boolean[],
): DateBlock[][] {
  const ranges: DateBlock[][] = [];
  let current: DateBlock[] = [];
  blocks.forEach((block, index) => {
    if (usable[index]) {
      if (current.length > 0) {
        ranges.push(current);
      }
      current = [];
      return;
    }
    current.push(block);
  });
  if (current.length > 0) {
    ranges.push(current);
  }
  return ranges;
}

/**
 * Splits one fetched list across its blocks by run date.
 * A run with no readable date, and a service with no runs, go to the last block,
 * which is the one fetched again soonest.
 */
export function splitIntoBlocks(
  services: readonly ScheduledService[],
  blocks: readonly DateBlock[],
): ScheduledService[][] {
  const lists = blocks.map(() => [] as ScheduledService[]);
  const last = blocks.length - 1;
  for (const service of services) {
    const byBlock = blocks.map(() => [] as string[]);
    for (const rid of service.rids) {
      const date = serviceDateOf({}, rid);
      const index = date
        ? blocks.findIndex((block) => date >= block.start && date <= block.end)
        : last;
      byBlock[index === -1 ? last : index]?.push(rid);
    }
    byBlock.forEach((rids, index) => {
      if (rids.length > 0 || (service.rids.length === 0 && index === last)) {
        lists[index]?.push({ ...service, rids });
      }
    });
  }
  return lists;
}

/** Joins block lists into one list for the period. Runs outside the period are dropped. */
export function joinBlocks(
  lists: readonly (readonly ScheduledService[])[],
  period: { from: string; to: string },
): ScheduledService[] {
  const joined = new Map<string, ScheduledService>();
  for (const list of lists) {
    for (const service of list) {
      const key = serviceKey(service);
      const existing = joined.get(key);
      joined.set(
        key,
        existing
          ? { ...existing, rids: [...existing.rids, ...service.rids] }
          : service,
      );
    }
  }
  return [...joined.values()].flatMap((service) => {
    const rids = [...new Set(service.rids)].filter((rid) => {
      const date = serviceDateOf({}, rid);
      return !date || (date >= period.from && date <= period.to);
    });
    if (rids.length === 0 && service.rids.length > 0) {
      return [];
    }
    return [{ ...service, rids }];
  });
}

function mondayOnOrBefore(isoDate: string): string {
  const weekday = new Date(`${isoDate}T00:00:00Z`).getUTCDay();
  return addCalendarDays(isoDate, -((weekday + 6) % 7));
}
