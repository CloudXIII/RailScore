import { clockMinutes } from "./civil-time";

const LONDON = "Europe/London";

/** Trailing London calendar dates, ending on the last complete day. `length` includes that day. */
export function trailingDays(
  length: number,
  now: Date,
): { from: string; to: string } {
  const today = londonIsoDate(now);
  const to = addCalendarDays(today, -1);
  const from = addCalendarDays(to, -(length - 1));
  return { from, to };
}

/**
 * Departing after 07:00 is 07:00–07:59: the chosen minute and the 59 that follow.
 * HSP takes about as long per clock minute whatever the period, so the hour is what a search costs.
 */
export const DEPARTURE_WINDOW_MINUTES = 60;

/**
 * Inclusive clock span a departing-after search covers.
 * 07:00 is 07:00–07:59. A window that crosses midnight stays one span, 23:30–00:29.
 */
export function searchClockRange(timeHhmm: string): {
  from: string;
  to: string;
} {
  const minute = clockMinutes(timeHhmm);
  const to = (minute + DEPARTURE_WINDOW_MINUTES - 1) % (24 * 60);
  return { from: formatClock(minute), to: formatClock(to) };
}

/**
 * HSP day windows for a departing-after search. Both ends are inclusive.
 * 07:00 is 0700–0759. A window that crosses midnight is two same-day ranges,
 * and 23:00 stays 2300–2359: 00:00 belongs to the next search.
 */
export function departureWindows(
  timeHhmm: string,
): Array<{ fromTime: string; toTime: string }> {
  const start = clockMinutes(timeHhmm);
  return inclusiveClockWindows(start, start + DEPARTURE_WINDOW_MINUTES);
}

/**
 * Clock quarter-hours HSP is asked for one at a time. On a busy route an hour
 * takes HSP longer than its own gateway allows, and a quarter-hour stays well under it.
 */
const SLICE_MINUTES = 15;

/**
 * `departureWindows` cut at each clock quarter-hour, so searches that start at
 * different minutes share the same slices. 07:10 is 0710–0714, 0715–0729, …, 0800–0809.
 */
export function departureSlices(
  timeHhmm: string,
): Array<{ fromTime: string; toTime: string }> {
  const start = clockMinutes(timeHhmm);
  const end = start + DEPARTURE_WINDOW_MINUTES;
  const day = 24 * 60;
  const slices: Array<{ fromTime: string; toTime: string }> = [];
  for (let from = start; from < end;) {
    const boundary = (Math.floor(from / SLICE_MINUTES) + 1) * SLICE_MINUTES;
    const to = Math.min(boundary, end);
    slices.push({
      fromTime: formatClock(from % day),
      toTime: formatClock((to - 1) % day),
    });
    from = to;
  }
  return slices;
}

/** `endExclusive` is the first minute that is outside the window. */
function inclusiveClockWindows(
  startInclusive: number,
  endExclusive: number,
): Array<{ fromTime: string; toTime: string }> {
  const day = 24 * 60;
  if (endExclusive <= day) {
    return [
      {
        fromTime: formatClock(startInclusive),
        toTime: formatClock(endExclusive - 1),
      },
    ];
  }
  return [
    { fromTime: formatClock(startInclusive), toTime: "2359" },
    { fromTime: "0000", toTime: formatClock(endExclusive - day - 1) },
  ];
}

export function londonIsoDate(now: Date): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: LONDON,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  if (!year || !month || !day) {
    throw new Error("Could not read the London calendar date.");
  }
  return `${year}-${month}-${day}`;
}

export function addCalendarDays(isoDate: string, days: number): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!match) {
    throw new Error(`Expected a YYYY-MM-DD date, received "${isoDate}".`);
  }
  const utc = new Date(
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])),
  );
  utc.setUTCDate(utc.getUTCDate() + days);
  return utc.toISOString().slice(0, 10);
}

function formatClock(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${String(hours).padStart(2, "0")}${String(mins).padStart(2, "0")}`;
}
