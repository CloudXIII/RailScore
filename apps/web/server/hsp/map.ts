import {
  addCalendarDays,
  londonIsoDate,
  signedLatenessMinutes,
  type HistoricalRun,
} from "@railscore/core";

const DAY_ORDER = ["weekdays", "saturday", "sunday"] as const;

export type ServiceDay = (typeof DAY_ORDER)[number];

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

/** Minutes a journey may differ in length when matching a departure that runs on other days. */
export const SAME_JOURNEY_MINUTES = 15;

/** Minutes either way a departure may differ when the two trains never share a day type. */
export const OTHER_DAYS_TRAIN_MINUTES = 10;

/** A train with no run in this many days before the period ends no longer runs. Two weeks, as recent days can lag. */
export const RETIRED_AFTER_DAYS = 14;

export class HspResponseError extends Error {}

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

/** Reads a synthetic or live serviceMetrics JSON object. Does not call the network. */
export function parseServiceMetrics(payload: unknown): ScheduledService[] {
  const root = record(payload);
  if (!root || !Array.isArray(root.Services)) {
    throw new HspResponseError(
      "The service list was not in the expected shape.",
    );
  }
  return root.Services.flatMap((value) => {
    const service = parseService(value);
    return service ? [service] : [];
  });
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
 * most-run schedule. Same operator, departure within two minutes, and no shared run date.
 * Then folds a train that runs on other day types only into the one train it replaces,
 * when the journey is about the same length.
 */
export function mergeServices(
  groups: readonly ScheduledService[][],
): ScheduledService[] {
  return foldAcrossDays(assembleServices(groups));
}

/**
 * Like `mergeServices`, but trains whose last run is long before `periodEnd` are set apart,
 * as after a timetable change. They are set apart before the day-type fold, so a train
 * that no longer runs cannot absorb one that still does.
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
 * Timed schedules are folded first. A row HSP listed with no public arrival, such as a
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
  const next = services.map((service) => ({
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
    next[index] = {
      ...home,
      rids: [...new Set([...home.rids, ...extra.rids])],
      days: orderedDays([...home.days, ...extra.days]),
    };
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
      merged.set(key, {
        ...existing,
        rids: [...new Set([...existing.rids, ...service.rids])],
        days: orderedDays([...existing.days, ...service.days]),
      });
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
    });
  }
  return folds
    .map((fold) => ({
      ...fold.anchor,
      rids: fold.rids,
      days: orderedDays(fold.days),
      ...(fold.variants.length > 0 ? { variants: fold.variants } : {}),
    }))
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
  return ![...dates].some((date) => taken.has(date));
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
    Math.abs(
      journeyMinutes(home.publicDeparture, home.publicArrival) -
        journeyMinutes(service.publicDeparture, service.publicArrival),
    ) > SAME_JOURNEY_MINUTES
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
  return {
    ...home,
    rids: [...home.rids, ...service.rids],
    days: orderedDays([...home.days, ...service.days]),
    variants,
  };
}

function runDates(rids: readonly string[]): Set<string> | undefined {
  const dates = new Set<string>();
  for (const rid of rids) {
    const date = serviceDateOf({}, rid);
    if (!date) {
      return undefined;
    }
    dates.add(date);
  }
  return dates;
}

function journeyMinutes(departure: string, arrival: string): number {
  return (
    (clockMinutes(arrival) - clockMinutes(departure) + 24 * 60) % (24 * 60)
  );
}

function minutesApart(left: string, right: string): number {
  const difference = Math.abs(clockMinutes(left) - clockMinutes(right));
  return Math.min(difference, 24 * 60 - difference);
}

function clockMinutes(hhmm: string): number {
  return Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(2, 4));
}

/**
 * A details payload this service could not read. Stored so this calculation can finish.
 * It is not an observation: the store trusts it for a few hours, then asks again.
 */
export function unreadableDetails(
  rid: string,
  now = new Date(),
): { payload: unknown; serviceDate: string } {
  const fromRid = serviceDateOf({}, rid);
  const serviceDate = fromRid ?? addCalendarDays(londonIsoDate(now), -4);
  const details: Record<string, unknown> = { locations: [] };
  if (fromRid) {
    details.date_of_service = fromRid;
  }
  return { payload: { serviceAttributesDetails: details }, serviceDate };
}

/** True for the placeholder `unreadableDetails` stores. A real calling pattern is not one. */
export function isUnreadableDetails(payload: unknown): boolean {
  const root = record(payload);
  const details = root ? record(root.serviceAttributesDetails) : undefined;
  return (
    details !== undefined &&
    Array.isArray(details.locations) &&
    details.locations.length === 0
  );
}

/**
 * Classifies one details payload. An unreadable payload is a run with no data,
 * so one bad response does not fail the whole service.
 */
export function historicalRunFromDetails(
  payload: unknown,
  stations: { boardingCrs: string; destinationCrs: string },
  rid: string,
): HistoricalRun {
  try {
    return toHistoricalRun(payload, stations, rid);
  } catch (error) {
    if (!(error instanceof HspResponseError)) {
      throw error;
    }
    const serviceDate = serviceDateOf(payload, rid);
    return serviceDate
      ? { id: rid, serviceDate, outcome: "missing_actual" }
      : { id: rid, outcome: "missing_actual" };
  }
}

/**
 * Classifies one run for a passenger boarding at `boardingCrs`. HSP has no cancellation flag:
 * a stop with no actual time and a `late_canc_reason` is a stop the train did not make.
 */
export function toHistoricalRun(
  payload: unknown,
  stations: { boardingCrs: string; destinationCrs: string },
  rid: string,
): HistoricalRun {
  const root = record(payload);
  const details = root ? record(root.serviceAttributesDetails) : undefined;
  if (!details || !Array.isArray(details.locations)) {
    throw new HspResponseError(
      "A historical run was not in the expected shape.",
    );
  }
  const stops = details.locations
    .map(record)
    .filter((stop) => stop !== undefined);
  const serviceDate = serviceDateOf(payload, rid);
  const base = serviceDate ? { id: rid, serviceDate } : { id: rid };
  const boarding = stops.find((stop) => stop.location === stations.boardingCrs);
  const destination = stops.find(
    (stop) => stop.location === stations.destinationCrs,
  );
  if (!destination) {
    return { ...base, outcome: "missing_actual" };
  }
  const scheduled = text(destination.gbtt_pta);
  const actual = text(destination.actual_ta);
  if (!scheduled && !actual) {
    if (!hasReason(destination)) {
      return { ...base, outcome: "missing_actual" };
    }
    return {
      ...base,
      outcome: stops.some(hasActual) ? "did_not_call" : "cancelled",
    };
  }
  if (!scheduled) {
    return { ...base, outcome: "missing_actual" };
  }
  if (actual) {
    if (boarding && !hasActual(boarding) && hasReason(boarding)) {
      return { ...base, outcome: "did_not_call" };
    }
    try {
      return {
        ...base,
        outcome: "arrived",
        latenessMinutes: signedLatenessMinutes(scheduled, actual),
      };
    } catch {
      return { ...base, outcome: "missing_actual" };
    }
  }
  if (!hasReason(destination)) {
    return { ...base, outcome: "missing_actual" };
  }
  return {
    ...base,
    outcome: stops.some(hasActual) ? "did_not_call" : "cancelled",
  };
}

function hasActual(stop: Record<string, unknown>): boolean {
  return Boolean(text(stop.actual_ta) || text(stop.actual_td));
}

function hasReason(stop: Record<string, unknown>): boolean {
  return Boolean(text(stop.late_canc_reason));
}

/** The calendar date a run ran on, from `date_of_service`, else the RID's leading YYYYMMDD. */
export function serviceDateOf(
  payload: unknown,
  rid: string,
): string | undefined {
  const root = record(payload);
  const details = root ? record(root.serviceAttributesDetails) : undefined;
  const stated = text(details?.date_of_service);
  if (/^\d{4}-\d{2}-\d{2}$/.test(stated)) {
    return stated;
  }
  const fromRid = /^(\d{4})(\d{2})(\d{2})/.exec(rid);
  return fromRid ? `${fromRid[1]}-${fromRid[2]}-${fromRid[3]}` : undefined;
}

/**
 * A public arrival may be blank, as on a cancelled call that only has a public departure.
 * That row is kept so its runs can join the matching train. A row with no departure,
 * operator, origin or destination is left out, so one bad row does not fail the list.
 */
function parseService(value: unknown): ScheduledService | undefined {
  const service = record(value);
  const attributes = service
    ? record(service.serviceAttributesMetrics)
    : undefined;
  const departure = text(attributes?.gbtt_ptd);
  const arrival = text(attributes?.gbtt_pta);
  const operator = text(attributes?.toc_code);
  const origin = text(attributes?.origin_location);
  const destination = text(attributes?.destination_location);
  if (!departure || !operator || !origin || !destination || !attributes) {
    return undefined;
  }
  const rids = Array.isArray(attributes.rids)
    ? attributes.rids.filter((rid): rid is string => typeof rid === "string")
    : [];
  if (
    Array.isArray(attributes.rids) &&
    rids.length !== attributes.rids.length
  ) {
    throw new HspResponseError(
      "A listed service had an unreadable run identifier.",
    );
  }
  return {
    originCrs: origin,
    destinationCrs: destination,
    publicDeparture: departure,
    publicArrival: arrival,
    operatorCode: operator,
    rids,
    days: [],
  };
}

function orderedDays(days: readonly ServiceDay[]): ServiceDay[] {
  const present = new Set(days);
  return DAY_ORDER.filter((day) => present.has(day));
}

function record(value: unknown): Record<string, unknown> | undefined {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return undefined;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
