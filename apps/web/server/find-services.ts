import "server-only";
import { randomUUID } from "node:crypto";
import { clockMinutes, departureSlices, trailingDays } from "@railscore/core";
import { afterResponse } from "./after-response";
import { logHspCalls, usesMockData } from "./env";
import { acquireCalculation, releaseCalculation } from "./hsp/calculation-lock";
import { HspRequestError, postHsp } from "./hsp/client";
import { listedPeriod, listState, type StoredList } from "./hsp/list-cache";
import { withListSlot } from "./hsp/list-slots";
import { listBusyRetryMs } from "./hsp/policy";
import { loadStoredLists, saveList } from "./hsp/list-store";
import {
  LIST_TOLERANCES,
  listServices,
  parseServiceMetrics,
  type ScheduledService,
} from "./hsp/map";
import { mockServices } from "./mock/catalogue";
import type { DayPattern } from "./query";

type DayType = Exclude<DayPattern, "all">;

const DAY_TYPES: readonly DayType[] = ["weekdays", "saturday", "sunday"];

const HSP_DAYS: Record<DayType, "WEEKDAY" | "SATURDAY" | "SUNDAY"> = {
  weekdays: "WEEKDAY",
  saturday: "SATURDAY",
  sunday: "SUNDAY",
};

const MEMORY_LISTS = 5000;

/**
 * No new HSP call starts after this. The page then reloads and carries on from the
 * slices already saved. With one list call on top it stays inside the page's 180 s.
 */
const SEARCH_BUDGET_MS = 120_000;

/**
 * A refresh after the response starts no call after this, counted from the start of
 * the search, so its last call also ends inside the page's 180 s.
 */
const REFRESH_BUDGET_MS = 130_000;

/**
 * A quarter-hour on a busy route can take HSP over 40 s while another list call runs.
 * Its own gateway gives up at 55 s, so a list call may run past the usual 30 s request limit.
 */
const LIST_CALL_TIMEOUT_MS = 45_000;

/**
 * Time one HSP call is sized to take, judged from the calls already made in this
 * search. Well under the 30 s request limit, because density varies across the window.
 */
const TARGET_CALL_MS = 20_000;

/** Calls one search keeps in flight. The list slots cap the total across searches. */
const LIST_WORKERS = 2;

/**
 * Some hours HSP takes a second list call alongside another, some hours it answers 503.
 * After a refusal this process makes one call at a time for this long.
 */
const SERIAL_AFTER_REFUSAL_MS = 3 * 60 * 1000;

let serialUntil = 0;

const memoryLists = new Map<string, StoredList>();

type Search = {
  fromCrs: string;
  toCrs: string;
  timeHhmm: string;
  days: DayPattern;
  periodDays: number;
};

type Slice = { fromTime: string; toTime: string };

/** One quarter-hour slice of one day type. */
type Task = { day: DayType; slice: number };

/** Milliseconds HSP took per minute of departures in the last call. Undefined before the first. */
type Pace = { msPerMinute?: number };

type Tally = { lists: number; fresh: number; stale: number; calls: number };

type ServiceSearch = {
  services: ScheduledService[];
  /** Trains that ran early in the period and no longer do. */
  retired: ScheduledService[];
  /** Dates the listed runs cover. Can end a few days early while a newer list loads. */
  period: { from: string; to: string };
};

/**
 * Each quarter-hour of each day type is one list, fetched for the whole period: HSP
 * takes as long for 7 days as for 90, and its counts then describe that period.
 * A list stored in this process or the database is shown at once. One that is a few
 * days old is shown too, and fetched again after the response, so a commuter's daily
 * search does not wait for HSP. Lists that are missing are fetched before the page
 * shows; two calls run side by side, sized from how long the calls before them took.
 */
