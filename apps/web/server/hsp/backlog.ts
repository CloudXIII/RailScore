import "server-only";
import { randomUUID } from "node:crypto";
import type { HistoricalRun } from "@railscore/core";
import { darwinFirstDay, hspConnection, hspDailyCallLimit } from "../env";
import { errorText } from "../error-text";
import type { DayPattern } from "../query";
import { serviceDateOf, type ServiceDay } from "../services/map";
import { HspCallError, postHsp, takeCallCount } from "./client";
import { historicalRunFromHsp, runFromDetails, type HspRun } from "./details";
import {
  matchBacklog,
  quarterOf,
  quartersOf,
  type BacklogTrain,
  type Quarter,
} from "./match";
import {
  METRIC_TOLERANCES,
  parseServiceMetrics,
  type HspCounts,
  type HspService,
} from "./metrics";
import { searchPeriods, type DateSpan } from "./period";
import {
  addCalls,
  callsToday,
  claimMetrics,
  releaseCallSlot,
  releaseMetrics,
  renewCallSlot,
  saveMetrics,
  saveRuns,
  storedMetrics,
  storedRuns,
  takeCallSlot,
} from "./store";

export type BacklogQuery = {
  readonly fromCrs: string;
  readonly toCrs: string;
  readonly days: DayPattern;
  readonly periodDays: number;
  readonly trains: readonly BacklogTrain[];
  /** Key of the one train whose runs are fetched one by one, for its arrival history. */
  readonly runsOf?: string;
};

export type BacklogEvent =
  /** HSP's counts for one listed train, by day type, before Darwin's first day. */
  | {
      readonly type: "train";
      readonly key: string;
      readonly byDay: Partial<Record<ServiceDay, HspCounts>>;
      /** Runs HSP listed for the train, each one fetched for the arrival history. */
      readonly runCount: number;
    }
  /** HSP gave no answer for these trains in time. */
  | { readonly type: "missing"; readonly keys: readonly string[] }
  /** Runs of the history train, newest first, classified by the HSP rules. */
  | { readonly type: "runs"; readonly runs: readonly HistoricalRun[] }
  | { readonly type: "end" };

const HSP_DAYS: Record<ServiceDay, "WEEKDAY" | "SATURDAY" | "SUNDAY"> = {
  weekdays: "WEEKDAY",
  saturday: "SATURDAY",
  sunday: "SUNDAY",
};

const ALL_DAYS: readonly ServiceDay[] = ["weekdays", "saturday", "sunday"];

/** HSP's gateway gives up at about 55 s. Successes still arrive at 53 s. */
const LIST_CALL_TIMEOUT_MS = 54_000;

const DETAIL_CALL_TIMEOUT_MS = 10_000;

/** A 503 on a detail call clears after about 300 ms; an immediate retry fails. */
const DETAIL_RETRY_MS = 300;

const DETAIL_ATTEMPTS = 6;

/** Pause after a refused list call before asking again. */
const LIST_RETRY_MS = 1_000;

const LIST_ATTEMPTS = 4;

/** How often a search checks for a free slot, or for another search's answer. */
const POLL_MS = 400;

/** Runs refused in a row after their retries that end a history's detail calls. */
const REFUSED_RUNS = 3;

/** A history renews its slot this often while its detail calls run. */
const SLOT_RENEW_MS = 20_000;

/** Runs written to the database at once. */
const SAVE_EVERY = 10;

/**
 * Fills the days before Darwin from HSP for the listed trains, sending each result as it
 * arrives: a train's counts once every quarter-hour it leaves in is answered, then, for the
 * history train, its runs. Answers already stored are sent first. No new HSP call starts
 * after `deadline`, nor once `signal` aborts; a call in flight still finishes and is stored.
 */
