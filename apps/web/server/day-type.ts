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
