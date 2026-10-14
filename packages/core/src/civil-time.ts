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
