import {
  clockMinutes,
  dateOfRid,
  journeyMinutes,
  NO_RUNS,
  passengerLeg,
  type PunctualityTally,
} from "@railscore/core";
import { dayTypeOf, dayTypesOf, type DayPattern } from "@/shared/day-type";
import { listServices } from "../services/fold";
import { type ScheduledService } from "@/shared/scheduled-service";
import { historicalRunFromDarwin, type DarwinRun } from "./run";

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

/** Departure times a list covers, HHMM, both inclusive. */
export type ClockWindow = { from: string; to: string };

export const WHOLE_DAY: ClockWindow = { from: "0000", to: "2359" };

/** Trains a list shows from the searched time. */
const LIST_SIZE = 6;

export type TrainPage = {
  services: ScheduledService[];
  /** Departures the page covers, from the searched time to its last train. */
  window?: ClockWindow;
  /** Searched time, HHMM, that lists the trains just before this page. */
  earlier?: string;
  /** Searched time, HHMM, that lists the trains just after this page. */
  later?: string;
};

/**
 * The first `size` trains leaving at or after `timeHhmm`, in clock order within the day,
 * plus any that leave at the same minute as the last one. The neighbouring pages start at
 * a train's own departure, so following them never skips or repeats a train.
 */
export function trainPage(
  services: readonly ScheduledService[],
  timeHhmm: string,
  size = LIST_SIZE,
): TrainPage {
  const sorted = [...services].sort((left, right) =>
    left.publicDeparture.localeCompare(right.publicDeparture),
  );
  const before = sorted.filter((service) => service.publicDeparture < timeHhmm);
  const after = sorted.filter((service) => service.publicDeparture >= timeHhmm);
  const last = after[Math.min(size, after.length) - 1]?.publicDeparture;
  const shown = last
    ? after.filter((service) => service.publicDeparture <= last)
    : [];
  return {
    services: shown,
    ...(last ? { window: { from: timeHhmm, to: last } } : {}),
    ...(before.length > 0
      ? {
          earlier: before[Math.max(0, before.length - size)]!.publicDeparture,
        }
      : {}),
    ...(after.length > shown.length
      ? { later: after[shown.length]!.publicDeparture }
      : {}),
  };
}

/** A train of a list as its runs are found again: its schedule UID, operator and public times. */
export type TrainLeg = {
  uid: string;
  toc: string;
  /** Public departure from the boarding station, HHMM. */
  departure: string;
  /** Public arrival at the destination, HHMM. */
  arrival: string;
};

/** The trains of the runs that board in `window` on this search, one per schedule UID. */
export function legsLeaving(
  runs: readonly DarwinRun[],
  search: Pick<DarwinSearch, "fromCrs" | "toCrs">,
  window: ClockWindow,
): TrainLeg[] {
  const legs = new Map<string, TrainLeg>();
  for (const run of runs) {
    const leg = legOf(run, search.fromCrs, search.toCrs);
    if (leg && run.uid && inWindow(leg.departure, window)) {
      legs.set(run.uid, {
        uid: run.uid,
        toc: run.toc,
        departure: leg.departure,
        arrival: leg.arrival,
      });
    }
  }
  return [...legs.values()];
}

/** What to look up to find a train's runs under other schedule UIDs. */
export type SameTrainLookup = {
  /** Open days on which some listed train has no run. */
  dates: string[];
  /** Per train missing a day: its operator and a pattern its stored calls match. */
  trains: { toc: string; pattern: string }[];
};

/**
 * Some trains get a new schedule UID on some days, such as the Caledonian Sleeper from
 * Euston at 23:45: one UID on Mondays, another Tuesday to Thursday, a third on Fridays. Its
 * runs read by UID then miss the other days. A train that has no run on one of `dates`, the
 * open days of the searched day types, is looked up on those days by operator and public
 * times. A day with no train at all also asks once, and finds nothing. Undefined when every
 * train ran on every date.
 */
export function sameTrainLookup(
  legs: readonly TrainLeg[],
  runs: readonly DarwinRun[],
  search: Pick<DarwinSearch, "fromCrs" | "toCrs">,
  dates: readonly string[],
): SameTrainLookup | undefined {
  const seen = new Map<string, Set<string>>();
  for (const run of runs) {
    const leg = legOf(run, search.fromCrs, search.toCrs);
    if (leg) {
      const key = trainKey(run.toc, leg.departure, leg.arrival);
      seen.set(key, (seen.get(key) ?? new Set()).add(run.serviceDate));
    }
  }
  const missing = new Set<string>();
  const trains = new Map<string, { toc: string; pattern: string }>();
  for (const leg of legs) {
    const key = trainKey(leg.toc, leg.departure, leg.arrival);
    const ran = seen.get(key) ?? new Set<string>();
    const absent = dates.filter((date) => !ran.has(date));
    if (absent.length === 0) {
      continue;
    }
    absent.forEach((date) => missing.add(date));
    trains.set(key, {
      toc: leg.toc,
      pattern: legPattern(search, leg.departure, leg.arrival),
    });
  }
  if (trains.size === 0) {
    return undefined;
  }
  return { dates: [...missing].sort(), trains: [...trains.values()] };
}

function trainKey(toc: string, departure: string, arrival: string): string {
  return `${toc} ${departure} ${arrival}`;
}

/**
 * A Postgres regular expression for stored calls (`server/call-text.ts`) that board at
 * `fromCrs` with this public departure and later reach `toCrs` with this public arrival.
 */
