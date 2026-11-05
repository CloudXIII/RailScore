import { isDayPattern, type DayPattern } from "@/shared/day-type";
import {
  PERIOD_LENGTHS,
  type ParsedQuery,
  type PeriodLength,
} from "@/shared/search-query";
import { resolveStation, type Station } from "@/shared/stations";

export function parseQuery(
  params: Record<string, string | string[] | undefined>,
  stations: readonly Station[],
): ParsedQuery {
  const fromText = single(params.from);
  const toText = single(params.to);
  const time = single(params.time) || "06:30";
  const daysValue = single(params.days);
  const days: DayPattern = isDayPattern(daysValue) ? daysValue : "weekdays";
  const period = parsePeriod(single(params.period));
  const serviceKey = single(params.service);
  const calculate = single(params.calculate) === "1";
  const errors: string[] = [];
  const submitted = fromText.length > 0 || toText.length > 0;

  let from: Station | undefined;
  let to: Station | undefined;
  if (submitted) {
    from = resolveStation(fromText, stations);
    to = resolveStation(toText, stations);
    if (!from) {
      errors.push("Choose a departure station from the list.");
    }
    if (!to) {
      errors.push("Choose a destination station from the list.");
    }
    if (from && to && from.crs === to.crs) {
      errors.push("Departure and destination must be different stations.");
    }
    if (!validClock(time)) {
      errors.push("Enter a departure time.");
    }
  }

  return {
    fromText,
    toText,
    time,
    days,
    period,
    from,
    to,
    serviceKey: serviceKey || undefined,
    calculate: calculate && errors.length === 0,
    errors,
  };
}

export function timeHhmm(time: string): string {
  return time.replace(":", "");
}

function parsePeriod(value: string): PeriodLength {
  const parsed = Number(value);
  return PERIOD_LENGTHS.includes(parsed as PeriodLength)
    ? (parsed as PeriodLength)
    : 30;
}

function validClock(time: string): boolean {
  const match = /^(\d{2}):(\d{2})$/.exec(time);
  if (!match) {
    return false;
  }
  return Number(match[1]) <= 23 && Number(match[2]) <= 59;
}

function single(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}
