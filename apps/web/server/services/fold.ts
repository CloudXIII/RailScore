import {
  addCalendarDays,
  dateOfRid,
  journeyMinutes,
  minutesApart,
} from "@railscore/core";
import { orderedDays, type ServiceDay } from "@/shared/day-type";

export type ScheduledService = {
  readonly originCrs: string;
  readonly destinationCrs: string;
  readonly publicDeparture: string;
  readonly publicArrival: string;
  readonly operatorCode: string;
  readonly rids: readonly string[];
  readonly days: readonly ServiceDay[];
  /** Other public schedules folded into this train, with their run counts. Absent when there are none. */
  readonly variants?: readonly ServiceVariant[];
  /** Counts of these runs by lateness. Absent when any part of the train came without one. */
  readonly punctuality?: ListPunctuality;
};

/**
 * Runs reaching the destination at most 5, 14 and 29 minutes late, counted for the list.
 * A cancelled run is outside every tolerance. So is a run with no actual departure at the
 * boarding stop. The full calculation treats that the same way: the passenger could not board, so it is a missed call, not an arrival.
 */
export type ListPunctuality = {
  readonly runs: number;
  readonly within5: number;
  readonly within14: number;
  readonly within29: number;
};

export type ServiceVariant = {
  readonly originCrs: string;
  readonly destinationCrs: string;
  readonly publicDeparture: string;
  readonly publicArrival: string;
  readonly runCount: number;
  readonly rids: readonly string[];
};

/** Minutes either way a departure may differ and still be the same train. */
export const SAME_TRAIN_MINUTES = 2;

/** Minutes a journey may differ in length and still be the same train. */
const SAME_JOURNEY_MINUTES = 15;

/** Minutes either way a departure may differ when the two trains never share a day type. */
const OTHER_DAYS_TRAIN_MINUTES = 10;

/** A train with no run in this many days before the period ends no longer runs. Two weeks, as recent days can lag. */
const RETIRED_AFTER_DAYS = 14;

export function serviceKey(service: {
  publicDeparture: string;
  publicArrival: string;
  operatorCode: string;
  originCrs: string;
  destinationCrs: string;
}): string {
  return [
    service.publicDeparture,
    service.publicArrival,
    service.operatorCode,
    service.originCrs,
    service.destinationCrs,
  ].join("-");
}

/** True when `key` names this train or one of the schedules folded into it. */
export function matchesServiceKey(
  service: ScheduledService,
  key: string,
): boolean {
  if (serviceKey(service) === key) {
    return true;
  }
  return (service.variants ?? []).some(
    (variant) =>
      serviceKey({ ...variant, operatorCode: service.operatorCode }) === key,
  );
}

/**
 * Pools identical schedules across day types, then folds near-identical ones into the
 * most-run schedule: same operator, departure within two minutes, journey length within
 * fifteen minutes, and no shared run date. Then folds a train that runs on other day
 * types only into the one train it replaces, when the journey is about the same length.
 *
 * Trains whose last run is long before `periodEnd` are set apart, as after a timetable
 * change. They are set apart before the day-type fold, so a train that no longer runs
 * cannot absorb one that still does.
 */
export function listServices(
  groups: readonly ScheduledService[][],
  periodEnd: string,
): { services: ScheduledService[]; retired: ScheduledService[] } {
  const folded = assembleServices(groups);
  const retired = folded.filter((service) => isRetired(service, periodEnd));
  const current = folded.filter((service) => !retired.includes(service));
  return { services: foldAcrossDays(current), retired };
}

/** The latest run date of a train, when every run has a readable one. */
export function lastRunDate(service: ScheduledService): string | undefined {
  const dates = runDates(service.rids);
  if (!dates || dates.size === 0) {
    return undefined;
  }
  return [...dates].sort().at(-1);
}

function isRetired(service: ScheduledService, periodEnd: string): boolean {
  const last = lastRunDate(service);
  return (
    last !== undefined && last < addCalendarDays(periodEnd, -RETIRED_AFTER_DAYS)
  );
}

/**
 * Timed schedules are folded first. A row listed with no public arrival, such as a
 * cancelled call that only has a departure, then joins the one train with the same operator
 * and a departure within two minutes. Its runs are kept and its blank arrival is not shown.
 */
function assembleServices(
  groups: readonly ScheduledService[][],
): ScheduledService[] {
  const arrivalLess = groups.flat().filter((service) => !service.publicArrival);
  const timed = groups.map((group) =>
    group.filter((service) => service.publicArrival),
  );
  return attachArrivalLess(foldSameTrain(mergeIdentical(timed)), arrivalLess);
}

