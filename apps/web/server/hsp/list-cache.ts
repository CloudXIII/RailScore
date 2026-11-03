import { addCalendarDays } from "@railscore/core";
import type { ScheduledService } from "../services/map";
import { RECENT_RUN_REFRESH_MS } from "./policy";

/**
 * One quarter-hour of one day type, listed for a whole period. HSP takes as long for
 * 7 days as for 90, so a list is fetched for the full period, and HSP's counts in it
 * describe exactly that period.
 */
export type StoredList = {
  readonly services: readonly ScheduledService[];
  /** Last date of the period the list was fetched for. */
  readonly coveredTo: string;
  readonly fetchedAt: Date;
};

/**
 * `fresh` is shown as it is. `stale` covers the period but may still gain recent runs,
 * so it is shown then fetched again after the response. `missing` (no list, or one that
 * ends before the period) must be fetched before the list can be shown — otherwise the
 * page would claim "last N days" up to an older date.
 */
type ListState = "fresh" | "stale" | "missing";

export function listState(
  stored: StoredList | undefined,
  periodTo: string,
  now: Date,
): ListState {
  if (!stored || stored.coveredTo < periodTo) {
    return "missing";
  }
  if (now.getTime() - stored.fetchedAt.getTime() < RECENT_RUN_REFRESH_MS) {
    return "fresh";
  }
  return "stale";
}

/** The dates the shown lists cover together. Equal to `period` once every list is fresh. */
export function listedPeriod(
  lists: readonly StoredList[],
  periodDays: number,
  period: { from: string; to: string },
): { from: string; to: string } {
  if (lists.length === 0) {
    return period;
  }
  const ends = lists.map((list) => list.coveredTo).sort();
  const first = ends[0] as string;
  const last = ends.at(-1) as string;
  return { from: addCalendarDays(first, -(periodDays - 1)), to: last };
}
