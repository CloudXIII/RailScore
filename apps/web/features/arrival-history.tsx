"use client";

import type { HistoricalRun } from "@railscore/core";
import { useBacklogState } from "@/features/backlog-context";
import { historyFigures } from "@/features/backlog-figures";
import type { DayFilter } from "@/features/day-grid";
import { ReliabilityResultView } from "@/features/reliability-result";
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
  darwinRuns,
  result,
  stations,
  days,
  sample,
}: {
  service: ScheduledService;
  fromCrs: string;
  toCrs: string;
  period: { from: string; to: string };
  darwinRuns: readonly HistoricalRun[];
  /** Darwin's figures alone, shown when there is no HSP answer. */
  result: ReliabilityResult;
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
    : { result, complete: true };
  const progress = waiting
    ? "Loading earlier journeys…"
    : backlog && !figures.complete
      ? state?.done
        ? `${state.runs.length} of ${backlog.runCount} earlier days are on the calendar. The figures count them all. The rest could not be loaded just now because the data provider is busy. Reload in a few minutes to add them.`
        : `Loading earlier journeys: ${state?.runs.length ?? 0} of ${backlog.runCount} days…`
      : state?.missing.has(key)
        ? "Earlier journeys could not be loaded just now because the data provider is busy, so they are left out. Reload in a few minutes to try again."
        : undefined;
  return (
    <ReliabilityResultView
      service={service}
      fromCrs={fromCrs}
      toCrs={toCrs}
      period={period}
      result={figures.result}
      stations={stations}
      days={days}
      sample={sample}
      pending={waiting}
      {...(progress ? { progress } : {})}
    />
  );
}
