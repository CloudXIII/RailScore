import "server-only";
import { randomUUID } from "node:crypto";
import { dateOfRid, type PunctualityTally } from "@railscore/core";
import { darwinFirstDay, hspConnection, hspDailyCallLimit } from "../env";
import { errorText } from "../error-text";
import { DAY_TYPES, dayTypesOf, type ServiceDay } from "@/shared/day-type";
import type {
  EarlierDaysEvent,
  EarlierDaysRequest,
  EarlierDaysTrain,
} from "@/shared/contracts";
import { HspCallError, postHsp, takeCallCount } from "./client";
import { historicalRunFromHsp, runFromDetails, type HspRun } from "./details";
import { matchEarlierDays } from "./match";
import { listTasks, tasksOf, type ListTask } from "./lists";
import {
  METRIC_TOLERANCES,
  parseServiceMetrics,
  type HspService,
} from "./metrics";
import { searchPeriods, type DateSpan } from "../periods";
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

const HSP_DAYS: Record<ServiceDay, "WEEKDAY" | "SATURDAY" | "SUNDAY"> = {
  weekdays: "WEEKDAY",
  saturday: "SATURDAY",
  sunday: "SUNDAY",
};

/** HSP's gateway gives up at about 55 s. Successes still arrive at 53 s. */
const LIST_CALL_TIMEOUT_MS = 54_000;

const DETAIL_CALL_TIMEOUT_MS = 10_000;

/**
 * Pauses after a refused detail call: 300 ms, then longer, up to 2 s. A lone 503 clears after
 * about 300 ms, but at busy times HSP refuses every call for up to half a minute, so a
 * refused run is asked again at this pace until the search's deadline.
 */
const DETAIL_RETRY_MS = 300;

const DETAIL_RETRY_MAX_MS = 2_000;

/**
 * Pause after a refused list call before asking again. HSP can refuse every list call, even
 * a lone one, for 10 to 20 seconds at a time, then answer one. A list call is retried at this
 * pace until the search's deadline, so a cold search waits the busy spell out.
 */
const LIST_RETRY_MS = 2_500;

/** How often a search checks for a free slot, or for another search's answer. */
const POLL_MS = 400;

/** Quarter-hours left unanswered that end a search's lists. */
const REFUSED_LISTS = 2;

/** Runs failed in a row, other than by a busy refusal, that end a history's detail calls. */
const FAILED_RUNS = 3;

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
export async function streamEarlierDays(
  query: EarlierDaysRequest,
  emit: (event: EarlierDaysEvent) => void,
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
    const days = dayTypesOf(query.days);
    const tasks = listTasks(query, query.trains, days, span);
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
        const own = tasksOf(query, train, tasks);
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
          // The history train's runs start now; the other trains' lists wait for them.
          runs = streamRuns(query, result.rids, emit, stop);
        }
      }
    };
    emitReady();

    // The history train's quarter-hours first, then the rest in clock order.
    const first = history ? new Set(tasksOf(query, history, tasks)) : new Set();
    const queue = tasks
      .filter((task) => !answers.has(task.key))
      .sort(
        (left, right) => Number(first.has(right)) - Number(first.has(left)),
      );
    // A quarter-hour HSP did not answer by the deadline, or failed outright, leaves its
    // trains on Darwin's figures. A second one ends the lists: HSP is down or overloaded,
    // and waiting would only hold the page. One alone must not cost the other trains.
    let refusedLists = 0;
    // One HSP call at a time: the history train's lists, then its runs, then the other
    // trains' lists. A list beside the runs would only get both refused.
    for (const task of queue) {
      if (!first.has(task)) {
        await runs;
      }
      const services =
        stop() || refusedLists >= REFUSED_LISTS
          ? undefined
          : await fetchMetrics(task, span, options.deadline, stop);
      if (services) {
        answers.set(task.key, services);
      } else {
        refusedLists += 1;
        failedTasks.add(task.key);
      }
      emitReady();
    }
    const leftover = keys.filter((key) => !sent.has(key) && !missing.has(key));
    if (leftover.length > 0) {
      emit({ type: "missing", keys: leftover });
    }
    await runs;
  } catch (error) {
    console.error("HSP earlier days failed", errorText(error));
  } finally {
    await addCalls(takeCallCount()).catch((error: unknown) => {
      console.error("[hsp] the call count was not saved", errorText(error));
    });
    emit({ type: "end" });
  }
}

function trainResult(
  train: EarlierDaysTrain,
  own: readonly { key: string; day: ServiceDay }[],
  answers: ReadonlyMap<string, HspService[]>,
): { byDay: Partial<Record<ServiceDay, PunctualityTally>>; rids: string[] } {
  const byDay: Partial<Record<ServiceDay, PunctualityTally>> = {};
  const rids: string[] = [];
  for (const day of DAY_TYPES) {
    const services = own
      .filter((task) => task.day === day)
      .flatMap((task) => answers.get(task.key) ?? []);
    const joined = own.some((task) => task.day === day)
      ? matchEarlierDays([train], services).get(train.key)
      : undefined;
    if (joined) {
      byDay[day] = joined.counts;
      rids.push(...joined.rids);
    }
  }
  return { byDay, rids: [...new Set(rids)] };
}

/**
 * One list answer. The search that claims the key asks HSP once a shared slot is free;
 * another search of the same quarter waits for that answer instead of asking again.
 */
async function fetchMetrics(
  task: ListTask,
  span: DateSpan,
  deadline: number,
  stop: () => boolean,
): Promise<HspService[] | undefined> {
  const owner = randomUUID();
  while (!stop()) {
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
      const payload = await postHsp(
        "/serviceMetrics",
        {
          from_loc: task.stations.fromCrs,
          to_loc: task.stations.toCrs,
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
      if (!(error instanceof HspCallError) || error.kind !== "busy") {
        console.info("[hsp] list gave up", task.key, errorText(error));
        return undefined;
      }
    } finally {
      await releaseCallSlot(slot, owner);
    }
    await pause(LIST_RETRY_MS);
  }
  console.info("[hsp] list gave up at the deadline", task.key);
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
 * from HSP one at a time. A refused run is asked again until the deadline. A run that fails
 * otherwise is skipped: the figures then stay on HSP's counts, and the next visit asks for it
 * again. After a few such failures in a row the rest wait for the next visit.
 */
async function streamRuns(
  query: EarlierDaysRequest,
  rids: readonly string[],
  emit: (event: EarlierDaysEvent) => void,
  stop: () => boolean,
): Promise<void> {
  const stations = { boardingCrs: query.fromCrs, destinationCrs: query.toCrs };
  const newestFirst = [...rids].sort((left, right) =>
    (dateOfRid(right) ?? "").localeCompare(dateOfRid(left) ?? ""),
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
    renewCallSlot(slot, owner).catch((error: unknown) => {
      console.error("[hsp] slot renewal failed", errorText(error));
    });
  }, SLOT_RENEW_MS);
  const pending: HspRun[] = [];
  let failedInARow = 0;
  try {
    for (const rid of missing) {
      if (stop() || failedInARow >= FAILED_RUNS) {
        break;
      }
      const run = await fetchRun(rid, stop);
      if (!run) {
        failedInARow += 1;
        continue;
      }
      failedInARow = 0;
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
      if (!busy || stop()) {
        console.info("[hsp] run gave up", rid, attempt, errorText(error));
        return undefined;
      }
      await pause(Math.min(DETAIL_RETRY_MS * attempt, DETAIL_RETRY_MAX_MS));
    }
  }
}

function pause(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
