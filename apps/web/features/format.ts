import { searchClockRange } from "@railscore/core";
import type { ScheduledService, ServiceDay } from "@/server/hsp/map";

const DAY_LABELS: Record<ServiceDay, string> = {
  weekdays: "Weekdays",
  saturday: "Saturdays",
  sunday: "Sundays",
};

const DAY_ORDER: readonly ServiceDay[] = ["weekdays", "saturday", "sunday"];

const OPERATORS: Record<string, string> = {
  AW: "Transport for Wales",
  CC: "c2c",
  CH: "Chiltern Railways",
  CS: "Caledonian Sleeper",
  EM: "East Midlands Railway",
  GC: "Grand Central",
  GN: "Great Northern",
  GR: "LNER",
  GW: "GWR",
  GX: "Gatwick Express",
  HT: "Hull Trains",
  HX: "Heathrow Express",
  LD: "Lumo",
  LE: "Greater Anglia",
  LM: "West Midlands Trains",
  LO: "London Overground",
  ME: "Merseyrail",
  NT: "Northern",
  SE: "Southeastern",
  SN: "Southern",
  SR: "ScotRail",
  SW: "South Western Railway",
  TL: "Thameslink",
  TP: "TransPennine Express",
  VT: "Avanti West Coast",
  XC: "CrossCountry",
  XR: "Elizabeth line",
};

export function operatorName(code: string): string {
  return OPERATORS[code] ?? code;
}

/**
 * Day types for a train, when they are narrower than the search.
 * Empty when they repeat the filter or the train has none.
 */
export function serviceDayNote(
  days: readonly ServiceDay[],
  searched: ServiceDay | "all",
): string {
  const present = DAY_ORDER.filter((day) => days.includes(day));
  const searchedDays = searched === "all" ? DAY_ORDER : [searched];
  const repeatsSearch =
    present.length === searchedDays.length &&
    present.every((day) => searchedDays.includes(day));
  if (present.length === 0 || repeatsSearch) {
    return "";
  }
  return joinLabels(present.map((day) => DAY_LABELS[day]));
}

/** Run count plus the day types those runs belong to, in weekday–Saturday–Sunday order. */
export function formatServiceFacts(
  runCount: number,
  days: readonly ServiceDay[],
  searched?: ServiceDay | "all",
): string {
  const runs = `${runCount} ${runCount === 1 ? "run" : "runs"}`;
  const labels = DAY_ORDER.filter((day) => days.includes(day)).map(
    (day) => DAY_LABELS[day],
  );
  const note = searched
    ? serviceDayNote(days, searched)
    : labels.length === 0
      ? ""
      : joinLabels(labels);
  if (!note) {
    return runs;
  }
  return `${runs} · ${note}`;
}

/** True when some runs of this train kept other public times than its usual ones. */
export function hasTimeVariants(service: ScheduledService): boolean {
  return (service.variants ?? []).some(
    (variant) =>
      variant.publicDeparture !== service.publicDeparture ||
      variant.publicArrival !== service.publicArrival,
  );
}

/**
 * Where a train runs beyond the searched stations.
 * "Starts at Llandudno", "Continues to Manchester", or both ends when the journey sits in the middle.
 * Empty when the train only runs between those stations, or when it is circular.
 */
export function throughServiceLabel(
  service: Pick<ScheduledService, "originCrs" | "destinationCrs">,
  fromCrs: string,
  toCrs: string,
  stationNameOf: (crs: string) => string,
): string {
  if (service.originCrs === service.destinationCrs) {
    return "";
  }
  if (service.originCrs === fromCrs && service.destinationCrs === toCrs) {
    return "";
  }
  const origin = stationNameOf(service.originCrs);
  const destination = stationNameOf(service.destinationCrs);
  if (service.destinationCrs === toCrs) {
    return `Starts at ${origin}`;
  }
  if (service.originCrs === fromCrs) {
    return `Continues to ${destination}`;
  }
  return `${origin} to ${destination}`;
}

function joinLabels(labels: readonly string[]): string {
  if (labels.length === 1) {
    return labels[0] ?? "";
  }
  if (labels.length === 2) {
    return `${labels[0]} and ${labels[1]}`;
  }
  return `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
}

export function timeSearchLabel(time: string): string {
  return `Departing after ${time}`;
}

/** The exact minutes this list covers. Departing after 07:00 is 07:00–07:59. */
export function timeWindowLabel(time: string): string {
  const range = searchClockRange(time.replace(":", ""));
  return `${formatClock(range.from)}–${formatClock(range.to)}`;
}

export function formatClock(hhmm: string): string {
  return `${hhmm.slice(0, 2)}:${hhmm.slice(2, 4)}`;
}

/** Moves an `HH:MM` time by whole minutes, wrapping at midnight. */
export function shiftTime(time: string, deltaMinutes: number): string {
  const match = /^(\d{2}):(\d{2})$/.exec(time);
  if (!match) {
    return time;
  }
  const minutes = Number(match[1]) * 60 + Number(match[2]);
  const wrapped =
    (((minutes + deltaMinutes) % (24 * 60)) + 24 * 60) % (24 * 60);
  const hours = Math.floor(wrapped / 60);
  const mins = wrapped % 60;
  return `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}`;
}

/** Journey length between two public HHMM times; an arrival before departure crosses midnight. */
export function formatDuration(departure: string, arrival: string): string {
  const minutes =
    (clockMinutes(arrival) - clockMinutes(departure) + 24 * 60) % (24 * 60);
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) {
    return `${rest}m`;
  }
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}

export function formatDate(iso: string): string {
  const [year, month, day] = iso.split("-");
  return `${day}/${month}/${year}`;
}

function clockMinutes(hhmm: string): number {
  return Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(2, 4));
}
