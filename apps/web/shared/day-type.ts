/** Day types a train runs on, in the order the page lists them. */
export const DAY_TYPES = ["weekdays", "saturday", "sunday"] as const;

export type ServiceDay = (typeof DAY_TYPES)[number];

/** What a search asks for: one day type, or all of them. */
const DAY_PATTERNS = [...DAY_TYPES, "all"] as const;

export type DayPattern = (typeof DAY_PATTERNS)[number];

export function isDayPattern(value: unknown): value is DayPattern {
  return (DAY_PATTERNS as readonly unknown[]).includes(value);
}

/** The day types a search covers. */
export function dayTypesOf(pattern: DayPattern): readonly ServiceDay[] {
  return pattern === "all" ? DAY_TYPES : [pattern];
}

/** Day types in list order, each once. */
export function orderedDays(days: readonly ServiceDay[]): ServiceDay[] {
  const present = new Set(days);
  return DAY_TYPES.filter((day) => present.has(day));
}

/** Day type of a YYYY-MM-DD date, read as written rather than shifted by a timezone. */
export function dayTypeOf(iso: string): ServiceDay | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) {
    return undefined;
  }
  const weekday = new Date(
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])),
  ).getUTCDay();
  if (weekday === 6) {
    return "saturday";
  }
  return weekday === 0 ? "sunday" : "weekdays";
}

/**
 * The day type of the night after a day of this pattern: Saturday night runs into Sunday,
 * Sunday night into a weekday. A weekday night is taken to run into another weekday, as four
 * in five do; Friday night's trains after midnight are Saturday's, at the top of its list.
 */
export function nightAfter(pattern: DayPattern): DayPattern {
  switch (pattern) {
    case "saturday":
      return "sunday";
    case "sunday":
      return "weekdays";
    default:
      return pattern;
  }
}

/**
 * The day types a listed train is counted on, when they are not the searched ones: a train
 * after midnight from the next day's list, such as a Sunday train in a Saturday list.
 * Undefined when the train is counted on the searched days.
 */
export function ownDays(
  days: readonly ServiceDay[],
  searched: DayPattern,
): ServiceDay[] | undefined {
  if (searched === "all" || days.length === 0 || days.includes(searched)) {
    return undefined;
  }
  return orderedDays(days);
}
