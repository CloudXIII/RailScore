import { isDayPattern } from "@/shared/day-type";
import { PERIOD_LENGTHS } from "@/shared/search-query";
import { record } from "../payload";
import type { ScheduledService } from "@/shared/scheduled-service";
import { serviceKey } from "@/shared/scheduled-service";
import type { EarlierDaysRequest, EarlierDaysTrain } from "@/shared/contracts";
import { quartersOf } from "./match";

/** A page lists six trains, a few more when several leave at the same minute. */
const MAX_TRAINS = 16;
const MAX_LEGS = 8;
/** Quarter-hours one request may ask HSP about. Eight trains every half hour need eight. */
const MAX_QUARTERS = 16;

/** What the page sends for its trains: each train with the schedules folded into it. */
export function earlierDaysTrain(service: ScheduledService): EarlierDaysTrain {
  return {
    key: serviceKey(service),
    operatorCode: service.operatorCode,
    legs: [service, ...(service.variants ?? [])].map((leg) => ({
      originCrs: leg.originCrs,
      destinationCrs: leg.destinationCrs,
      publicDeparture: leg.publicDeparture,
      publicArrival: leg.publicArrival,
    })),
  };
}

/** The request body, checked. Undefined when anything is out of shape or too large. */
export function parseEarlierDaysQuery(
  value: unknown,
): EarlierDaysRequest | undefined {
  const body = record(value);
  if (!body) {
    return undefined;
  }
  const { fromCrs, toCrs, days, periodDays, runsOf } = body;
  if (
    !isCrs(fromCrs) ||
    !isCrs(toCrs) ||
    !isDayPattern(days) ||
    !PERIOD_LENGTHS.includes(periodDays as (typeof PERIOD_LENGTHS)[number]) ||
    !Array.isArray(body.trains) ||
    body.trains.length === 0 ||
    body.trains.length > MAX_TRAINS ||
    (runsOf !== undefined && typeof runsOf !== "string")
  ) {
    return undefined;
  }
  const trains = body.trains.map(parseTrain);
  if (trains.some((train) => train === undefined)) {
    return undefined;
  }
  const checked = trains as EarlierDaysTrain[];
  if (quartersOf(checked).length > MAX_QUARTERS) {
    return undefined;
  }
  return {
    fromCrs,
    toCrs,
    days,
    periodDays: periodDays as number,
    trains: checked,
    ...(typeof runsOf === "string" ? { runsOf } : {}),
  };
}

function parseTrain(value: unknown): EarlierDaysTrain | undefined {
  const train = record(value);
  if (
    !train ||
    typeof train.key !== "string" ||
    train.key.length > 80 ||
    typeof train.operatorCode !== "string" ||
    !/^[A-Z0-9]{2}$/.test(train.operatorCode) ||
    !Array.isArray(train.legs) ||
    train.legs.length === 0 ||
    train.legs.length > MAX_LEGS
  ) {
    return undefined;
  }
  const legs = train.legs.map((leg) => {
    const fields = record(leg);
    return fields &&
      isCrs(fields.originCrs) &&
      isCrs(fields.destinationCrs) &&
      isClock(fields.publicDeparture) &&
      (fields.publicArrival === undefined || isClock(fields.publicArrival))
      ? {
          originCrs: fields.originCrs,
          destinationCrs: fields.destinationCrs,
          publicDeparture: fields.publicDeparture,
          ...(fields.publicArrival === undefined
            ? {}
            : { publicArrival: fields.publicArrival }),
        }
      : undefined;
  });
  if (legs.some((leg) => leg === undefined)) {
    return undefined;
  }
  return {
    key: train.key,
    operatorCode: train.operatorCode,
    legs: legs as EarlierDaysTrain["legs"],
  };
}

function isCrs(value: unknown): value is string {
  return typeof value === "string" && /^[A-Z]{3}$/.test(value);
}

function isClock(value: unknown): value is string {
  return typeof value === "string" && /^([01]\d|2[0-3])[0-5]\d$/.test(value);
}
