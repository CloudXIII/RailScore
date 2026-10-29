import type { DayPattern } from "@/server/query";

/** No new run for this long reads as a slow source rather than steady progress. */
export const STALL_MS = 15_000;

/** A remembered progress moment older than this belongs to an earlier visit. */
const REMEMBERED_MS = 5 * 60 * 1000;

export const SLOW_SOURCE_MESSAGE =
  "The data service is taking longer than usual. Please wait, we keep trying on our own.";

/** The line shown while the train list loads. It moves on with the time spent waiting. */
export function searchPhase(input: {
  elapsedMs: number;
  periodDays: number;
  days: DayPattern;
}): string {
  if (input.elapsedMs < 4_000) {
    return `Looking up trains from the last ${input.periodDays} days`;
  }
  if (input.elapsedMs < 15_000) {
    return input.days === "all"
      ? "Checking the weekday, Saturday and Sunday timetables"
      : "Gathering every train that matches your time";
  }
  if (input.elapsedMs < 35_000) {
    return "Busy routes have many trains, so this can take a little longer";
  }
  return SLOW_SOURCE_MESSAGE;
}

/** The line shown while a train's runs load. It follows the runs checked so far. */
export function calculationPhase(input: {
  saved?: number;
  total?: number;
  hasProvisional: boolean;
  stalled: boolean;
  periodDays: number;
}): string {
  if (input.stalled) {
    return SLOW_SOURCE_MESSAGE;
  }
  const { saved, total } = input;
  if (!saved || !total) {
    return `Fetching this train's journeys from the last ${input.periodDays} days`;
  }
  if (!input.hasProvisional) {
    return "The first journeys are arriving";
  }
  if (saved / total < 0.8) {
    return "Early figures are in. Checking the remaining journeys";
  }
  return "Almost there, checking the last few journeys";
}

export type ProgressMoment = { saved: number; at: number };

/**
 * When the run count last moved. A page reload keeps the earlier moment while
 * the count is unchanged, so a stall is still seen across reloads.
 */
export function progressMoment(
  remembered: ProgressMoment | undefined,
  saved: number,
  now: number,
): ProgressMoment {
  if (
    remembered &&
    remembered.saved === saved &&
    now - remembered.at < REMEMBERED_MS
  ) {
    return remembered;
  }
  return { saved, at: now };
}

/**
 * If the list has not arrived by now, reload the same URL once. A search may run
 * for 120 s before it answers, so this stays past that. A result, including a
 * busy message, sets `[data-results-ready]` and the reload does not run.
 */
export const WAITING_RELOAD_MS = 150_000;

/** Automatic reloads of a search that never paints a result. */
export const WAITING_RELOAD_MAX = 1;

/** A remembered reload older than this belongs to an earlier visit. */
const WAITING_RELOAD_FRESH_MS = 5 * 60 * 1000;

type WaitingReloadMark = { count: number; at: number };

export function waitingReloadStorageKey(pathname: string, search: string): string {
  return `railscore:wait:${pathname}${search}`;
}

/**
 * Records one automatic reload. `false` when this search already reloaded once,
 * or the count cannot be stored: a reload that cannot be remembered would repeat.
 */
export function claimWaitingReload(
  pathname: string,
  search: string,
  now = Date.now(),
): boolean {
  const store = browserStorage();
  if (!store) {
    return false;
  }
  const key = waitingReloadStorageKey(pathname, search);
  const previous = readWaitingReload(store, key);
  const count =
    previous && now - previous.at < WAITING_RELOAD_FRESH_MS ? previous.count : 0;
  if (count >= WAITING_RELOAD_MAX) {
    return false;
  }
  try {
    store.setItem(key, JSON.stringify({ count: count + 1, at: now }));
    return true;
  } catch {
    return false;
  }
}

/** Forgets the automatic reload so a later visit can try once more. */
export function clearWaitingReload(pathname: string, search: string): void {
  const store = browserStorage();
  if (!store) {
    return;
  }
  try {
    store.removeItem(waitingReloadStorageKey(pathname, search));
  } catch {
    // The next visit may still be within the one allowed reload.
  }
}

function browserStorage(): Storage | undefined {
  try {
    return globalThis.sessionStorage;
  } catch {
    return undefined;
  }
}

function readWaitingReload(
  store: Storage,
  key: string,
): WaitingReloadMark | undefined {
  try {
    const raw = store.getItem(key);
    const value = raw ? (JSON.parse(raw) as Partial<WaitingReloadMark>) : {};
    return typeof value.count === "number" && typeof value.at === "number"
      ? { count: value.count, at: value.at }
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Runs from the first HTML, before React. A search that never paints its result
 * reloads the same URL once. A second wait stops. A finished result, including a
 * busy message, sets `[data-results-ready]` and stays put.
 */
export const waitingReloadScript = [
  "(function(){try{",
  "var p=new URLSearchParams(location.search);",
  'if(!p.get("from")||!p.get("to"))return;',
  `var key="railscore:wait:"+location.pathname+location.search;`,
  `var fresh=${WAITING_RELOAD_FRESH_MS};`,
  `setTimeout(function(){`,
  'if(document.querySelector("[data-results-ready]"))return;',
  "var count=0,at=0;",
  "try{var v=JSON.parse(sessionStorage.getItem(key)||'');",
  'if(v&&typeof v.count==="number"&&typeof v.at==="number"){count=v.count;at=v.at}}catch(e){}',
  "if(Date.now()-at>=fresh)count=0;",
  `if(count>=${WAITING_RELOAD_MAX})return;`,
  "try{sessionStorage.setItem(key, JSON.stringify({count:count+1, at:Date.now()}))}catch(e){return}",
  "location.reload();",
  `},${WAITING_RELOAD_MS})`,
  "}catch(e){}})();",
].join("");

/** True when the waiting page should reload because the list still has not arrived. */
export function shouldReloadWaitingPage(ready: boolean, elapsedMs: number): boolean {
  return !ready && elapsedMs >= WAITING_RELOAD_MS;
}

/** Seconds before the next automatic try after a busy source. Grows, then levels off. */
export function retryDelaySeconds(attempt: number): number {
  return Math.min(10 + 5 * Math.max(0, attempt - 1), 30);
}
