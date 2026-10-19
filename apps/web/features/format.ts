import { counted, journeyMinutes, searchClockRange } from "@railscore/core";
import type {
  ListPunctuality,
  ScheduledService,
  ServiceDay,
} from "@/server/hsp/map";

export const DAY_LABELS: Record<ServiceDay, string> = {
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

/** Journey count, with the day types first when they are narrower than the search. */
export function formatServiceFacts(
  runCount: number,
  days: readonly ServiceDay[],
  searched?: ServiceDay | "all",
): string {
  const journeys = `${runCount} ${runCount === 1 ? "journey" : "journeys"}`;
  const labels = DAY_ORDER.filter((day) => days.includes(day)).map(
    (day) => DAY_LABELS[day],
  );
  const note = searched
    ? serviceDayNote(days, searched)
    : labels.length === 0
      ? ""
      : joinLabels(labels);
  if (!note) {
    return journeys;
  }
  return `${note} · ${journeys}`;
}

/** The list's on-time share, and how many journeys were cancelled or very late. */
export type ListScore = {
  readonly onTimePercent: number;
  readonly severe: number;
};

/**
 * HSP's own figure for a listed train. Undefined when HSP gave no count.
 * Severe journeys are those outside 29 minutes: cancelled or 30 or more minutes late.
 */
export function listScore(
  punctuality: ListPunctuality | undefined,
): ListScore | undefined {
  if (!punctuality || punctuality.runs === 0) {
    return undefined;
  }
  const onTime = counted(punctuality.within5, punctuality.runs).percentage;
  if (onTime === null) {
    return undefined;
  }
  return {
    onTimePercent: onTime,
    severe: Math.max(0, punctuality.runs - punctuality.within29),
  };
}

/** The warning under a listed train. Empty when every journey was under 30 minutes late. */
export function formatSevereJourneys(count: number): string {
  if (count <= 0) {
    return "";
  }
  const journeys = count === 1 ? "journey" : "journeys";
  return `${count} ${journeys} cancelled or over 30 minutes late`;
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
  return `From ${origin} to ${destination}`;
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

/** Collapsed search summary. Names the hour the list covers, not only its start. */
export function timeSearchLabel(time: string): string {
  return `Departing ${timeWindowLabel(time)}`;
}

/**
 * Help under the time field. Names the hour that will be listed.
 * A partial clock keeps a general line, because the range needs a valid time.
 */
export function departureWindowHint(time: string): string {
  if (!validClock(time)) {
    return "Shows direct trains leaving in the hour from this time.";
  }
  return `Shows direct trains leaving ${timeWindowLabel(time)}.`;
}

/** The exact minutes this list covers. Departing from 07:00 lists 07:00–07:59. */
export function timeWindowLabel(time: string): string {
  const range = clockWindow(time);
  return `${formatClock(range.from)}–${formatClock(range.to)}`;
}

/** Heading above the train list. Departing from 07:00 reads "Trains from 07:00 to 07:59". */
export function trainListHeading(time: string): string {
  const range = clockWindow(time);
  return `Trains from ${formatClock(range.from)} to ${formatClock(range.to)}`;
}

/** The sentence under the list heading. Names the period, then what on time means. */
export function listIntro(input: {
  periodDays: number;
  listedTo?: string;
  sample: boolean;
}): string {
  const meaning = "On time means it arrived early or less than 5 minutes late.";
  if (input.sample) {
    return `Sample trains for trying the screens. ${meaning}`;
  }
  const window = input.listedTo
    ? `in the last ${input.periodDays} days, up to ${formatDate(input.listedTo)}`
    : `in the last ${input.periodDays} days`;
  return `How often each direct train arrived on time ${window}. ${meaning}`;
}

function clockWindow(time: string): { from: string; to: string } {
  return searchClockRange(time.replace(":", ""));
}

function validClock(time: string): boolean {
  const match = /^(\d{2}):(\d{2})$/.exec(time);
  if (!match) {
    return false;
  }
  return Number(match[1]) <= 23 && Number(match[2]) <= 59;
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
  const minutes = journeyMinutes(departure, arrival);
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
