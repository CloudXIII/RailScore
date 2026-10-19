import { journeyMinutes, minutesApart } from "@railscore/core";
import { DAY_LABELS, formatClock } from "@/features/format";
import { dayTypeOf } from "@/server/day-type";
import {
  DAY_ORDER,
  SAME_TRAIN_MINUTES,
  serviceDateOf,
  type ScheduledService,
  type ServiceDay,
  type ServiceVariant,
} from "@/server/hsp/map";

/** An arrival this far from the usual one is worth naming. Smaller differences stay quiet. */
const NOTABLE_ARRIVAL_MINUTES = 15;

export type TimetableChange = {
  readonly serviceDate: string;
  readonly publicDeparture: string;
  readonly publicArrival: string;
  /** Scheduled journey minutes against the usual timetable. Positive is longer. */
  readonly extraMinutes: number;
};

/** Dated runs that kept other public times than the train's usual ones, in date order. */
export function timetableChanges(service: ScheduledService): TimetableChange[] {
  const usual = journeyMinutes(service.publicDeparture, service.publicArrival);
  const changes = (service.variants ?? []).flatMap((variant) => {
    if (
      variant.publicDeparture === service.publicDeparture &&
      variant.publicArrival === service.publicArrival
    ) {
      return [];
    }
    const extraMinutes =
      journeyMinutes(variant.publicDeparture, variant.publicArrival) - usual;
    return variant.rids.flatMap((rid) => {
      const serviceDate = serviceDateOf({}, rid);
      return serviceDate
        ? [
            {
              serviceDate,
              publicDeparture: variant.publicDeparture,
              publicArrival: variant.publicArrival,
              extraMinutes,
            },
          ]
        : [];
    });
  });
  return changes.sort((left, right) =>
    left.serviceDate.localeCompare(right.serviceDate),
  );
}

/** Other-day times this close together read as one line with a range. */
const NEARBY_DEPARTURE_MINUTES = 5;

/**
 * What to tell a passenger about folded times. A minute or two is left out.
 * A different departure is named in full, with close ones on the same days joined
 * into a range. A same departure with a distant arrival names that arrival.
 */
export function scheduleNotes(service: ScheduledService): string[] {
  const notable = mergeSameTimes(service.variants ?? []).filter((variant) =>
    isNotableTime(service, variant),
  );
  const moved = notable.filter(
    (variant) =>
      minutesApart(service.publicDeparture, variant.publicDeparture) >
      SAME_TRAIN_MINUTES,
  );
  return [
    ...nearbyGroups(moved).map(differentDepartureNote),
    ...notable
      .filter((variant) => !moved.includes(variant))
      .map(bookedArrivalNote),
  ];
}

type TimeGroup = {
  readonly days: string;
  readonly departures: string[];
  readonly arrivals: string[];
};

/** Joins other-day times on the same days whose departures and arrivals sit close together. */
function nearbyGroups(variants: readonly ServiceVariant[]): TimeGroup[] {
  const groups: TimeGroup[] = [];
  const sorted = [...variants].sort(
    (left, right) =>
      left.publicDeparture.localeCompare(right.publicDeparture) ||
      left.publicArrival.localeCompare(right.publicArrival),
  );
  for (const variant of sorted) {
    const days = dayLabelFor(variant);
    const dated = !/^\d+ journeys?$/.test(days);
    const home = dated
      ? groups.find(
          (group) =>
            group.days === days &&
            minutesApart(group.departures[0] ?? "", variant.publicDeparture) <=
              NEARBY_DEPARTURE_MINUTES &&
            minutesApart(group.arrivals[0] ?? "", variant.publicArrival) <=
              NOTABLE_ARRIVAL_MINUTES,
        )
      : undefined;
    if (home) {
      home.departures.push(variant.publicDeparture);
      home.arrivals.push(variant.publicArrival);
      continue;
    }
    groups.push({
      days,
      departures: [variant.publicDeparture],
      arrivals: [variant.publicArrival],
    });
  }
  return groups;
}

