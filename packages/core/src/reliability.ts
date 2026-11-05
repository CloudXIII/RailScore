import type { PunctualityTally } from "./tally";

const WITHIN_MINUTES = 5;

/** One historical run at the passenger's destination. `serviceDate` is `YYYY-MM-DD` when known. */
export type HistoricalRun =
  | {
      readonly id: string;
      readonly serviceDate?: string;
      readonly outcome: "arrived";
      readonly latenessMinutes: number;
    }
  | {
      readonly id: string;
      readonly serviceDate?: string;
      readonly outcome: "cancelled";
    }
  | {
      readonly id: string;
      readonly serviceDate?: string;
      readonly outcome: "did_not_call";
    }
  | {
      readonly id: string;
      readonly serviceDate?: string;
      readonly outcome: "missing_actual";
    };

export type ReliabilityStatus = "ok" | "no_history" | "partial";

export type CountedPercentage = {
  /** Numerator: on-time runs, or cancelled runs, depending on the measure. */
  readonly count: number;
  readonly total: number;
  /** Whole percent. Null when total is 0, so an empty set is not shown as 0% or 100%. */
  readonly percentage: number | null;
};

/** Runs by outcome. The five counts add up to the punctuality total. */
export type LatenessDistribution = {
  readonly withinFive: number;
  readonly sixToFourteen: number;
  readonly fifteenToTwentyNine: number;
  readonly thirtyOrMore: number;
  readonly cancelled: number;
};

/** One dated run for the day grid. A run with no date stays in the totals and is left off the grid. */
export type CalendarMark =
  | {
      readonly serviceDate: string;
      readonly kind: "on_time";
      readonly latenessMinutes: number;
    }
  | {
      readonly serviceDate: string;
      readonly kind: "late";
      readonly latenessMinutes: number;
    }
  | { readonly serviceDate: string; readonly kind: "cancelled" }
  | { readonly serviceDate: string; readonly kind: "no_data" };

export type ReliabilityResult = {
  readonly status: ReliabilityStatus;
  /** Arrivals at most 5 minutes late, of every run with a known outcome, cancellations included. */
  readonly withinFiveMinutes: CountedPercentage;
  readonly distribution: LatenessDistribution;
  readonly calendar: readonly CalendarMark[];
  /** Runs with no arrival and no sign of cancellation. Left out of every figure. */
  readonly excludedCount: number;
};

/**
 * The figures for `runs`, plus runs known only by count in `tallies`, such as HSP's for runs
 * not fetched yet. Counted runs go into the totals and the bands, never on the calendar.
 */
export function calculateReliability(
  runs: readonly HistoricalRun[],
  tallies: readonly PunctualityTally[] = [],
): ReliabilityResult {
  const distribution = {
    withinFive: 0,
    sixToFourteen: 0,
    fifteenToTwentyNine: 0,
    thirtyOrMore: 0,
    cancelled: 0,
  };
  let tallied = 0;
  for (const tally of tallies) {
    const bands = tallyBands(tally);
    distribution.withinFive += bands.withinFive;
    distribution.sixToFourteen += bands.sixToFourteen;
    distribution.fifteenToTwentyNine += bands.fifteenToTwentyNine;
    distribution.thirtyOrMore += bands.thirtyOrMore;
    distribution.cancelled += bands.cancelled;
    tallied += Object.values(bands).reduce((sum, count) => sum + count, 0);
  }
  let excluded = 0;
  const calendar = new Map<string, CalendarMark>();

  for (const run of runs) {
    const mark = calendarMark(run);
    if (mark) {
      const existing = calendar.get(mark.serviceDate);
      if (!existing || markRank(mark) > markRank(existing)) {
        calendar.set(mark.serviceDate, mark);
      }
    }
    if (run.outcome === "arrived") {
      const lateness = run.latenessMinutes;
      if (lateness <= WITHIN_MINUTES) {
        distribution.withinFive += 1;
      } else if (lateness < 15) {
        distribution.sixToFourteen += 1;
      } else if (lateness < 30) {
        distribution.fifteenToTwentyNine += 1;
      } else {
        distribution.thirtyOrMore += 1;
      }
      continue;
    }
    if (run.outcome === "cancelled" || run.outcome === "did_not_call") {
      distribution.cancelled += 1;
      continue;
    }
    excluded += 1;
  }

  const known = runs.length + tallied - excluded;
  return {
    status: statusFor(runs.length + tallied, excluded),
    withinFiveMinutes: counted(distribution.withinFive, known),
    distribution,
    calendar: [...calendar.values()].sort((left, right) =>
      left.serviceDate.localeCompare(right.serviceDate),
    ),
    excludedCount: excluded,
  };
}

/**
 * A tally's runs by band. A band is never below zero, should a source send counts that do not
 * nest.
 */
function tallyBands(tally: PunctualityTally): LatenessDistribution {
  const band = (count: number) => Math.max(0, count);
  return {
    withinFive: band(tally.within5),
    sixToFourteen: band(tally.within14 - tally.within5),
    fifteenToTwentyNine: band(tally.within29 - tally.within14),
    thirtyOrMore: band(tally.arrived - tally.within29),
    cancelled: band(tally.runs - tally.arrived),
  };
}

function calendarMark(run: HistoricalRun): CalendarMark | undefined {
  if (!run.serviceDate) {
    return undefined;
  }
  if (run.outcome === "arrived") {
    return run.latenessMinutes <= WITHIN_MINUTES
      ? {
          serviceDate: run.serviceDate,
          kind: "on_time",
          latenessMinutes: run.latenessMinutes,
        }
      : {
          serviceDate: run.serviceDate,
          kind: "late",
          latenessMinutes: run.latenessMinutes,
        };
  }
  if (run.outcome === "cancelled" || run.outcome === "did_not_call") {
    return { serviceDate: run.serviceDate, kind: "cancelled" };
  }
  return { serviceDate: run.serviceDate, kind: "no_data" };
}

function markRank(mark: CalendarMark): number {
  if (mark.kind === "cancelled") {
    return 10_000;
  }
  if (mark.kind === "late") {
    return 1_000 + mark.latenessMinutes;
  }
  if (mark.kind === "on_time") {
    return 100;
  }
  return 0;
}

function statusFor(matched: number, excluded: number): ReliabilityStatus {
  if (matched - excluded === 0) {
    return "no_history";
  }
  if (excluded > 0) {
    return "partial";
  }
  return "ok";
}

/** A whole percentage that is never 0% for a non-zero count, nor 100% for a count short of the total. */
export function counted(count: number, total: number): CountedPercentage {
  if (total === 0) {
    return { count: 0, total: 0, percentage: null };
  }
  let percentage = Math.round((count / total) * 100);
  if (percentage === 100 && count < total) {
    percentage = 99;
  }
  if (percentage === 0 && count > 0) {
    percentage = 1;
  }
  return { count, total, percentage };
}
