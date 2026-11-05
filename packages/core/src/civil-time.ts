const MINUTES_IN_DAY = 24 * 60;
const HALF_DAY = 12 * 60;

/**
 * Signed whole minutes of arrival lateness from Europe/London civil clock times.
 * Early is negative. An arrival just after midnight, scheduled just before it,
 * is wrapped forward. A gap longer than 12 hours stays late: folding it the
 * other way would count a long delay as on time.
 */
export function signedLatenessMinutes(
  scheduledHhmm: string,
  actualHhmm: string,
): number {
  const difference = clockMinutes(actualHhmm) - clockMinutes(scheduledHhmm);
  if (difference < -HALF_DAY) {
    return difference + MINUTES_IN_DAY;
  }
  return difference;
}

/** Whole minutes from midnight. Rejects anything that is not a valid HHMM. */
export function clockMinutes(hhmm: string): number {
  const minutes = parseClock(hhmm);
  if (minutes === undefined) {
    throw new Error(`Expected a valid HHMM clock time, received "${hhmm}".`);
  }
  return minutes;
}

/** Minutes from midnight as HHMM, wrapped into the day: 1450 is "0010", -10 is "2350". */
export function formatHhmm(minutes: number): string {
  const wrapped =
    ((minutes % MINUTES_IN_DAY) + MINUTES_IN_DAY) % MINUTES_IN_DAY;
  const hours = Math.floor(wrapped / 60);
  return `${String(hours).padStart(2, "0")}${String(wrapped % 60).padStart(2, "0")}`;
}

/** Shorter gap between two clock times, so 23:59 and 00:01 are 2 minutes apart. */
export function minutesApart(left: string, right: string): number {
  const difference = Math.abs(
    clockMinutesOrNaN(left) - clockMinutesOrNaN(right),
  );
  return Math.min(difference, MINUTES_IN_DAY - difference);
}

/**
 * Journey length. An arrival before its departure is treated as crossing midnight.
 * An unreadable clock is `NaN`, so one bad time does not fail the list around it.
 */
export function journeyMinutes(departure: string, arrival: string): number {
  return (
    (clockMinutesOrNaN(arrival) -
      clockMinutesOrNaN(departure) +
      MINUTES_IN_DAY) %
    MINUTES_IN_DAY
  );
}

function clockMinutesOrNaN(hhmm: string): number {
  return parseClock(hhmm) ?? Number.NaN;
}

function parseClock(hhmm: string): number | undefined {
  if (!/^\d{4}$/.test(hhmm)) {
    return undefined;
  }
  const hours = Number(hhmm.slice(0, 2));
  const minutes = Number(hhmm.slice(2, 4));
  if (hours > 23 || minutes > 59) {
    return undefined;
  }
  return hours * 60 + minutes;
}
