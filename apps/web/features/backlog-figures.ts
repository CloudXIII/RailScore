import {
  addCalendarDays,
  calculateReliability,
  sumTallies,
  type HistoricalRun,
  type PunctualityTally,
  type ReliabilityResult,
} from "@railscore/core";
import { formatDate } from "@/features/format";
import type { ServiceDay } from "@/shared/day-type";

/** What HSP has said so far about one train's days before Darwin. */
export type TrainBacklog = {
  readonly byDay: Partial<Record<ServiceDay, PunctualityTally>>;
  readonly runCount: number;
};

/** HSP's counts for a train, all day types together. */
export function backlogTotal(backlog: TrainBacklog): PunctualityTally {
  return sumTallies(Object.values(backlog.byDay));
}

/**
 * The list's counts with HSP's added. Darwin's alone while HSP has not answered, and HSP's
 * alone for a train with no counted Darwin run yet.
 */
export function listPunctuality(
  darwin: PunctualityTally | undefined,
  backlog: TrainBacklog | undefined,
): PunctualityTally | undefined {
  if (!backlog) {
    return darwin;
  }
  return sumTallies([darwin, backlogTotal(backlog)]);
}

export type HistoryFigures = {
  readonly result: ReliabilityResult;
  /** True once every HSP run has been fetched and the figures come from the runs alone. */
  readonly complete: boolean;
};

/**
 * The arrival history from Darwin's runs and HSP's. Until every HSP run has been fetched the
 * figures use HSP's counts, and the calendar shows the runs fetched so far. Then the figures
 * come from the runs, as for Darwin.
 */
export function historyFigures(input: {
  darwinRuns: readonly HistoricalRun[];
  backlog: TrainBacklog | undefined;
  hspRuns: readonly HistoricalRun[];
}): HistoryFigures {
  const fetched = [...input.darwinRuns, ...input.hspRuns];
  if (!input.backlog || input.hspRuns.length >= input.backlog.runCount) {
    return {
      result: calculateReliability(fetched),
      complete: true,
    };
  }
  const tallies = Object.values(input.backlog.byDay).filter(
    (tally) => tally !== undefined,
  );
  return {
    result: {
      ...calculateReliability(input.darwinRuns, tallies),
      calendar: calculateReliability(fetched).calendar,
    },
    complete: false,
  };
}

type Span = { readonly from: string; readonly to: string };

/**
 * The days a train's history covers. HSP fills the days before Darwin, `hsp`. When HSP knows
 * no run of the train there, or gave no answer, nothing is known about those days: they are
 * left out, and the history starts on Darwin's first day, rather than showing days without
 * the train. Some trains are missing from HSP, so "no record" never means it did not run.
 */
export function shownPeriod(input: {
  period: Span;
  hsp: Span | undefined;
  backlog: TrainBacklog | undefined;
  /** HSP gave no answer for the train. */
  missing: boolean;
}): { period: Span; note?: string } {
  const { period, hsp, backlog } = input;
  const noRecord =
    backlog !== undefined &&
    backlog.runCount === 0 &&
    backlogTotal(backlog).runs === 0;
  if (!hsp || (!noRecord && (backlog || !input.missing))) {
    return { period };
  }
  const darwinFrom = addCalendarDays(hsp.to, 1);
  if (darwinFrom <= period.from || darwinFrom > period.to) {
    return { period };
  }
  const shown = { from: darwinFrom, to: period.to };
  return noRecord
    ? {
        period: shown,
        note: `There is no record of this train before ${formatDate(darwinFrom)}, so its history starts then.`,
      }
    : { period: shown };
}
