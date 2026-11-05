import { addCalendarDays, counted, journeyMinutes } from "@railscore/core";
import type {
  ListPunctuality,
  ScheduledService,
  ServiceDay,
} from "@/server/services/map";

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
  /** Undefined while the count is still loading: the days alone are shown. */
  runCount: number | undefined,
  days: readonly ServiceDay[],
  searched?: ServiceDay | "all",
): string {
  const journeys =
    runCount === undefined
      ? ""
      : `${runCount} ${runCount === 1 ? "journey" : "journeys"}`;
  const labels = DAY_ORDER.filter((day) => days.includes(day)).map(
    (day) => DAY_LABELS[day],
  );
  const note = searched
    ? serviceDayNote(days, searched)
    : labels.length === 0
      ? ""
      : joinLabels(labels);
  if (!note || !journeys) {
    return note || journeys;
  }
  return `${note} · ${journeys}`;
}

/** The list's on-time share, and how many journeys were cancelled or very late. */
export type ListScore = {
  readonly onTimePercent: number;
  readonly severe: number;
  readonly runs: number;
};

/**
 * The list's own figure for a train. Undefined when it came without a count.
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
    runs: punctuality.runs,
  };
}

/** How a listed or headline on-time share reads at a glance. */
export type ScoreTier = "good" | "fair" | "poor";

/** 90% or more is good, 75% or more is fair. The figure stays on screen: colour is never the only signal. */
export function scoreTier(percent: number): ScoreTier {
  return percent >= 90 ? "good" : percent >= 75 ? "fair" : "poor";
}

/** Share of journeys cancelled or 30+ minutes late below which a listed train shows no warning. */
const SEVERE_WARNING_SHARE = 0.1;

/**
 * The warning under a listed train. Empty unless at least one journey in ten was cancelled
 * or 30 or more minutes late, so a single bad day does not mark every row.
 */
export function formatSevereJourneys(count: number, runs: number): string {
  if (count <= 0 || runs <= 0 || count / runs < SEVERE_WARNING_SHARE) {
    return "";
  }
  return `${count} of ${runs} journeys cancelled or over 30 minutes late`;
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

/** Collapsed search summary. */
export function timeSearchLabel(time: string): string {
  return `Departing from ${time}`;
}

/** Help under the time field. */
export function departureWindowHint(): string {
  return "Shows the next direct trains from this time. Journeys with a change are not included.";
}

/**
 * Heading above the train list. Names the first and last listed departures, since the
 * list is the next few trains and can span minutes or hours.
 */
export function trainListHeading(
  time: string,
  departures: readonly string[],
): string {
  const sorted = [...departures].sort();
  const first = sorted[0];
  const last = sorted.at(-1);
  if (!first || !last) {
    return `Trains from ${time}`;
  }
  return first === last
    ? `Train at ${formatClock(first)}`
    : `Trains from ${formatClock(first)} to ${formatClock(last)}`;
}

/**
 * The sentence under the list heading. Names the period, then what on time means.
 * Before a full period of runs is stored, it names the days recorded so far.
 */
export function listIntro(input: {
  periodDays: number;
  /** Dates the listed runs cover. */
  listed?: { from: string; to: string };
  sample: boolean;
}): string {
  const meaning = "On time means no more than 5 minutes late.";
  if (input.sample) {
    return `Sample trains for trying the screens. ${meaning}`;
  }
  const listed = input.listed;
  const window =
    listed && listed.from > addCalendarDays(listed.to, 1 - input.periodDays)
      ? `since ${formatDate(listed.from)}, the first day recorded`
      : `over the last ${input.periodDays} days`;
  return `Arrivals ${window}. ${meaning}`;
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
