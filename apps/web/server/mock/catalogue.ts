import type { HistoricalRun } from "@railscore/core";
import {
  serviceKey,
  type ScheduledService,
  type ServiceDay,
} from "@/server/hsp/map";
import type { DayPattern } from "@/server/query";
import type { Station } from "@/server/stations";

type MockProfile = "reliable" | "poor" | "sparse" | "partial" | "empty";

const OPERATORS = ["AW", "NT", "XC", "VT"] as const;

const MOCK_STATIONS: readonly Station[] = [
  { crs: "EUS", name: "London Euston" },
  { crs: "LDS", name: "Leeds" },
  { crs: "MAN", name: "Manchester Piccadilly" },
  { crs: "YRK", name: "York" },
];

const DAY_OFFSETS: Record<DayPattern, readonly number[]> = {
  weekdays: [0, 12, 24, 40, 55],
  saturday: [6, 28, 48],
  sunday: [8, 36],
  all: [0, 12, 24, 40, 55],
};

const PROFILES: readonly MockProfile[] = [
  "reliable",
  "poor",
  "sparse",
  "partial",
  "empty",
];

const PLANS = {
  reliable: { onTime: 32, late: 4, cancelled: 1, missing: 0 },
  poor: { onTime: 12, late: 18, cancelled: 8, missing: 0 },
  sparse: { onTime: 5, late: 1, cancelled: 2, missing: 0 },
  partial: { onTime: 18, late: 6, cancelled: 3, missing: 6 },
} as const;

/**
 * Stand-in services for the live search window. Departing after 07:00 is 07:00–07:59.
 * Figures are not from any feed.
 */
export function mockServices(input: {
  fromCrs: string;
  toCrs: string;
  timeHhmm: string;
  days: DayPattern;
}): ScheduledService[] {
  const journey = 40 + (hash(`${input.fromCrs}${input.toCrs}`) % 100);
  const days: ServiceDay[] =
    input.days === "all" ? ["weekdays", "saturday", "sunday"] : [input.days];
  return DAY_OFFSETS[input.days]
    .map((offset, index) => {
      const profile = PROFILES[index] ?? "reliable";
      const through = index === 1;
      const times = {
        publicDeparture: shiftClock(input.timeHhmm, offset),
        publicArrival: shiftClock(input.timeHhmm, offset + journey),
      };
      const service = {
        originCrs: through
          ? otherStation(input.fromCrs, input.toCrs)
          : input.fromCrs,
        destinationCrs: through
          ? otherStation(input.toCrs, input.fromCrs)
          : input.toCrs,
        ...times,
        operatorCode: OPERATORS[index % OPERATORS.length] ?? "AW",
      };
      return {
        ...service,
        rids: mockRunIds(profile, serviceKey(service)),
        days,
      };
    })
    .sort((left, right) =>
      left.publicDeparture.localeCompare(right.publicDeparture),
    );
}

export function mockRuns(service: ScheduledService): HistoricalRun[] {
  const profile = readProfile(service);
  if (profile === "empty") {
    return [];
  }
  const plan = PLANS[profile];
  const expected = plan.onTime + plan.late + plan.cancelled + plan.missing;
  if (service.rids.length !== expected) {
    throw new Error(
      `Sample service has ${service.rids.length} runs; ${profile} expects ${expected}.`,
    );
  }
  const runs: HistoricalRun[] = [];
  let index = 0;
  for (let count = 0; count < plan.onTime; count += 1) {
    runs.push({
      id: service.rids[index] ?? "",
      outcome: "arrived",
      latenessMinutes: count === 0 ? -3 : count % 5,
    });
    index += 1;
  }
  for (let count = 0; count < plan.late; count += 1) {
    runs.push({
      id: service.rids[index] ?? "",
      outcome: "arrived",
      latenessMinutes: 8 + count * 3,
    });
    index += 1;
  }
  for (let count = 0; count < plan.cancelled; count += 1) {
    runs.push({ id: service.rids[index] ?? "", outcome: "cancelled" });
    index += 1;
  }
  for (let count = 0; count < plan.missing; count += 1) {
    runs.push({ id: service.rids[index] ?? "", outcome: "missing_actual" });
    index += 1;
  }
  return runs;
}

function mockRunIds(profile: MockProfile, key: string): string[] {
  if (profile === "empty") {
    return [];
  }
  const plan = PLANS[profile];
  const count = plan.onTime + plan.late + plan.cancelled + plan.missing;
  return Array.from(
    { length: count },
    (_, index) => `mock:${profile}:${key}:${index}`,
  );
}

function readProfile(service: ScheduledService): MockProfile {
  const match = /^mock:(reliable|poor|sparse|partial):/.exec(
    service.rids[0] ?? "",
  );
  if (!match) {
    throw new Error("Sample service is missing its scenario.");
  }
  return match[1] as Exclude<MockProfile, "empty">;
}

function otherStation(primary: string, alsoAvoid: string): string {
  const stations = MOCK_STATIONS;
  const start = Math.max(
    stations.findIndex((station) => station.crs === primary),
    0,
  );
  for (let step = 1; step <= stations.length; step += 1) {
    const candidate = stations[(start + step) % stations.length];
    if (candidate && candidate.crs !== primary && candidate.crs !== alsoAvoid) {
      return candidate.crs;
    }
  }
  return primary;
}

function shiftClock(hhmm: string, deltaMinutes: number): string {
  const wrapped = (clockMinutes(hhmm) + deltaMinutes) % (24 * 60);
  const minutes = wrapped < 0 ? wrapped + 24 * 60 : wrapped;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${String(hours).padStart(2, "0")}${String(mins).padStart(2, "0")}`;
}

function clockMinutes(hhmm: string): number {
  return Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(2, 4));
}

function hash(value: string): number {
  let total = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    total ^= value.charCodeAt(index);
    total = Math.imul(total, 16777619);
  }
  return total >>> 0;
}