export async function streamBacklog(
  query: BacklogQuery,
  emit: (event: BacklogEvent) => void,
  options: { signal?: AbortSignal; deadline: number; now?: Date },
): Promise<void> {
  const now = options.now ?? new Date();
  const span = searchPeriods(
    query.periodDays,
    now,
    darwinFirstDay(),
    hspConnection() !== undefined,
  ).hsp;
  const keys = query.trains.map((train) => train.key);
  if (!span || (await callsToday(now)) >= hspDailyCallLimit()) {
    emit({ type: "missing", keys: span ? keys : [] });
    emit({ type: "end" });
    return;
  }
  const stop = () =>
    Boolean(options.signal?.aborted) || Date.now() > options.deadline;
  try {
    const days = query.days === "all" ? ALL_DAYS : [query.days];
    const tasks = quartersOf(query.trains).flatMap((quarter) =>
      days.map((day) => ({
        quarter,
        day,
        key: metricsKey(query, day, quarter, span),
      })),
    );
    const answers = await storedMetrics(tasks.map((task) => task.key));
    const sent = new Set<string>();
    const missing = new Set<string>();
    const failedTasks = new Set<string>();
    const history = query.trains.find((train) => train.key === query.runsOf);
    let runs: Promise<void> | undefined;
    const emitReady = () => {
      for (const train of query.trains) {
        if (sent.has(train.key) || missing.has(train.key)) {
          continue;
        }
        const own = tasksOf(train, tasks);
        if (own.some((task) => failedTasks.has(task.key))) {
          missing.add(train.key);
          emit({ type: "missing", keys: [train.key] });
          continue;
        }
        if (!own.every((task) => answers.has(task.key))) {
          continue;
        }
        sent.add(train.key);
        const result = trainResult(train, own, answers);
        emit({
          type: "train",
          key: train.key,
          byDay: result.byDay,
          runCount: result.rids.length,
        });
        if (train === history && result.rids.length > 0) {
          // The history train's runs start now, beside the other trains' lists.
          runs = streamRuns(query, result.rids, emit, stop);
        }
      }
    };
    emitReady();

    // The history train's quarter-hours first, then the rest in clock order.
    const first = history ? new Set(tasksOf(history, tasks)) : new Set();
    const queue = tasks
      .filter((task) => !answers.has(task.key))
      .sort(
        (left, right) => Number(first.has(right)) - Number(first.has(left)),
      );
    // One quarter-hour that HSP would not answer after its retries ends the lists: HSP is
    // down or overloaded, and the trains keep Darwin's figures rather than wait.
    let refused = false;
    const worker = async () => {
      for (let task = queue.shift(); task; task = queue.shift()) {
        const services =
          stop() || refused
            ? undefined
            : await fetchMetrics(query, task, span, options.deadline, stop);
        if (services) {
          answers.set(task.key, services);
        } else {
          refused = true;
          failedTasks.add(task.key);
        }
        emitReady();
      }
    };
    // A history leaves one slot free for its detail calls.
    await Promise.all(history ? [worker()] : [worker(), worker()]);
    const leftover = keys.filter((key) => !sent.has(key) && !missing.has(key));
    if (leftover.length > 0) {
      emit({ type: "missing", keys: leftover });
    }
    await runs;
  } catch (error) {
    console.error("HSP backlog failed", errorText(error));
  } finally {
    await addCalls(takeCallCount());
    emit({ type: "end" });
  }
}

function tasksOf<T extends { quarter: Quarter }>(
  train: BacklogTrain,
  tasks: readonly T[],
): T[] {
  const quarters = new Set(
    train.legs.map((leg) => quarterOf(leg.publicDeparture).fromTime),
  );
  return tasks.filter((task) => quarters.has(task.quarter.fromTime));
}

function trainResult(
  train: BacklogTrain,
  own: readonly { key: string; day: ServiceDay }[],
  answers: ReadonlyMap<string, HspService[]>,
): { byDay: Partial<Record<ServiceDay, HspCounts>>; rids: string[] } {
  const byDay: Partial<Record<ServiceDay, HspCounts>> = {};
  const rids: string[] = [];
  for (const day of ALL_DAYS) {
    const services = own
      .filter((task) => task.day === day)
      .flatMap((task) => answers.get(task.key) ?? []);
    const joined = own.some((task) => task.day === day)
      ? matchBacklog([train], services).get(train.key)
      : undefined;
    if (joined) {
      byDay[day] = joined.counts;
      rids.push(...joined.rids);
    }
  }
  return { byDay, rids: [...new Set(rids)] };
}

/** Same route, day type, quarter-hour and dates: the same answer for every search. */
function metricsKey(
  query: Pick<BacklogQuery, "fromCrs" | "toCrs">,
  day: ServiceDay,
  quarter: Quarter,
  span: DateSpan,
): string {
  return [
    query.fromCrs,
    query.toCrs,
    day,
    quarter.fromTime,
    span.from,
    span.to,
  ].join("|");
}

/**
 * One list answer. The search that claims the key asks HSP once a shared slot is free;
 * another search of the same quarter waits for that answer instead of asking again.
 */
