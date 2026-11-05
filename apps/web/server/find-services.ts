import "server-only";
import { trailingDays } from "@railscore/core";
import { findDarwinServices } from "./darwin/find";
import type { DarwinRun } from "./darwin/run";
import type { DateSpan } from "./hsp/period";
import { usesMockData } from "./env";
import { mockServices, shiftClock } from "./mock/catalogue";
import type { DayPattern } from "./day-type";
import type { ScheduledService } from "./services/map";

type ServiceSearch = {
  services: ScheduledService[];
  /** Trains that ran early in the period and no longer do. */
  retired: ScheduledService[];
  /** Dates the figures cover. Without HSP, starts at the first counted Darwin day when that is later. */
  period: { from: string; to: string };
  /** Days before Darwin that HSP fills in after the list is shown. Absent once Darwin covers the period. */
  hsp?: DateSpan;
  /** Stored runs of the listed trains by RID. Empty for sample trains. */
  runs: ReadonlyMap<string, DarwinRun>;
  /** Searched time, HHMM, that lists the trains just before these. None at the start of the day. */
  earlier?: string;
  /** Searched time, HHMM, that lists the trains just after these. None at the end of the day. */
  later?: string;
};

/**
 * The next trains of today's Darwin timetable from the searched time, with their stored
 * runs, or sample trains in mock mode.
 */
export async function findServices(input: {
  fromCrs: string;
  toCrs: string;
  timeHhmm: string;
  days: DayPattern;
  periodDays: number;
  now?: Date;
}): Promise<ServiceSearch> {
  const now = input.now ?? new Date();
  if (usesMockData()) {
    return {
      services: mockServices(input),
      retired: [],
      period: trailingDays(input.periodDays, now),
      runs: new Map(),
      earlier: shiftClock(input.timeHhmm, -60),
      later: shiftClock(input.timeHhmm, 60),
    };
  }
  const found = await findDarwinServices(input, now);
  return {
    services: found.services,
    retired: found.retired,
    period: found.period,
    runs: found.runs,
    ...(found.earlier ? { earlier: found.earlier } : {}),
    ...(found.later ? { later: found.later } : {}),
    ...(found.hsp ? { hsp: found.hsp } : {}),
  };
}
