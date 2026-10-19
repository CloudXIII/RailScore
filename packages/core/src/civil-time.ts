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
  if (!/^\d{4}$/.test(hhmm)) {
    throw new Error(`Expected an HHMM clock time, received "${hhmm}".`);
  }
  const hours = Number(hhmm.slice(0, 2));
  const minutes = Number(hhmm.slice(2, 4));
  if (hours > 23 || minutes > 59) {
    throw new Error(`Expected a valid clock time, received "${hhmm}".`);
  }
  return hours * 60 + minutes;
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
  if (!/^\d{4}$/.test(hhmm)) {
    return Number.NaN;
  }
  const hours = Number(hhmm.slice(0, 2));
  const minutes = Number(hhmm.slice(2, 4));
  if (hours > 23 || minutes > 59) {
    return Number.NaN;
  }
  return hours * 60 + minutes;
}