function attachArrivalLess(
  services: readonly ScheduledService[],
  arrivalLess: readonly ScheduledService[],
): ScheduledService[] {
  const next: ScheduledService[] = services.map((service) => ({
    ...service,
    rids: [...service.rids],
    days: [...service.days],
  }));
  for (const extra of arrivalLess) {
    const dates = runDates(extra.rids);
    if (!dates) {
      continue;
    }
    const homes = next.filter((service) =>
      canTakeArrivalLess(service, extra, dates),
    );
    const home = homes.length === 1 ? homes[0] : undefined;
    if (!home) {
      continue;
    }
    const index = next.indexOf(home);
    next[index] = withPunctuality(
      {
        ...home,
        rids: [...new Set([...home.rids, ...extra.rids])],
        days: orderedDays([...home.days, ...extra.days]),
      },
      [home, extra],
    );
  }
  return next;
}

function canTakeArrivalLess(
  service: ScheduledService,
  extra: ScheduledService,
  dates: ReadonlySet<string>,
): boolean {
  if (service.operatorCode !== extra.operatorCode || !service.publicArrival) {
    return false;
  }
  if (
    minutesApart(service.publicDeparture, extra.publicDeparture) >
    SAME_TRAIN_MINUTES
  ) {
    return false;
  }
  const taken = runDates(service.rids);
  if (!taken) {
    return false;
  }
  return ![...dates].some((date) => taken.has(date));
}

function mergeIdentical(
  groups: readonly ScheduledService[][],
): ScheduledService[] {
  const merged = new Map<string, ScheduledService>();
  for (const group of groups) {
    for (const service of group) {
      const key = serviceKey(service);
      const existing = merged.get(key);
      if (!existing) {
        merged.set(key, {
          ...service,
          rids: [...new Set(service.rids)],
          days: orderedDays(service.days),
        });
        continue;
      }
      merged.set(
        key,
        withPunctuality(
          {
            ...existing,
            rids: [...new Set([...existing.rids, ...service.rids])],
            days: orderedDays([...existing.days, ...service.days]),
          },
          [existing, service],
        ),
      );
    }
  }
  return [...merged.values()];
}

type Fold = {
  readonly anchor: ScheduledService;
  readonly rids: string[];
  /** Undefined when a run of the anchor has no readable date. */
  readonly dates: Set<string> | undefined;
  readonly days: ServiceDay[];
  readonly variants: ServiceVariant[];
  readonly members: ScheduledService[];
};

/**
 * Each schedule is compared with the anchor of a fold, never with another variant,
 * so 10:19, 10:21 and 10:23 do not chain into one train.
 */
function foldSameTrain(
  services: readonly ScheduledService[],
): ScheduledService[] {
  const ranked = [...services].sort(
    (left, right) =>
      right.rids.length - left.rids.length ||
      left.publicDeparture.localeCompare(right.publicDeparture) ||
      serviceKey(left).localeCompare(serviceKey(right)),
  );
  const folds: Fold[] = [];
  for (const service of ranked) {
    const dates = runDates(service.rids);
    const home = dates
      ? folds.find((fold) => isSameTrain(fold, service, dates))
      : undefined;
    if (home) {
      home.rids.push(...service.rids);
      dates?.forEach((date) => home.dates?.add(date));
      home.days.push(...service.days);
      home.members.push(service);
      home.variants.push({
        originCrs: service.originCrs,
        destinationCrs: service.destinationCrs,
        publicDeparture: service.publicDeparture,
        publicArrival: service.publicArrival,
        runCount: service.rids.length,
        rids: service.rids,
      });
      continue;
    }
    folds.push({
      anchor: service,
      rids: [...service.rids],
      dates,
      days: [...service.days],
      variants: [],
      members: [service],
    });
  }
  return folds
    .map((fold) =>
      withPunctuality(
        {
          ...fold.anchor,
          rids: fold.rids,
          days: orderedDays(fold.days),
          ...(fold.variants.length > 0 ? { variants: fold.variants } : {}),
        },
        fold.members,
      ),
    )
    .sort(
      (left, right) =>
        left.publicDeparture.localeCompare(right.publicDeparture) ||
        serviceKey(left).localeCompare(serviceKey(right)),
    );
}

/**
 * Two schedules that ran on the same date are two trains. A run with no readable date
 * cannot be checked, so a schedule with one is never folded.
 */
function isSameTrain(
  fold: Fold,
  service: ScheduledService,
  dates: ReadonlySet<string>,
): boolean {
  const anchor = fold.anchor;
  const taken = fold.dates;
  if (!taken || anchor.operatorCode !== service.operatorCode) {
    return false;
  }
  if (
    minutesApart(anchor.publicDeparture, service.publicDeparture) >
    SAME_TRAIN_MINUTES
  ) {
    return false;
  }
  if (!similarJourney(anchor, service)) {
    return false;
  }
  return ![...dates].some((date) => taken.has(date));
}

