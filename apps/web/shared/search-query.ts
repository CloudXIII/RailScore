import type { DayPattern } from "./day-type";
import type { Station } from "./stations";

/**
 * Days of history. Finished days are packed into month rows, well under 1 MB a day, so a year
 * fits in Neon Free (1 GB per project). A rolling year is 365 days, leap years included.
 */
export const PERIOD_LENGTHS = [30, 60, 90, 180, 365] as const;

/** The longest period, and so the days of runs kept. */
export const LONGEST_PERIOD = Math.max(...PERIOD_LENGTHS);
export type PeriodLength = (typeof PERIOD_LENGTHS)[number];

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
