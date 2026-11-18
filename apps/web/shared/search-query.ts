import type { DayPattern } from "./day-type";
import type { Station } from "./stations";

/**
 * Days of history offered. A year of runs is kept (`darwinKeepDays`), so longer periods can be
 * offered once Darwin has recorded them.
 */
export const PERIOD_LENGTHS = [14, 30, 60, 90] as const;
export type PeriodLength = (typeof PERIOD_LENGTHS)[number];

/**
 * The period before a search. Its days are all still stored one row per run (`OPEN_DAYS` in
 * `darwin/store.ts`), so it needs neither HSP nor the packed months and is the quickest.
 */
export const DEFAULT_PERIOD: PeriodLength = 14;

/** Shortest period that may read HSP or the packed months, so the form says it can be slower. */
export const SLOWER_PERIOD = 30;

/** The search in the page's address, as read by the server and shown by the form. */
export type ParsedQuery = {
  fromText: string;
  toText: string;
  time: string;
  days: DayPattern;
  period: PeriodLength;
  from?: Station;
  to?: Station;
  serviceKey?: string;
  calculate: boolean;
  errors: string[];
};