/** True when the public journeys differ by at most `SAME_JOURNEY_MINUTES`. */
function similarJourney(
  left: Pick<ScheduledService, "publicDeparture" | "publicArrival">,
  right: Pick<ScheduledService, "publicDeparture" | "publicArrival">,
): boolean {
  return !(
    Math.abs(
      journeyMinutes(left.publicDeparture, left.publicArrival) -
        journeyMinutes(right.publicDeparture, right.publicArrival),
    ) > SAME_JOURNEY_MINUTES
  );
}

/**
 * A train that runs only on day types another lacks, such as the Sunday 11:49 for a
 * Monday-to-Saturday 11:43, joins it when it is the only such train within ten minutes
 * and the journey takes about the same time.
 * With two candidates, as on a train every quarter hour, it stays its own row.
 * Smaller trains are placed first. A train that has taken one in is not placed again.
 */
function foldAcrossDays(
  services: readonly ScheduledService[],
): ScheduledService[] {
  const entries = [...services];
  const ranked = [...services].sort(
    (left, right) =>
      left.rids.length - right.rids.length ||
      left.publicDeparture.localeCompare(right.publicDeparture) ||
      serviceKey(left).localeCompare(serviceKey(right)),
  );
  for (const candidate of ranked) {
    if (!entries.includes(candidate)) {
      continue;
    }
    const homes = entries.filter(
      (entry) => entry !== candidate && isOtherDaysTrain(entry, candidate),
    );
    const home = homes.length === 1 ? homes[0] : undefined;
    if (!home) {
      continue;
    }
    entries[entries.indexOf(home)] = joinOtherDays(home, candidate);
    entries.splice(entries.indexOf(candidate), 1);
  }
  return entries.sort(
    (left, right) =>
      left.publicDeparture.localeCompare(right.publicDeparture) ||
      serviceKey(left).localeCompare(serviceKey(right)),
  );
}

function isOtherDaysTrain(
  home: ScheduledService,
  service: ScheduledService,
): boolean {
  if (
    home.operatorCode !== service.operatorCode ||
    home.rids.length < service.rids.length
  ) {
    return false;
  }
  if (
    service.days.length === 0 ||
    service.days.some((day) => home.days.includes(day))
  ) {
    return false;
  }
  if (
    minutesApart(home.publicDeparture, service.publicDeparture) >
      OTHER_DAYS_TRAIN_MINUTES ||
    !similarJourney(home, service)
  ) {
    return false;
  }
  const homeDates = runDates(home.rids);
  const dates = runDates(service.rids);
  if (!homeDates || !dates) {
    return false;
  }
  return ![...dates].some((date) => homeDates.has(date));
}

function joinOtherDays(
  home: ScheduledService,
  service: ScheduledService,
): ScheduledService {
  const folded = new Set(
    (service.variants ?? []).flatMap((variant) => variant.rids),
  );
  const own = service.rids.filter((rid) => !folded.has(rid));
  const variants: ServiceVariant[] = [
    ...(home.variants ?? []),
    {
      originCrs: service.originCrs,
      destinationCrs: service.destinationCrs,
      publicDeparture: service.publicDeparture,
      publicArrival: service.publicArrival,
      runCount: own.length,
      rids: own,
    },
    ...(service.variants ?? []),
  ];
  return withPunctuality(
    {
      ...home,
      rids: [...home.rids, ...service.rids],
      days: orderedDays([...home.days, ...service.days]),
      variants,
    },
    [home, service],
  );
}

/** Sets the summed count of `parts` on a joined train, or drops it when a part has none. */
function withPunctuality(
  service: ScheduledService,
  parts: readonly ScheduledService[],
): ScheduledService {
  const { punctuality: _ignored, ...rest } = service;
  const counts = parts.map((part) => part.punctuality);
  if (counts.some((count) => count === undefined)) {
    return rest;
  }
  const total = (key: keyof ListPunctuality) =>
    counts.reduce((sum, count) => sum + (count?.[key] ?? 0), 0);
  return {
    ...rest,
    punctuality: {
      runs: total("runs"),
      within5: total("within5"),
      within14: total("within14"),
      within29: total("within29"),
    },
  };
}

function runDates(rids: readonly string[]): Set<string> | undefined {
  const dates = new Set<string>();
  for (const rid of rids) {
    const date = dateOfRid(rid);
    if (!date) {
      return undefined;
    }
    dates.add(date);
  }
  return dates;
}
