import { clockMinutes, searchClockRange, trailingDays } from "@railscore/core";
import { dayTypeOf } from "../day-type";
import {
  listServices,
  serviceDateOf,
  toHistoricalRun,
  type ListPunctuality,
  type ScheduledService,
  type ServiceDay,
} from "../hsp/map";
import type { DayPattern } from "../query";
import { hspPayloadFromDarwin, type DarwinRun } from "./run";

export type DarwinSearch = {
  fromCrs: string;
  toCrs: string;
  timeHhmm: string;
  days: DayPattern;
  periodDays: number;
};

export type DarwinServiceList = {
  services: ScheduledService[];
  /** Trains that ran in the period but are not in the timetable the list starts from. */
  retired: ScheduledService[];
  period: { from: string; to: string };
  /** Day whose timetable the list shows. Today once its timetable is loaded. */
  timetableDate: string;
};

const DAY_TYPES: readonly ServiceDay[] = ["weekdays", "saturday", "sunday"];

/**
 * The trains of the latest timetable for the chosen day type, each with its runs in the
 * period. Runs are pooled into trains with the same rules as HSP lists, so a train is the
 * same schedule seen on several days. A train in the period that is not in that timetable
 * no longer runs, and is set apart. Today's runs pick the trains but are not counted,
 * since a run of today may still be under way.
 */
export function servicesFromRuns(
  runs: readonly DarwinRun[],
  search: DarwinSearch,
  input: { today: string; todayTimetable: boolean; oldest: string },
): DarwinServiceList | undefined {
  const dayTypes = search.days === "all" ? DAY_TYPES : [search.days];
  const window = searchClockRange(search.timeHhmm);
  const period = trailingDays(search.periodDays, dateAt(input.today));
  const legs = runs.flatMap((run) => {
    const day = dayTypeOf(run.serviceDate);
    const leg = legOf(run, search.fromCrs, search.toCrs);
    if (
      !day ||
      !leg ||
      !dayTypes.includes(day) ||
      !inWindow(leg.departure, window) ||
      run.serviceDate > input.today ||
      (run.serviceDate === input.today && !input.todayTimetable)
    ) {
      return [];
    }
    return [{ run, day, ...leg }];
  });
  const timetableDate = legs
    .map((leg) => leg.run.serviceDate)
    .sort()
    .at(-1);
  if (!timetableDate) {
    return undefined;
  }

  const groups = dayTypes.map((day) =>
    legs
      .filter((leg) => leg.day === day)
      .map((leg): ScheduledService => ({
        originCrs: leg.run.calls[0]!.crs,
        destinationCrs: leg.run.calls.at(-1)!.crs,
        publicDeparture: leg.departure,
        publicArrival: leg.arrival,
        operatorCode: leg.run.toc,
        rids: [leg.run.rid],
        days: [day],
        punctuality:
          leg.run.serviceDate < input.today
            ? punctualityOf(leg.run, search)
            : NO_RUNS,
      })),
  );
  const listed = listServices(groups, period.to);
  const runsOn = (service: ScheduledService) =>
    service.rids.some((rid) => serviceDateOf({}, rid) === timetableDate);
  return {
    services: listed.services.filter(runsOn).map(withoutToday(input.today)),
    retired: [
      ...listed.retired,
      ...listed.services.filter((service) => !runsOn(service)),
    ].map(withoutToday(input.today)),
    period: {
      from: input.oldest > period.from ? input.oldest : period.from,
      to: period.to,
    },
    timetableDate,
  };
}

const NO_RUNS: ListPunctuality = {
  runs: 0,
  within5: 0,
  within14: 0,
  within29: 0,
};

/**
 * The leg from boarding to destination: a public departure, then a later public arrival.
 * A train that called at the destination before boarding is on a loop back to it, the long
 * way round, so it is not a train for this journey.
 */
function legOf(
  run: DarwinRun,
  fromCrs: string,
  toCrs: string,
): { departure: string; arrival: string } | undefined {
  const boarding = run.calls.findIndex(
    (call) => call.crs === fromCrs && call.ptd,
  );
  if (
    boarding === -1 ||
    run.calls.slice(0, boarding).some((call) => call.crs === toCrs)
  ) {
    return undefined;
  }
  const destination = run.calls
    .slice(boarding + 1)
    .find((call) => call.crs === toCrs && call.pta);
  if (!destination) {
    return undefined;
  }
  return {
    departure: run.calls[boarding]!.ptd!,
    arrival: destination.pta!,
  };
}

/** HSP's list counts for one run. A run with no known outcome is not counted. */
function punctualityOf(run: DarwinRun, search: DarwinSearch): ListPunctuality {
  const outcome = toHistoricalRun(
    hspPayloadFromDarwin(run),
    { boardingCrs: search.fromCrs, destinationCrs: search.toCrs },
    run.rid,
  );
  if (outcome.outcome === "missing_actual") {
    return NO_RUNS;
  }
  const lateness =
    outcome.outcome === "arrived" ? outcome.latenessMinutes : Infinity;
  return {
    runs: 1,
    within5: lateness <= 5 ? 1 : 0,
    within14: lateness <= 14 ? 1 : 0,
    within29: lateness <= 29 ? 1 : 0,
  };
}

/** Today's runs leave the train: the calculation only counts days that have finished. */
function withoutToday(today: string) {
  const earlier = (rids: readonly string[]) =>
    rids.filter((rid) => (serviceDateOf({}, rid) ?? "") < today);
  return (service: ScheduledService): ScheduledService => ({
    ...service,
    rids: earlier(service.rids),
    ...(service.variants
      ? {
          variants: service.variants.map((variant) => ({
            ...variant,
            rids: earlier(variant.rids),
            runCount: earlier(variant.rids).length,
          })),
        }
      : {}),
  });
}

function inWindow(hhmm: string, window: { from: string; to: string }): boolean {
  const minute = clockMinutes(hhmm);
  const from = clockMinutes(window.from);
  const to = clockMinutes(window.to);
  return from <= to
    ? minute >= from && minute <= to
    : minute >= from || minute <= to;
}

/** Noon UTC on a London date, so `trailingDays` reads that same date. */
function dateAt(iso: string): Date {
  return new Date(`${iso}T12:00:00Z`);
}
