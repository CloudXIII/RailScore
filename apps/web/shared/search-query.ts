import type { DayPattern } from "./day-type";
import type { Station } from "./stations";

/** Days of history. Finished days are packed into month rows, so 90 fit in Neon Free (0.5 GB). */
export const PERIOD_LENGTHS = [30, 60, 90] as const;
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