export async function findServices(
  input: Search & {
    now?: Date;
    /** False leaves lists that are a few days old as they are. */
    refreshStale?: boolean;
  },
): Promise<ServiceSearch> {
  const now = input.now ?? new Date();
  const period = trailingDays(input.periodDays, now);
  if (usesMockData()) {
    return { services: mockServices(input), retired: [], period };
  }
  const dayTypes = input.days === "all" ? DAY_TYPES : [input.days];
  const slices = departureSlices(input.timeHhmm);
  const tasks = dayTypes.flatMap((day) =>
    slices.map((_, slice): Task => ({ day, slice })),
  );
  const keyOf = (task: Task) =>
    listKey(input, task.day, slices[task.slice] as Slice);
  const started = Date.now();
  const tally: Tally = { lists: tasks.length, fresh: 0, stale: 0, calls: 0 };
  let lists: Map<string, StoredList>;

  try {
    lists = await knownLists(tasks.map(keyOf), period.to, now);
    const states = tasks.map((task) =>
      listState(lists.get(keyOf(task)), period.to, now),
    );
    const missing = tasks.filter((_, index) => states[index] === "missing");
    const stale = tasks.filter((_, index) => states[index] === "stale");
    tally.fresh = states.filter((state) => state === "fresh").length;
    tally.stale = stale.length;
    if (missing.length > 0) {
      const fetched = await fetchLists(
        input,
        period,
        slices,
        missing,
        started + SEARCH_BUDGET_MS,
        tally,
      );
      for (const [key, list] of fetched) {
        lists.set(key, list);
      }
    }
    if (stale.length > 0 && input.refreshStale !== false) {
      refreshLater(input, period, slices, stale, started + REFRESH_BUDGET_MS);
    }
  } finally {
    if (logHspCalls()) {
      console.info(
        `[find-services] ${input.fromCrs}-${input.toCrs} ${input.timeHhmm} ${input.days} ${input.periodDays}d: lists=${tally.lists} fresh=${tally.fresh} stale=${tally.stale} hspCalls=${tally.calls} totalMs=${Date.now() - started}`,
      );
    }
  }

  const shown = tasks.flatMap((task) => {
    const list = lists.get(keyOf(task));
    return list ? [list] : [];
  });
  const listed = listedPeriod(shown, input.periodDays, period);
  return {
    ...listServices(
      shown.map((list) => [...list.services]),
      listed.to,
    ),
    period: listed,
  };
}

/** Lists in this process, then the database for keys this process lacks or holds an older copy of. */
async function knownLists(
  keys: readonly string[],
  periodTo: string,
  now: Date,
): Promise<Map<string, StoredList>> {
  const found = new Map<string, StoredList>();
  for (const key of keys) {
    const remembered = memoryLists.get(key);
    if (remembered) {
      found.set(key, remembered);
    }
  }
  const unresolved = keys.filter(
    (key) => listState(found.get(key), periodTo, now) !== "fresh",
  );
  for (const [key, stored] of await loadStoredLists(unresolved)) {
    const remembered = found.get(key);
    if (!remembered || stored.fetchedAt > remembered.fetchedAt) {
      found.set(key, stored);
      remember(key, stored);
    }
  }
  return found;
}

/** Fetches the stale lists again once the response is sent. One refresh per search at a time. */
function refreshLater(
  input: Search,
  period: { from: string; to: string },
  slices: readonly Slice[],
  tasks: readonly Task[],
  stopCallsAt: number,
): void {
  afterResponse(async () => {
    const lease = [
      "list-refresh",
      input.fromCrs,
      input.toCrs,
      input.days,
      input.timeHhmm,
      input.periodDays,
    ].join("|");
    const owner = randomUUID();
    const leaseMs = Math.max(
      1_000,
      stopCallsAt + LIST_CALL_TIMEOUT_MS - Date.now(),
    );
    if (!(await acquireCalculation(lease, owner, Date.now(), leaseMs))) {
      return;
    }
    const started = Date.now();
    const tally: Tally = { lists: tasks.length, fresh: 0, stale: 0, calls: 0 };
    try {
      await fetchLists(input, period, slices, tasks, stopCallsAt, tally);
    } catch (error) {
      if (!(error instanceof HspRequestError && error.kind === "busy")) {
        throw error;
      }
    } finally {
      await releaseCalculation(lease, owner);
      if (logHspCalls()) {
        console.info(
          `[find-services] refreshed ${input.fromCrs}-${input.toCrs} ${input.timeHhmm} ${input.days} ${input.periodDays}d: lists=${tally.lists} hspCalls=${tally.calls} totalMs=${Date.now() - started}`,
        );
      }
    }
  });
}

