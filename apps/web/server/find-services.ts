import "server-only";
import { trailingDays } from "@railscore/core";
import { findDarwinServices } from "./darwin/find";
import { usesMockData } from "./env";
import { mockServices } from "./mock/catalogue";
import type { DayPattern } from "./query";
import type { ScheduledService } from "./services/map";

type ServiceSearch = {
  services: ScheduledService[];
  /** Trains that ran early in the period and no longer do. */
  retired: ScheduledService[];
  /** Dates the listed runs cover. Starts at the oldest stored Darwin day when that is later. */
  period: { from: string; to: string };
};

/** Trains of today's Darwin timetable with their stored runs, or sample trains in mock mode. */
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
    };
  }
  const found = await findDarwinServices(input, now);
  return {
    services: found.services,
    retired: found.retired,
    period: found.period,
  };
}