/** Variants from different origins can share public times. A passenger sees them as one. */
function mergeSameTimes(variants: readonly ServiceVariant[]): ServiceVariant[] {
  const merged = new Map<string, ServiceVariant>();
  for (const variant of variants) {
    const key = `${variant.publicDeparture}|${variant.publicArrival}`;
    const existing = merged.get(key);
    merged.set(
      key,
      existing
        ? {
            ...existing,
            runCount: existing.runCount + variant.runCount,
            rids: [...existing.rids, ...variant.rids],
          }
        : variant,
    );
  }
  return [...merged.values()];
}

/** Day types with more than one run. A single odd day does not change what the train is. */
export function usualDays(service: ScheduledService): ServiceDay[] {
  const counts = new Map<ServiceDay, number>();
  for (const rid of service.rids) {
    const date = serviceDateOf({}, rid);
    const day = date ? dayTypeOf(date) : undefined;
    if (day) {
      counts.set(day, (counts.get(day) ?? 0) + 1);
    }
  }
  const usual = DAY_ORDER.filter((day) => (counts.get(day) ?? 0) >= 2);
  return usual.length > 0 ? usual : [...service.days];
}

/** Dated runs whose booked times are far enough from the usual ones to mark on the calendar. */
export function notableChanges(service: ScheduledService): TimetableChange[] {
  return timetableChanges(service).filter((change) =>
    isNotableTime(service, change),
  );
}

function isNotableTime(
  service: Pick<ScheduledService, "publicDeparture" | "publicArrival">,
  times: { publicDeparture: string; publicArrival: string },
): boolean {
  return (
    minutesApart(service.publicDeparture, times.publicDeparture) >
      SAME_TRAIN_MINUTES ||
    minutesApart(service.publicArrival, times.publicArrival) >
      NOTABLE_ARRIVAL_MINUTES
  );
}

function differentDepartureNote(group: TimeGroup): string {
  const leave = clockRange(group.departures);
  const arrive = clockRange(group.arrivals);
  const days = group.days;
  if (days === "1 journey") {
    return `1 journey was booked to leave ${leave} and arrive ${arrive}`;
  }
  if (/^\d+ journeys$/.test(days)) {
    return `${days} were booked to leave ${leave} and arrive ${arrive}`;
  }
  return `${onTheseDays(days)} it leaves ${leave} and arrives ${arrive}`;
}

/** "at 09:29", or "between 10:03 and 10:06" when the times differ. */
function clockRange(times: readonly string[]): string {
  const sorted = [...new Set(times)].sort();
  const first = sorted[0] ?? "";
  const last = sorted.at(-1) ?? first;
  return first === last
    ? `at ${formatClock(first)}`
    : `between ${formatClock(first)} and ${formatClock(last)}`;
}

function onTheseDays(days: string): string {
  if (days === "Weekdays") {
    return "On weekdays";
  }
  if (days === "Saturdays" || days === "Sundays") {
    return `On ${days}`;
  }
  return `On ${days.charAt(0).toLowerCase()}${days.slice(1)}`;
}

function bookedArrivalNote(variant: ServiceVariant): string {
  const arrival = formatClock(variant.publicArrival);
  const count = variant.runCount;
  const days = dayLabelFor(variant);
  const named =
    days === "Saturdays"
      ? "Saturday"
      : days === "Sundays"
        ? "Sunday"
        : days === "Weekdays"
          ? "weekday"
          : undefined;
  if (!named) {
    return count === 1
      ? `1 journey was scheduled to arrive at ${arrival} instead`
      : `${count} journeys were scheduled to arrive at ${arrival} instead`;
  }
  return `On ${count} ${named}${count === 1 ? "" : "s"} it was scheduled to arrive at ${arrival} instead`;
}

function dayLabelFor(variant: ServiceVariant): string {
  const present = new Set<ServiceDay>();
  for (const rid of variant.rids) {
    const date = serviceDateOf({}, rid);
    const day = date ? dayTypeOf(date) : undefined;
    if (day) {
      present.add(day);
    }
  }
  const labels = DAY_ORDER.filter((day) => present.has(day)).map(
    (day) => DAY_LABELS[day],
  );
  if (labels.length === 0) {
    return variant.runCount === 1
      ? "1 journey"
      : `${variant.runCount} journeys`;
  }
  if (labels.length === 1) {
    return labels[0] ?? "";
  }
  if (labels.length === 2) {
    return `${labels[0]} and ${labels[1]}`;
  }
  return `${labels[0]}, ${labels[1]} and ${labels[2]}`;
}