export function legPattern(
  search: Pick<DarwinSearch, "fromCrs" | "toCrs">,
  departure: string,
  arrival: string,
): string {
  return `(^|;)${quoted(search.fromCrs)},[^,;]*,${quoted(departure)},.*;${quoted(search.toCrs)},${quoted(arrival)},`;
}

function quoted(text: string): string {
  return text.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
}

/**
 * The trains of the latest timetable for the chosen day type, each with its runs in the
 * period. Runs are pooled into trains by the shared folding rules, so a train is the
 * same schedule seen on several days. A train in the period that is not in that timetable
 * no longer runs, and is set apart. Today's runs pick the trains but are not counted,
 * since a run of today may still be under way. Nor are runs before `countedFrom`, the first
 * day Darwin saw whole: they can pick the trains, but their times are partial.
 */
export function servicesFromRuns(
  runs: readonly DarwinRun[],
  search: DarwinSearch,
  input: {
    today: string;
    todayTimetable: boolean;
    countedFrom: string;
    period: { from: string; to: string };
  },
  window: ClockWindow,
): DarwinServiceList | undefined {
  const dayTypes = dayTypesOf(search.days);
  const period = input.period;
  const counted = (date: string) =>
    date >= input.countedFrom && date < input.today;
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
  const fastest = Math.min(
    ...legs
      .map((leg) => journeyMinutes(leg.departure, leg.arrival))
      .filter(Number.isFinite),
  );
  // An unreadable length keeps the train rather than dropping it unseen.
  const direct = legs.filter(
    (leg) =>
      !leg.passedDestination ||
      !(
        journeyMinutes(leg.departure, leg.arrival) >
        LONG_WAY_ROUND_FACTOR * fastest
      ),
  );
  const timetableDate = direct
    .map((leg) => leg.run.serviceDate)
    .sort()
    .at(-1);
  if (!timetableDate) {
    return undefined;
  }

  const groups = dayTypes.map((day) =>
    direct
      .filter((leg) => leg.day === day)
      .map((leg): ScheduledService => ({
        originCrs: leg.run.calls[0]!.crs,
        destinationCrs: leg.run.calls.at(-1)!.crs,
        publicDeparture: leg.departure,
        publicArrival: leg.arrival,
        operatorCode: leg.run.toc,
        rids: [leg.run.rid],
        days: [day],
        punctuality: counted(leg.run.serviceDate)
          ? punctualityOf(leg.run, search)
          : NO_RUNS,
      })),
  );
  const listed = listServices(groups, period.to);
  const runsOn = (service: ScheduledService) =>
    service.rids.some((rid) => dateOfRid(rid) === timetableDate);
  return {
    services: listed.services.filter(runsOn).map(countedOnly(counted)),
    retired: [
      ...listed.retired,
      ...listed.services.filter((service) => !runsOn(service)),
    ].map(countedOnly(counted)),
    period,
    timetableDate,
  };
}

/**
 * A train that already called at the destination before boarding is on a loop. It is the
 * long way round when it takes more than this many times the fastest train of the search.
 */
const LONG_WAY_ROUND_FACTOR = 2;

/**
 * The planned leg from boarding to destination, by the shared rule (`passengerLeg`): a
 * public departure, then a later public arrival. A train that passes the boarding station
 * twice before the destination, such as Clapham Junction going out and coming back round
 * the Kingston loop into Waterloo, is boarded at the later call: the short way, and the leg
 * HSP lists. A train that called at the destination before boarding is on a loop. That is the
 * only way on a circular line such as the Wirral line through Liverpool Central, but the long
 * way round on a loop such as Waterloo to Waterloo via Hounslow, so the caller compares its
 * length with the other trains.
 */
function legOf(
  run: DarwinRun,
  fromCrs: string,
  toCrs: string,
):
  | { departure: string; arrival: string; passedDestination: boolean }
  | undefined {
  const leg = passengerLeg(run.calls, {
    boardingCrs: fromCrs,
    destinationCrs: toCrs,
  });
  const boarding =
    leg.boarding === undefined ? undefined : run.calls[leg.boarding];
  const destination =
    leg.destination === undefined ? undefined : run.calls[leg.destination];
  if (!boarding?.ptd || !destination?.pta) {
    return undefined;
  }
  return {
    departure: boarding.ptd,
    arrival: destination.pta,
    passedDestination: run.calls
      .slice(0, leg.boarding)
      .some((call) => call.crs === toCrs),
  };
}

/** The list's counts for one run. A run with no known outcome is not counted. */
function punctualityOf(run: DarwinRun, search: DarwinSearch): PunctualityTally {
  const outcome = historicalRunFromDarwin(run, {
    boardingCrs: search.fromCrs,
    destinationCrs: search.toCrs,
  });
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
    arrived: outcome.outcome === "arrived" ? 1 : 0,
  };
}

/**
 * Uncounted runs leave the train: the calculation only counts days that have finished,
 * from the first day Darwin saw whole.
 */
function countedOnly(counted: (date: string) => boolean) {
  const earlier = (rids: readonly string[]) =>
    rids.filter((rid) => counted(dateOfRid(rid) ?? ""));
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

function inWindow(hhmm: string, window: ClockWindow): boolean {
  const minute = clockMinutes(hhmm);
  const from = clockMinutes(window.from);
  const to = clockMinutes(window.to);
  return from <= to
    ? minute >= from && minute <= to
    : minute >= from || minute <= to;
}
