import "server-only";
import { departureWindows, trailingDays } from "@railscore/core";
import { logHspCalls, usesMockData } from "./env";
import { postHsp } from "./hsp/client";
import {
  isBlockUsable,
  joinBlocks,
  missingRanges,
  splitIntoBlocks,
  weekBlocks,
  type DateBlock,
  type StoredBlock,
} from "./hsp/list-blocks";
import { loadStoredBlocks, saveBlock } from "./hsp/list-store";
import {
  listServices,
  parseServiceMetrics,
  type ScheduledService,
  type ServiceDay,
} from "./hsp/map";
import { mockServices } from "./mock/catalogue";

type DayPattern = "weekdays" | "saturday" | "sunday" | "all";

const HSP_DAYS: Record<
  Exclude<DayPattern, "all">,
  "WEEKDAY" | "SATURDAY" | "SUNDAY"
> = {
  weekdays: "WEEKDAY",
  saturday: "SATURDAY",
  sunday: "SUNDAY",
};

const MEMORY_BLOCKS = 600;

const memoryBlocks = new Map<string, StoredBlock>();

type ServiceSearch = {
  services: ScheduledService[];
  /** Trains that ran early in the period and no longer do. */
  retired: ScheduledService[];
  period: { from: string; to: string };
};

/**
 * Every day type is loaded before the list is shown. The calls stay one after
 * another: sending them together gets a 503. Lists are saved in weekly blocks, in this
 * process and in the database, so a later search only asks HSP for the weeks it lacks.
 */
export async function findServices(input: {
  fromCrs: string;
  toCrs: string;
  timeHhmm: string;
  days: DayPattern;
  periodDays: number;
  now?: Date;
}): Promise<ServiceSearch> {
  const period = trailingDays(input.periodDays, input.now ?? new Date());
  if (usesMockData()) {
    return { services: mockServices(input), retired: [], period };
  }
  const dayTypes =
    input.days === "all"
      ? (["weekdays", "saturday", "sunday"] as const)
      : [input.days];
  const windows = departureWindows(input.timeHhmm);
  const jobs = dayTypes.flatMap((day) =>
    windows.map((window) => ({ day, window })),
  );
  const groups: ScheduledService[][] = [];
  const started = Date.now();
  const blocks = weekBlocks(period);
  const tally = { blocks: 0, memory: 0, stored: 0, calls: 0 };

  for (const job of jobs) {
    groups.push(
      await loadDayWindow(input, period, blocks, job.day, job.window, tally),
    );
  }

  if (logHspCalls()) {
    console.info(
      `[find-services] ${input.fromCrs}-${input.toCrs} ${input.timeHhmm} ${input.days} ${input.periodDays}d: blocks=${tally.blocks} memory=${tally.memory} stored=${tally.stored} hspCalls=${tally.calls} totalMs=${Date.now() - started}`,
    );
  }
  return { ...listServices(groups, period.to), period };
}

/**
 * Services for one day type and one clock window.
 * Saved weeks are reused. Each run of missing weeks is one HSP call, in order.
 */
async function loadDayWindow(
  input: { fromCrs: string; toCrs: string },
  period: { from: string; to: string },
  blocks: readonly DateBlock[],
  day: Exclude<DayPattern, "all">,
  window: { fromTime: string; toTime: string },
  tally: { blocks: number; memory: number; stored: number; calls: number },
): Promise<ScheduledService[]> {
  const keys = blocks.map((block) => blockKey(input, day, window, block));
  const now = new Date();
  const found = new Map<string, StoredBlock>();
  for (const key of keys) {
    const remembered = memoryBlocks.get(key);
    if (remembered) {
      found.set(key, remembered);
    }
  }
  const unresolved = keys.filter(
    (key, index) =>
      !isBlockUsable(blocks[index] as DateBlock, found.get(key), now),
  );
  const fromMemory = keys.length - unresolved.length;
  for (const [key, stored] of await loadStoredBlocks(unresolved)) {
    found.set(key, stored);
    memoryBlocks.set(key, stored);
  }
  const usable = blocks.map((block, index) =>
    isBlockUsable(block, found.get(keys[index] as string), now),
  );
  tally.blocks += blocks.length;
  tally.memory += fromMemory;
  tally.stored += usable.filter(Boolean).length - fromMemory;

  const lists = new Map<string, readonly ScheduledService[]>();
  blocks.forEach((_, index) => {
    if (usable[index]) {
      lists.set(
        keys[index] as string,
        (found.get(keys[index] as string) as StoredBlock).services,
      );
    }
  });
  for (const range of missingRanges(blocks, usable)) {
    const span = {
      from: (range[0] as DateBlock).start,
      to: (range.at(-1) as DateBlock).end,
    };
    const services = await loadSlice(input, span, day, window);
    tally.calls += 1;
    const split = splitIntoBlocks(services, range);
    for (const [index, block] of range.entries()) {
      const key = blockKey(input, day, window, block);
      const list = split[index] ?? [];
      remember(key, {
        services: list,
        coveredTo: block.end,
        fetchedAt: new Date(),
      });
      lists.set(key, list);
      await saveBlock(key, list, block.end);
    }
  }
  return joinBlocks(
    keys.map((key) => lists.get(key) ?? []),
    period,
  );
}

async function loadSlice(
  input: { fromCrs: string; toCrs: string },
  period: { from: string; to: string },
  day: Exclude<DayPattern, "all">,
  window: { fromTime: string; toTime: string },
): Promise<ScheduledService[]> {
  const payload = await postHsp("/serviceMetrics", {
    from_loc: input.fromCrs,
    to_loc: input.toCrs,
    from_time: window.fromTime,
    to_time: window.toTime,
    from_date: period.from,
    to_date: period.to,
    days: HSP_DAYS[day],
    tolerance: ["5"],
  });
  return parseServiceMetrics(payload).map((service) => ({
    ...service,
    days: [day],
  }));
}

/** Each HSP window is its own cache entry. A search that crosses midnight is two windows. */
function blockKey(
  input: { fromCrs: string; toCrs: string },
  day: ServiceDay,
  window: { fromTime: string; toTime: string },
  block: DateBlock,
): string {
  return [
    input.fromCrs,
    input.toCrs,
    day,
    window.fromTime,
    window.toTime,
    block.start,
    "week",
  ].join("|");
}

function remember(key: string, block: StoredBlock): void {
  if (memoryBlocks.size > MEMORY_BLOCKS) {
    const oldest = memoryBlocks.keys().next().value;
    if (oldest) {
      memoryBlocks.delete(oldest);
    }
  }
  memoryBlocks.set(key, block);
}