/**
 * Fetches each task's list for the whole period, two calls at a time. Tasks of one
 * day type that follow on in the clock are asked for in one call, as many as that
 * day's pace says fit in `TARGET_CALL_MS`. Every list is saved as soon as it arrives,
 * so a search that runs out of time carries on from there.
 */
async function fetchLists(
  input: Search,
  period: { from: string; to: string },
  slices: readonly Slice[],
  tasks: readonly Task[],
  stopCallsAt: number,
  tally: Tally,
): Promise<Map<string, StoredList>> {
  const queue = sortTasks([...tasks]);
  const paces = new Map<DayType, Pace>();
  const fetched = new Map<string, StoredList>();
  let failure: unknown;
  let inFlight = 0;
  let running = 0;
  let refusedAlongside = false;
  const callsBefore = tally.calls;

  const worker = async () => {
    running += 1;
    try {
      await work();
    } finally {
      running -= 1;
    }
  };

  const work = async () => {
    while (queue.length > 0 && failure === undefined) {
      if (Date.now() >= stopCallsAt) {
        return;
      }
      const day = (queue[0] as Task).day;
      const pace = paces.get(day) ?? {};
      paces.set(day, pace);
      const chunk = takeChunk(queue, slices, paceEstimate(paces, day));
      const window = {
        fromTime: (slices[(chunk[0] as Task).slice] as Slice).fromTime,
        toTime: (slices[(chunk.at(-1) as Task).slice] as Slice).toTime,
      };
      const minutes = sliceMinutes(window);
      const callStarted = Date.now();
      const alongside = inFlight > 0;
      let services: ScheduledService[];
      inFlight += 1;
      try {
        services = await loadSlice(input, period, day, window, stopCallsAt);
      } catch (error) {
        const busy = error instanceof HspRequestError && error.kind === "busy";
        if (busy && alongside) {
          // HSP would not take this call beside the other. That one carries on alone.
          refusedAlongside = true;
          queue.unshift(...chunk);
          sortTasks(queue);
          if (running > 1) {
            return;
          }
          continue;
        }
        if (busy && chunk.length > 1) {
          // At least halve the next call, so a call that was sized too large
          // shrinks to single slices instead of failing again.
          pace.msPerMinute = Math.max(
            pace.msPerMinute ?? 0,
            (Date.now() - callStarted) / minutes,
            TARGET_CALL_MS / (minutes / 2),
          );
          queue.unshift(...chunk);
          sortTasks(queue);
          continue;
        }
        if (busy) {
          // Refused on its own. Wait a few seconds and ask again, so one busy
          // moment does not hand the page back for a reload.
          const pause = listBusyRetryMs();
          if (Date.now() + pause >= stopCallsAt) {
            failure = error;
            return;
          }
          queue.unshift(...chunk);
          sortTasks(queue);
          await new Promise((resolve) => setTimeout(resolve, pause));
          continue;
        }
        failure = error;
        return;
      } finally {
        inFlight -= 1;
      }
      pace.msPerMinute = (Date.now() - callStarted) / minutes;
      tally.calls += 1;

      const bySlice = splitBySlice(
        services,
        chunk.map((task) => slices[task.slice] as Slice),
      );
      await Promise.all(
        chunk.map(async (task, position) => {
          const key = listKey(input, day, slices[task.slice] as Slice);
          const list: StoredList = {
            services: bySlice[position] ?? [],
            coveredTo: period.to,
            fetchedAt: new Date(),
          };
          remember(key, list);
          fetched.set(key, list);
          await saveList(key, list.services, period.to);
        }),
      );
    }
  };

  const workers = Date.now() < serialUntil ? 1 : LIST_WORKERS;
  await Promise.all(Array.from({ length: workers }, worker));
  // A refusal while HSP answered nothing else is HSP being busy, not a limit on two calls.
  if (refusedAlongside && tally.calls > callsBefore) {
    serialUntil = Date.now() + SERIAL_AFTER_REFUSAL_MS;
  }
  if (failure !== undefined) {
    throw failure;
  }
  if (queue.length > 0) {
    throw new HspRequestError("busy");
  }
  return fetched;
}

