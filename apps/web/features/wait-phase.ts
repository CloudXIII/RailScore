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

/** Seconds before the next automatic try after a busy source. Grows, then levels off. */
export function retryDelaySeconds(attempt: number): number {
  return Math.min(10 + 5 * Math.max(0, attempt - 1), 30);
}
