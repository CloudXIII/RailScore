import {
  calculateReliability,
  type HistoricalRun,
  type ReliabilityResult,
} from "@railscore/core";
import { dayTypeOf } from "./day-type";
import { DAY_ORDER, type ServiceDay } from "./hsp/map";

export type DayTypeResult = {
  readonly day: ServiceDay;
  readonly result: ReliabilityResult;
};

/** Figures per day type, from each run's date. Undated runs stay in the overall figure only. */
export function reliabilityByDayType(
  runs: readonly HistoricalRun[],
): DayTypeResult[] {
  const grouped = new Map<ServiceDay, HistoricalRun[]>();
  for (const run of runs) {
    const day = run.serviceDate ? dayTypeOf(run.serviceDate) : undefined;
    if (!day) {
      continue;
    }
    const group = grouped.get(day);
    if (group) {
      group.push(run);
    } else {
      grouped.set(day, [run]);
    }
  }
  return DAY_ORDER.flatMap((day) => {
    const dayRuns = grouped.get(day);
    return dayRuns ? [{ day, result: calculateReliability(dayRuns) }] : [];
  });
}
