import type { ServiceDay } from "./hsp/map";

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
