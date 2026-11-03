import { resolveStation, type Station } from "./stations";

export type DayPattern = "weekdays" | "saturday" | "sunday" | "all";

/** Days of history. Neon Free (0.5 GB) holds about 30 days of Darwin runs. */
export const PERIOD_LENGTHS = [30] as const;
export type PeriodLength = (typeof PERIOD_LENGTHS)[number];

export type ParsedQuery = {
  fromText: string;
  toText: string;
  time: string;
  days: DayPattern;
  period: PeriodLength;
  from?: Station;
  to?: Station;
  serviceKey?: string;
  calculate: boolean;
  errors: string[];
};

const DAYS: readonly DayPattern[] = ["weekdays", "saturday", "sunday", "all"];

export function parseQuery(
  params: Record<string, string | string[] | undefined>,
  stations: readonly Station[],
): ParsedQuery {
  const fromText = single(params.from);
  const toText = single(params.to);
  const time = single(params.time) || "06:30";
  const daysValue = single(params.days);
  const days: DayPattern = DAYS.includes(daysValue as DayPattern)
    ? (daysValue as DayPattern)
    : "weekdays";
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
