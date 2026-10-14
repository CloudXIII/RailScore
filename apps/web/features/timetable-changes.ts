import { formatClock } from "@/features/format";
import { dayTypeOf } from "@/server/day-type";
import {
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

const DAY_LABELS: Record<ServiceDay, string> = {
  weekdays: "Weekdays",
  saturday: "Saturdays",
  sunday: "Sundays",
};

/** One public timetable folded into the usual one, named by the days it ran. */
export type IncludedTimes = {
  readonly label: string;
  readonly publicDeparture: string;
  readonly publicArrival: string;
};

/**
 * The other public times folded into this train, one line each.
 * "Sundays 11:49–12:35". Undated runs fall back to a run count.
 */
export function includedTimes(service: ScheduledService): IncludedTimes[] {
  return (service.variants ?? [])
    .filter(
      (variant) =>
        variant.publicDeparture !== service.publicDeparture ||
        variant.publicArrival !== service.publicArrival,
    )
    .map((variant) => ({
      label: dayLabelFor(variant),
      publicDeparture: variant.publicDeparture,
      publicArrival: variant.publicArrival,
    }))
    .sort(
      (left, right) =>
        left.publicDeparture.localeCompare(right.publicDeparture) ||
        left.publicArrival.localeCompare(right.publicArrival) ||
        left.label.localeCompare(right.label),
    );
}

export function includedTimesText(included: IncludedTimes): string {
  return `${included.label} ${formatClock(included.publicDeparture)}–${formatClock(included.publicArrival)}`;
}

/**
 * What to tell a passenger about folded times. A minute or two is left out.
 * A different departure is named in full. A same departure with a distant arrival
 * says when that arrival was booked.
 */
export function scheduleNotes(service: ScheduledService): string[] {
  return (service.variants ?? []).flatMap((variant) => {
    if (!isNotableTime(service, variant)) {
      return [];
    }
    if (
      minutesApart(service.publicDeparture, variant.publicDeparture) >
      SAME_TRAIN_MINUTES
    ) {
      return [differentDepartureNote(variant)];
    }
    return [bookedArrivalNote(variant)];
  });
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
  const usual = (["weekdays", "saturday", "sunday"] as const).filter(
    (day) => (counts.get(day) ?? 0) >= 2,
  );
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

function differentDepartureNote(variant: ServiceVariant): string {
  const leave = formatClock(variant.publicDeparture);
  const arrive = formatClock(variant.publicArrival);
  const days = dayLabelFor(variant);
  if (days === "1 run") {
    return `1 run was booked to leave at ${leave} and arrive at ${arrive}`;
  }
  if (/^\d+ runs$/.test(days)) {
    return `${days} were booked to leave at ${leave} and arrive at ${arrive}`;
  }
  return `${onTheseDays(days)} it leaves at ${leave} and arrives at ${arrive}`;
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
  if (days === "Saturdays") {
    return count === 1
      ? `1 Saturday was booked to arrive at ${arrival}`
      : `${count} Saturdays were booked to arrive at ${arrival}`;
  }
  if (days === "Sundays") {
    return count === 1
      ? `1 Sunday was booked to arrive at ${arrival}`
      : `${count} Sundays were booked to arrive at ${arrival}`;
  }
  if (days === "Weekdays") {
    return count === 1
      ? `1 weekday was booked to arrive at ${arrival}`
      : `${count} weekdays were booked to arrive at ${arrival}`;
  }
  return `${count} ${count === 1 ? "run was" : "runs were"} booked to arrive at ${arrival}`;
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
  const labels = (["weekdays", "saturday", "sunday"] as const)
    .filter((day) => present.has(day))
    .map((day) => DAY_LABELS[day]);
  if (labels.length === 0) {
    return variant.runCount === 1 ? "1 run" : `${variant.runCount} runs`;
  }
  if (labels.length === 1) {
    return labels[0] ?? "";
  }
  if (labels.length === 2) {
    return `${labels[0]} and ${labels[1]}`;
  }
  return `${labels[0]}, ${labels[1]} and ${labels[2]}`;
}

function minutesApart(left: string, right: string): number {
  const difference = Math.abs(clockMinutes(left) - clockMinutes(right));
  return Math.min(difference, 24 * 60 - difference);
}

function journeyMinutes(departure: string, arrival: string): number {
  return (
    (clockMinutes(arrival) - clockMinutes(departure) + 24 * 60) % (24 * 60)
  );
}

function clockMinutes(hhmm: string): number {
  return Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(2, 4));
}