/** The day's own pace, or before its first call the slowest pace seen on another day. */
function paceEstimate(
  paces: ReadonlyMap<DayType, Pace>,
  day: DayType,
): number | undefined {
  const own = paces.get(day)?.msPerMinute;
  if (own !== undefined) {
    return own;
  }
  const others = [...paces.values()]
    .map((pace) => pace.msPerMinute)
    .filter((value): value is number => value !== undefined);
  return others.length > 0 ? Math.max(...others) : undefined;
}

/**
 * Removes and returns the tasks for the next call, from the front of `queue`. Tasks join
 * while they share the day type, follow on in the clock and fit the time target.
 * Without a pace yet, one slice.
 */
function takeChunk(
  queue: Task[],
  slices: readonly Slice[],
  msPerMinute: number | undefined,
): Task[] {
  const head = queue[0] as Task;
  const chunk = [head];
  if (msPerMinute !== undefined) {
    const allowedMinutes = TARGET_CALL_MS / msPerMinute;
    let minutes = sliceMinutes(slices[head.slice] as Slice);
    for (const next of queue.slice(1)) {
      const previousTask = chunk.at(-1) as Task;
      const previous = slices[previousTask.slice] as Slice;
      const slice = slices[next.slice] as Slice;
      const followsOn =
        next.day === head.day &&
        next.slice === previousTask.slice + 1 &&
        clockMinutes(slice.fromTime) === clockMinutes(previous.toTime) + 1;
      const length = sliceMinutes(slice);
      if (!followsOn || minutes + length > allowedMinutes) {
        break;
      }
      chunk.push(next);
      minutes += length;
    }
  }
  queue.splice(0, chunk.length);
  return chunk;
}

function sortTasks(tasks: Task[]): Task[] {
  return tasks.sort(
    (left, right) =>
      DAY_TYPES.indexOf(left.day) - DAY_TYPES.indexOf(right.day) ||
      left.slice - right.slice,
  );
}

/** Sorts one call's services into its slices by departure. One outside every slice goes to the last. */
function splitBySlice(
  services: readonly ScheduledService[],
  slices: readonly Slice[],
): ScheduledService[][] {
  const lists = slices.map(() => [] as ScheduledService[]);
  for (const service of services) {
    const index = slices.findIndex(
      (slice) =>
        service.publicDeparture >= slice.fromTime &&
        service.publicDeparture <= slice.toTime,
    );
    lists[index === -1 ? slices.length - 1 : index]?.push(service);
  }
  return lists;
}

function sliceMinutes(slice: Slice): number {
  return clockMinutes(slice.toTime) - clockMinutes(slice.fromTime) + 1;
}

async function loadSlice(
  input: { fromCrs: string; toCrs: string },
  period: { from: string; to: string },
  day: DayType,
  window: Slice,
  deadline: number,
): Promise<ScheduledService[]> {
  // A 503 fails this call at once. The search retries it while time remains,
  // and a second call running beside another gives its place up.
  const payload = await withListSlot(deadline, () =>
    postHsp(
      "/serviceMetrics",
      {
        from_loc: input.fromCrs,
        to_loc: input.toCrs,
        from_time: window.fromTime,
        to_time: window.toTime,
        from_date: period.from,
        to_date: period.to,
        days: HSP_DAYS[day],
        tolerance: [...LIST_TOLERANCES],
      },
      { timeoutMs: LIST_CALL_TIMEOUT_MS, retryOverloaded: false },
    ),
  );
  return parseServiceMetrics(payload).map((service) => ({
    ...service,
    days: [day],
  }));
}

/** Each quarter-hour slice of each day type and period length is its own cache entry. */
function listKey(
  input: { fromCrs: string; toCrs: string; periodDays: number },
  day: DayType,
  window: Slice,
): string {
  return [
    input.fromCrs,
    input.toCrs,
    day,
    window.fromTime,
    window.toTime,
    `${input.periodDays}d`,
  ].join("|");
}

function remember(key: string, list: StoredList): void {
  memoryLists.delete(key);
  if (memoryLists.size >= MEMORY_LISTS) {
    const oldest = memoryLists.keys().next().value;
    if (oldest) {
      memoryLists.delete(oldest);
    }
  }
  memoryLists.set(key, list);
}