async function fetchMetrics(
  query: BacklogQuery,
  task: { key: string; day: ServiceDay; quarter: Quarter },
  span: DateSpan,
  deadline: number,
  stop: () => boolean,
): Promise<HspService[] | undefined> {
  const owner = randomUUID();
  for (let attempts = 0; !stop();) {
    const stored = (await storedMetrics([task.key])).get(task.key);
    if (stored) {
      return stored;
    }
    if (!(await claimMetrics(task.key))) {
      await pause(POLL_MS);
      continue;
    }
    const slot = await waitForSlot(owner, stop);
    if (slot === undefined) {
      await releaseMetrics(task.key);
      return undefined;
    }
    try {
      attempts += 1;
      const payload = await postHsp(
        "/serviceMetrics",
        {
          from_loc: query.fromCrs,
          to_loc: query.toCrs,
          from_time: task.quarter.fromTime,
          to_time: task.quarter.toTime,
          from_date: span.from,
          to_date: span.to,
          days: HSP_DAYS[task.day],
          tolerance: [...METRIC_TOLERANCES],
        },
        Math.min(
          LIST_CALL_TIMEOUT_MS,
          Math.max(1_000, deadline + 30_000 - Date.now()),
        ),
      );
      const services = parseServiceMetrics(payload);
      await saveMetrics(task.key, services);
      return services;
    } catch (error) {
      await releaseMetrics(task.key);
      if (
        !(error instanceof HspCallError) ||
        error.kind !== "busy" ||
        attempts >= LIST_ATTEMPTS
      ) {
        console.info("[hsp] list gave up", task.key, errorText(error));
        return undefined;
      }
    } finally {
      await releaseCallSlot(slot, owner);
    }
    await pause(LIST_RETRY_MS * attempts);
  }
  return undefined;
}

async function waitForSlot(
  owner: string,
  stop: () => boolean,
): Promise<number | undefined> {
  while (!stop()) {
    const slot = await takeCallSlot(owner);
    if (slot !== undefined) {
      return slot;
    }
    await pause(POLL_MS);
  }
  return undefined;
}

/**
 * The history train's runs before Darwin, newest first: stored ones at once, then the rest
 * from HSP one at a time. A run HSP would not give is skipped: the figures then stay on
 * HSP's counts, and the next visit asks for it again. After a few refused in a row HSP is
 * taken to be overloaded, and the rest wait for the next visit.
 */
async function streamRuns(
  query: BacklogQuery,
  rids: readonly string[],
  emit: (event: BacklogEvent) => void,
  stop: () => boolean,
): Promise<void> {
  const stations = { boardingCrs: query.fromCrs, destinationCrs: query.toCrs };
  const newestFirst = [...rids].sort((left, right) =>
    (serviceDateOf({}, right) ?? "").localeCompare(
      serviceDateOf({}, left) ?? "",
    ),
  );
  const stored = await storedRuns(newestFirst);
  if (stored.size > 0) {
    emit({
      type: "runs",
      runs: newestFirst.flatMap((rid) => {
        const run = stored.get(rid);
        return run ? [historicalRunFromHsp(run, stations)] : [];
      }),
    });
  }
  const missing = newestFirst.filter((rid) => !stored.has(rid));
  if (missing.length === 0) {
    return;
  }
  // One slot for the whole run of detail calls, renewed while it lasts.
  const owner = randomUUID();
  const slot = await waitForSlot(owner, stop);
  if (slot === undefined) {
    return;
  }
  const renew = setInterval(() => {
    void renewCallSlot(slot, owner);
  }, SLOT_RENEW_MS);
  const pending: HspRun[] = [];
  let refusedInARow = 0;
  try {
    for (const rid of missing) {
      if (stop() || refusedInARow >= REFUSED_RUNS) {
        break;
      }
      const run = await fetchRun(rid, stop);
      if (!run) {
        refusedInARow += 1;
        continue;
      }
      refusedInARow = 0;
      pending.push(run);
      if (pending.length >= SAVE_EVERY) {
        await saveRuns(pending.splice(0));
      }
      emit({ type: "runs", runs: [historicalRunFromHsp(run, stations)] });
    }
  } finally {
    clearInterval(renew);
    await releaseCallSlot(slot, owner);
    await saveRuns(pending);
  }
}

async function fetchRun(
  rid: string,
  stop: () => boolean,
): Promise<HspRun | undefined> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      const payload = await postHsp(
        "/serviceDetails",
        { rid },
        DETAIL_CALL_TIMEOUT_MS,
      );
      return runFromDetails(payload, rid);
    } catch (error) {
      const busy = error instanceof HspCallError && error.kind === "busy";
      if (!busy || attempt >= DETAIL_ATTEMPTS || stop()) {
        console.info("[hsp] run gave up", rid, errorText(error));
        return undefined;
      }
      await pause(DETAIL_RETRY_MS * attempt);
    }
  }
}

function pause(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
