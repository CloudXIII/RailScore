import {
  addCalendarDays,
  counted,
  journeyMinutes,
  type PunctualityTally,
} from "@railscore/core";
import {
  DAY_TYPES,
  dayTypesOf,
  type DayPattern,
  type ServiceDay,
} from "@/shared/day-type";
import type { ScheduledService } from "@/shared/scheduled-service";

export const DAY_LABELS: Record<ServiceDay, string> = {
  weekdays: "Weekdays",
  saturday: "Saturdays",
  sunday: "Sundays",
};

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
  searched: DayPattern,
): string {
  const present = DAY_TYPES.filter((day) => days.includes(day));
  const searchedDays = dayTypesOf(searched);
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
  searched?: DayPattern,
): string {
  const journeys =
    runCount === undefined
      ? ""
      : `${runCount} ${runCount === 1 ? "journey" : "journeys"}`;
  const labels = DAY_TYPES.filter((day) => days.includes(day)).map(
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
  punctuality: PunctualityTally | undefined,
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
export type ScoreTier = "good" | "fair" | "poor" | "few";

/** Below this many journeys an on-time share is shown without a verdict colour. */
export const FEW_JOURNEYS = 5;

/**
 * 90% or more is good, 75% or more is fair. Fewer than five journeys get no colour: 100% of one
 * journey says little. The figure stays on screen: colour is never the only signal.
 */
export function scoreTier(percent: number, journeys: number): ScoreTier {
  if (journeys < FEW_JOURNEYS) {
    return "few";
  }
  return percent >= 90 ? "good" : percent >= 75 ? "fair" : "poor";
}

/** Share of journeys cancelled or 30+ minutes late below which a listed train shows no warning. */
const SEVERE_WARNING_SHARE = 0.1;

/**
 * The warning under a listed train. Empty unless at least one journey in ten was cancelled
 * or 30 or more minutes late, so a single bad day does not mark every row, and empty below
 * five journeys, like the score's colour.
 */
export function formatSevereJourneys(count: number, runs: number): string {
  if (
    count <= 0 ||
    runs < FEW_JOURNEYS ||
    count / runs < SEVERE_WARNING_SHARE
  ) {
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
  return `${time} onwards`;
}

/** Help under the time field. */
export function departureWindowHint(): string {
  return "Direct trains only, leaving from this time.";
}

/**
 * Heading above the train list. Names the first and last listed departures, since the
 * list is the next few trains and can span minutes or hours.
 */
export function trainListHeading(
  time: string,
  /** In list order: trains after midnight come last. */
  departures: readonly string[],
): string {
  const first = departures[0];
  const last = departures.at(-1);
  if (!first || !last) {
    return `Trains from ${time}`;
  }
  return first === last
    ? `Train at ${formatClock(first)}`
    : `Trains from ${formatClock(first)} to ${formatClock(last)}`;
}

const NIGHT_BEFORE: Partial<Record<DayPattern, string>> = {
  saturday: "Friday",
  sunday: "Saturday",
};

const NIGHT_OF: Partial<Record<DayPattern, string>> = {
  saturday: "Saturday",
  sunday: "Sunday",
};

/**
 * The note on a train in the small hours. Lists run by the day a train leaves, so one at the
 * top of the list, before 04:00, ends the night before; one after the day's last train is on
 * the night after, past midnight.
 */
export function nightNote(
  part: "early" | "overnight",
  searched: DayPattern,
): string {
  if (part === "early") {
    const night = NIGHT_BEFORE[searched];
    return night
      ? `${night} night, after midnight`
      : "The night before, after midnight";
  }
  const night = NIGHT_OF[searched];
  return night
    ? `${night} night, after midnight`
    : "Late night, after midnight";
}

/** Departures before this, HHMM, at the top of a list are the end of the night before. */
const EARLY_HOURS_END = "0400";

/** True for a departure in the small hours, HHMM. */
export function inEarlyHours(hhmm: string): boolean {
  return hhmm < EARLY_HOURS_END;
}

/**
 * The line shown when the list has no trains. After a searched time, it says whether the
 * trains after midnight were looked at too.
 */
export function emptyTrains(input: {
  from: string;
  to: string;
  time: string;
  /** The day has trains before the searched time. */
  earlier: boolean;
  /** The trains after midnight were looked for, and there are none either. */
  overnight: boolean;
}): string {
  const change = "Journeys with a change are not included.";
  if (!input.earlier) {
    return `No direct trains from ${input.from} to ${input.to} in the recorded timetable. ${change}`;
  }
  return input.overnight
    ? `No more direct trains from ${input.from} to ${input.to} after ${input.time}, nor after midnight before 04:00. ${change}`
    : `No more direct trains from ${input.from} to ${input.to} after ${input.time}. ${change}`;
}

/**
 * The sentence above the train list: what on time means. The summary above names the period,
 * so it is repeated only when the runs recorded so far cover less of it.
 */
export function listIntro(input: {
  periodDays: number;
  /** Dates the listed runs cover. */
  listed?: { from: string; to: string };
}): string {
  const meaning = "On time means no more than 5 minutes late.";
  const listed = input.listed;
  if (
    listed &&
    listed.from > addCalendarDays(listed.to, 1 - input.periodDays)
  ) {
    return `Arrivals since ${formatDate(listed.from)}, the first day recorded. ${meaning}`;
  }
  return meaning;
}

/**
 * The list's line once HSP has stopped trying and some listed trains still have no older
 * journeys. Their figures are Darwin's alone, from `since`. Empty when nothing is missing.
 */
export function olderJourneysNote(input: {
  missing: number;
  listed: number;
  /** First day of the figures the missing trains still have, YYYY-MM-DD. */
  since?: string;
}): string {
  if (input.missing === 0) {
    return "";
  }
  const range = input.since
    ? `journeys since ${formatDate(input.since)}`
    : "recent journeys";
  const retry = "Reload later to try again.";
  if (input.missing >= input.listed) {
    return `Older journeys could not be loaded because the data provider is busy, so these figures count only ${range}. ${retry}`;
  }
  return `Older journeys could not be loaded for ${input.missing} of these ${input.listed} trains because the data provider is busy. Their figures count only ${range}. ${retry}`;
}

/** The note on a listed train whose older journeys did not load. */
export function olderJourneysRowNote(since?: string): string {
  return since
    ? `Only journeys since ${formatDate(since)}`
    : "Older journeys not loaded";
}

export function formatClock(hhmm: string): string {
  return `${hhmm.slice(0, 2)}:${hhmm.slice(2, 4)}`;
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
