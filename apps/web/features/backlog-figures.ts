import {
  addCalendarDays,
  calculateReliability,
  type HistoricalRun,
  type ReliabilityResult,
} from "@railscore/core";
import { formatDate } from "@/features/format";
import type { HspCounts } from "@/shared/contracts";
import type { ServiceDay } from "@/shared/day-type";
import type { ListPunctuality } from "@/server/services/fold";

/** What HSP has said so far about one train's days before Darwin. */
export type TrainBacklog = {
  readonly byDay: Partial<Record<ServiceDay, HspCounts>>;
  readonly runCount: number;
};

/** HSP's counts for a train, all day types together. */
export function backlogTotal(backlog: TrainBacklog): HspCounts {
  const counts = Object.values(backlog.byDay);
  const sum = (key: keyof HspCounts) =>
    counts.reduce((total, count) => total + (count?.[key] ?? 0), 0);
  return {
    runs: sum("runs"),
    within5: sum("within5"),
    within14: sum("within14"),
    within29: sum("within29"),
    arrived: sum("arrived"),
  };
}

/**
 * The list's counts with HSP's added. Darwin's alone while HSP has not answered, and HSP's
 * alone for a train with no counted Darwin run yet.
 */
export function listPunctuality(
  darwin: ListPunctuality | undefined,
  backlog: TrainBacklog | undefined,
): ListPunctuality | undefined {
  if (!backlog) {
    return darwin;
  }
  const hsp = backlogTotal(backlog);
  return {
    runs: (darwin?.runs ?? 0) + hsp.runs,
    within5: (darwin?.within5 ?? 0) + hsp.within5,
    within14: (darwin?.within14 ?? 0) + hsp.within14,
    within29: (darwin?.within29 ?? 0) + hsp.within29,
  };
}

/** A date of each day type, for runs known only by count. They are never shown on the calendar. */
const DAY_OF_TYPE: Record<ServiceDay, string> = {
  weekdays: "2026-11-02",
  saturday: "2026-10-31",
  sunday: "2026-11-01",
};

/**
 * Runs standing in for HSP's counts: one per counted run, at a lateness inside its band.
 * They give the totals and the bands before each run has been fetched.
 */
export function runsFromCounts(byDay: TrainBacklog["byDay"]): HistoricalRun[] {
  return (Object.entries(byDay) as [ServiceDay, HspCounts][]).flatMap(
    ([day, counts]) => {
      const serviceDate = DAY_OF_TYPE[day];
      const bands: [number, number | undefined][] = [
        [counts.within5, 0],
        [counts.within14 - counts.within5, 10],
        [counts.within29 - counts.within14, 20],
        [counts.arrived - counts.within29, 30],
        [counts.runs - counts.arrived, undefined],
      ];
      return bands.flatMap(([count, lateness], band) =>
        Array.from({ length: Math.max(0, count) }, (_, index) =>
          lateness === undefined
            ? {
                id: `count:${day}:${band}:${index}`,
                serviceDate,
                outcome: "cancelled" as const,
              }
            : {
                id: `count:${day}:${band}:${index}`,
                serviceDate,
                outcome: "arrived" as const,
                latenessMinutes: lateness,
              },
        ),
      );
    },
  );
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
  const counted = [...input.darwinRuns, ...runsFromCounts(input.backlog.byDay)];
  return {
    result: {
      ...calculateReliability(counted),
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
