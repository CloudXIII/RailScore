/**
 * Below this share of the trains of the day before it of the same type, the latest day is
 * taken for a reduced timetable, such as a weekend of engineering works.
 */
const REDUCED_SHARE = 0.75;

/**
 * The day whose timetable a search lists, from the latest days of its type with trains on the
 * route, newest first. The latest, unless it has under `REDUCED_SHARE` of the trains of the
 * one before it: a weekend of engineering works would otherwise list its diverted trains
 * until the next weekend of that type.
 */
export function listedTimetable<Day>(
  days: readonly Day[],
  trainsOf: (day: Day) => number,
): Day | undefined {
  const [latest, before] = days;
  if (!latest || !before) {
    return latest;
  }
  return trainsOf(latest) < REDUCED_SHARE * trainsOf(before) ? before : latest;
}
