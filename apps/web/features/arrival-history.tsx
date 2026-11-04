"use client";

import type { HistoricalRun } from "@railscore/core";
import { useBacklogState } from "@/features/backlog-context";
import { historyFigures } from "@/features/backlog-figures";
import type { DayFilter } from "@/features/day-grid";
import { formatDate } from "@/features/format";
import { ReliabilityResultView } from "@/features/reliability-result";
import type { DayTypeResult } from "@/server/day-split";
import { serviceKey, type ScheduledService } from "@/server/services/map";
import type { Station } from "@/server/stations";
import type { ReliabilityResult } from "@railscore/core";

/**
 * One train's arrival history: Darwin's runs at once, and HSP's for the days before Darwin
 * as they arrive. HSP's counts give the figures first, then its runs fill the calendar, newest
 * first. Without HSP the figures are Darwin's.
 */
export function ArrivalHistory({
  service,
  fromCrs,
  toCrs,
  period,
  darwinFrom,
  darwinRuns,
  result,
  byDay,
  stations,
  days,
  sample,
}: {
  service: ScheduledService;
  fromCrs: string;
  toCrs: string;
  period: { from: string; to: string };
  /** First day counted from Darwin. HSP covers the days before it. */
  darwinFrom: string;
  darwinRuns: readonly HistoricalRun[];
  /** Darwin's figures alone, shown when there is no HSP answer. */
  result: ReliabilityResult;
  byDay: readonly DayTypeResult[];
  stations: readonly Station[];
  days: DayFilter;
  sample: boolean;
}) {
  const state = useBacklogState();
  const key = serviceKey(service);
  const backlog = state?.trains.get(key);
  const waiting =
    state !== undefined && !state.done && !backlog && !state.missing.has(key);
  const figures = backlog
    ? historyFigures({ darwinRuns, backlog, hspRuns: state?.runs ?? [] })
    : { result, byDay, complete: true };
  const before = formatDate(darwinFrom);
  const progress = waiting
    ? `Adding journeys before ${before}…`
    : backlog && !figures.complete
      ? state?.done
        ? `${state.runs.length} of ${backlog.runCount} days before ${before} are on the calendar. The figures count them all.`
        : `Filling in the calendar: ${state?.runs.length ?? 0} of ${backlog.runCount} days before ${before}…`
      : state?.missing.has(key)
        ? `Journeys before ${before} could not be loaded, so they are left out.`
        : undefined;
  return (
    <ReliabilityResultView
      service={service}
      fromCrs={fromCrs}
      toCrs={toCrs}
      period={period}
      result={figures.result}
      byDay={figures.byDay}
      stations={stations}
      days={days}
      sample={sample}
      pending={waiting}
      {...(progress ? { progress } : {})}
    />
  );
}
