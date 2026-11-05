import "server-only";
import type { HistoricalRun, ReliabilityResult } from "@railscore/core";
import type { EarlierDaysRequest } from "@/shared/contracts";
import type { DayPattern } from "@/shared/day-type";
import { earlierDaysTrain } from "../hsp/earlier-days-query";
import type { DateSpan } from "../periods";
import {
  matchesServiceKey,
  serviceKey,
  type ScheduledService,
} from "@/shared/scheduled-service";
import { trainSource, type TrainSource } from "../train-source";

export type TrainSearch = {
  readonly fromCrs: string;
  readonly toCrs: string;
  /** Searched time, HHMM. */
  readonly timeHhmm: string;
  readonly days: DayPattern;
  readonly periodDays: number;
  /** Key of the chosen train. */
  readonly serviceKey?: string;
  /** Show the chosen train's arrival history. */
  readonly calculate: boolean;
  readonly now?: Date;
};

/** Everything the page shows for a search, ready to render. */
export type TrainSearchView = {
  readonly services: readonly ScheduledService[];
  readonly retired: readonly ScheduledService[];
  readonly period: DateSpan;
  readonly earlier?: string;
  readonly later?: string;
  /** Why a history was asked for and none is shown. */
  readonly notice?: "choose-train" | "train-not-found";
  /** The chosen train's arrival history from Darwin. */
  readonly history?: {
    readonly service: ScheduledService;
    readonly result: ReliabilityResult;
    readonly darwinRuns: readonly HistoricalRun[];
    /** Days before Darwin that HSP fills in. */
    readonly hspDays?: DateSpan;
  };
  /** What the page asks HSP about once it is shown. Absent once Darwin covers the period. */
  readonly earlierDays?: EarlierDaysRequest;
};

/**
 * Finds the trains for a search and, when asked, the chosen train's history. HSP fills the
 * days before Darwin after the page is shown: the listed trains, and the chosen one first
 * when its history is open.
 */
export async function searchTrains(
  search: TrainSearch,
  source: TrainSource = trainSource(),
): Promise<TrainSearchView> {
  const found = await source.findServices({
    fromCrs: search.fromCrs,
    toCrs: search.toCrs,
    timeHhmm: search.timeHhmm,
    days: search.days,
    periodDays: search.periodDays,
    ...(search.now ? { now: search.now } : {}),
  });
  const key = search.serviceKey;
  const selected = key
    ? [...found.services, ...found.retired].find((service) =>
        matchesServiceKey(service, key),
      )
    : undefined;
  const calculation =
    search.calculate && selected ? found.calculate(selected) : undefined;
  const history =
    calculation && selected
      ? {
          service: selected,
          result: calculation.result,
          darwinRuns: calculation.runs,
          ...(found.hsp ? { hspDays: found.hsp } : {}),
        }
      : undefined;
  const listed = [...found.services];
  if (history && !listed.includes(history.service)) {
    listed.unshift(history.service);
  }
  const earlierDays: EarlierDaysRequest | undefined =
    found.hsp && listed.length > 0
      ? {
          fromCrs: search.fromCrs,
          toCrs: search.toCrs,
          days: search.days,
          periodDays: search.periodDays,
          trains: listed.map(earlierDaysTrain),
          ...(history ? { runsOf: serviceKey(history.service) } : {}),
        }
      : undefined;
  const notice = !search.calculate
    ? undefined
    : !key
      ? "choose-train"
      : !selected
        ? "train-not-found"
        : undefined;
  return {
    services: found.services,
    retired: found.retired,
    period: found.period,
    ...(found.earlier ? { earlier: found.earlier } : {}),
    ...(found.later ? { later: found.later } : {}),
    ...(notice ? { notice } : {}),
    ...(history ? { history } : {}),
    ...(earlierDays ? { earlierDays } : {}),
  };
}
