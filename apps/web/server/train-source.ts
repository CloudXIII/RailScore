import "server-only";
import type { HistoricalRun, ReliabilityResult } from "@railscore/core";
import type { DayPattern } from "@/shared/day-type";
import { darwinSource } from "./darwin/source";
import { usesMockData } from "./env";
import { mockSource } from "./mock/source";
import type { DateSpan } from "./periods";
import type { ScheduledService } from "@/shared/scheduled-service";

/**
 * Where the trains and their runs come from: Darwin's import in Postgres, or made-up
 * sample trains. Chosen once, by `trainSource`; nothing else asks which one is in use.
 */
export type TrainSource = {
  /** Made-up trains, so the page says so and asks HSP nothing. */
  readonly sample: boolean;
  findServices(query: ServiceQuery): Promise<ServiceSearch>;
};

type ServiceQuery = {
  readonly fromCrs: string;
  readonly toCrs: string;
  /** Searched time, HHMM. */
  readonly timeHhmm: string;
  readonly days: DayPattern;
  readonly periodDays: number;
  readonly now?: Date;
};

export type ServiceSearch = {
  readonly services: readonly ScheduledService[];
  /** Trains that ran early in the period and no longer do. */
  readonly retired: readonly ScheduledService[];
  /** Dates the figures cover. Without HSP, starts at the first counted Darwin day when that is later. */
  readonly period: DateSpan;
  /** Days before Darwin that HSP fills in after the list is shown. Absent once Darwin covers the period. */
  readonly hsp?: DateSpan;
  /** Searched time, HHMM, that lists the trains just before these. None at the start of the day. */
  readonly earlier?: string;
  /** Searched time, HHMM, that lists the trains just after these. None at the end of the day. */
  readonly later?: string;
  /** Reliability of one of the trains found, from the runs this search read. */
  calculate(service: ScheduledService): ServiceCalculation;
};

export type ServiceCalculation = {
  readonly result: ReliabilityResult;
  /** The classified runs, so the page can add HSP's days before Darwin to them. */
  readonly runs: readonly HistoricalRun[];
};

/** `RAILSCORE_DATA=mock` serves sample trains; otherwise Darwin. */
export function trainSource(): TrainSource {
  return usesMockData() ? mockSource : darwinSource;
}
