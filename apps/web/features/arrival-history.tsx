"use client";

import type { HistoricalRun } from "@railscore/core";
import { useBacklogState } from "@/features/backlog-context";
import { historyFigures, shownPeriod } from "@/features/backlog-figures";
import type { DayPattern } from "@/shared/day-type";
import { ReliabilityResultView } from "@/features/reliability-result";
import { serviceKey, type ScheduledService } from "@/shared/scheduled-service";
import type { Station } from "@/shared/stations";
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
  hspDays,
  darwinRuns,
  result,
  stations,
  days,
}: {
  service: ScheduledService;
  fromCrs: string;
  toCrs: string;
  period: { from: string; to: string };
  /** Days before Darwin that HSP fills, when it is asked. */
  hspDays?: { from: string; to: string };
  darwinRuns: readonly HistoricalRun[];
  /** Darwin's figures alone, shown when there is no HSP answer. */
  result: ReliabilityResult;
  stations: readonly Station[];
  days: DayPattern;
}) {
  const state = useBacklogState();
  const key = serviceKey(service);
  const backlog = state?.trains.get(key);
  const waiting =
    state !== undefined && !state.done && !backlog && !state.missing.has(key);
  const figures = backlog
    ? historyFigures({ darwinRuns, backlog, hspRuns: state?.runs ?? [] })
    : { result, complete: true };
  const busy = state?.busy
    ? " The data provider is busy, so this may take a few minutes."
    : "";
  const progress = waiting
    ? "Loading older journeys…"
    : backlog && !figures.complete
      ? state?.done
        ? `${state.runs.length} of ${backlog.runCount} older days are on the calendar. The figures count them all. The rest could not be loaded because the data provider is busy. Reload later to add them.`
        : `Loading older journeys: ${state?.runs.length ?? 0} of ${backlog.runCount} days…${busy}`
      : state?.missing.has(key)
        ? state.done
          ? "Older journeys could not be loaded because the data provider is busy, so they are left out. Reload later to try again."
          : "Older journeys are not in yet because the data provider is busy. Trying again…"
        : undefined;
  const shown = shownPeriod({
    period,
    hsp: hspDays,
    backlog,
    missing: state?.missing.has(key) ?? false,
  });
  const line = progress ?? shown.note;
  return (
    <ReliabilityResultView
      service={service}
      fromCrs={fromCrs}
      toCrs={toCrs}
      period={shown.period}
      result={figures.result}
      stations={stations}
      days={days}
      pending={waiting}
      {...(line ? { progress: line } : {})}
    />
  );
}
