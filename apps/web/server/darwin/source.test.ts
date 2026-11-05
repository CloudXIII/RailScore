import { beforeEach, describe, expect, it, vi } from "vitest";
import { database } from "../db";
import type { ScheduledService } from "../services/fold";
import type { DarwinRun } from "./run";
import { calculateFromDarwin, darwinSource } from "./source";
import { timetableDate } from "./import-state";
import { oldestRunDate, runsOfTrains, runsOnDay } from "./store";

vi.mock("../db", () => ({ database: vi.fn() }));
vi.mock("./store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./store")>()),
  oldestRunDate: vi.fn(),
  runsOfTrains: vi.fn(),
  runsOnDay: vi.fn(),
}));
vi.mock("./import-state", () => ({ timetableDate: vi.fn() }));

/** Wednesday 4 November 2026, after the morning timetable is read. */
const NOW = new Date("2026-11-04T12:00:00Z");

const search = {
  fromCrs: "CLJ",
  toCrs: "WAT",
  timeHhmm: "0800",
  days: "weekdays" as const,
  periodDays: 30,
  now: NOW,
};

function run(date: string, id: string, actualArrival?: string): DarwinRun {
  return {
    rid: `${date.replaceAll("-", "")}${id}`,
    serviceDate: date,
    uid: "W12345",
    toc: "SW",
    calls: [
      { crs: "CLJ", pta: "0812", ptd: "0812", atd: "0812" },
      {
        crs: "WAT",
        pta: "0823",
        ...(actualArrival ? { ata: actualArrival } : {}),
      },
    ],
  };
}

const HSP_VARIABLES = ["HSP_BASE_URL", "HSP_API_KEY", "HSP_API_KEY_HEADER"];

describe("darwinSource.findServices", () => {
  beforeEach(() => {
    process.env.DARWIN_FIRST_DAY = "2026-11-02";
    for (const name of HSP_VARIABLES) {
      delete process.env[name];
    }
    vi.mocked(database).mockReset();
    vi.mocked(oldestRunDate).mockReset();
    vi.mocked(runsOfTrains).mockReset();
    vi.mocked(runsOnDay).mockReset();
    vi.mocked(timetableDate).mockReset();
  });

  it("lists nothing without a database", async () => {
    vi.mocked(database).mockReturnValue(undefined);

    const found = await darwinSource.findServices(search);

    expect(found.services).toEqual([]);
    expect(found.retired).toEqual([]);
    expect(found.period).toEqual({ from: "2026-11-02", to: "2026-11-03" });
    expect(found.hsp).toBeUndefined();
  });

  it("leaves the days before Darwin to HSP when it is configured", async () => {
    process.env.HSP_BASE_URL = "https://hsp.test";
    process.env.HSP_API_KEY = "key";
    process.env.HSP_API_KEY_HEADER = "x-apikey";
    vi.mocked(database).mockReturnValue(undefined);

    const found = await darwinSource.findServices(search);

    expect(found.period).toEqual({ from: "2026-10-05", to: "2026-11-03" });
    expect(found.hsp).toEqual({ from: "2026-10-05", to: "2026-11-01" });
  });

  it("does not count runs before the first whole Darwin day", async () => {
    process.env.DARWIN_FIRST_DAY = "2026-11-03";
    vi.mocked(database).mockReturnValue({} as ReturnType<typeof database>);
    vi.mocked(oldestRunDate).mockResolvedValue("2026-11-02");
    vi.mocked(timetableDate).mockResolvedValue("2026-11-04");
    vi.mocked(runsOnDay).mockResolvedValue([run("2026-11-04", "0000003")]);
    vi.mocked(runsOfTrains).mockResolvedValue([
      run("2026-11-03", "0000002", "0840"),
    ]);

    const found = await darwinSource.findServices(search);

    expect(found.period).toEqual({ from: "2026-11-03", to: "2026-11-03" });
    expect(vi.mocked(runsOfTrains).mock.calls[0]?.[1]).toMatchObject({
      fromDate: "2026-11-03",
    });
    expect(found.services[0]?.rids).toEqual(["202611030000002"]);
  });

  it("lists today's trains with their past runs, from the oldest stored day", async () => {
    vi.mocked(database).mockReturnValue({} as ReturnType<typeof database>);
    vi.mocked(oldestRunDate).mockResolvedValue("2026-11-02");
    vi.mocked(timetableDate).mockResolvedValue("2026-11-04");
    vi.mocked(runsOnDay).mockResolvedValue([run("2026-11-04", "0000003")]);
    vi.mocked(runsOfTrains).mockResolvedValue([
      run("2026-11-02", "0000001", "0823"),
      run("2026-11-03", "0000002", "0840"),
      run("2026-11-04", "0000003"),
    ]);

    const found = await darwinSource.findServices(search);

    expect(found.period).toEqual({ from: "2026-11-02", to: "2026-11-03" });
    expect(found.services).toHaveLength(1);
    expect(found.services[0]).toMatchObject({
      publicDeparture: "0812",
      rids: ["202611020000001", "202611030000002"],
      punctuality: { runs: 2, within5: 1, within14: 1, within29: 2 },
    });
    // The search's runs serve the calculation: no second read.
    expect(
      found.calculate(found.services[0]!).runs.map((run) => run.outcome),
    ).toEqual(["arrived", "arrived"]);
  });

  it("lists nothing when no timetable day has a train on the route", async () => {
    vi.mocked(database).mockReturnValue({} as ReturnType<typeof database>);
    vi.mocked(oldestRunDate).mockResolvedValue("2026-10-01");
    vi.mocked(timetableDate).mockResolvedValue("2026-11-04");
    vi.mocked(runsOnDay).mockResolvedValue([]);

    const found = await darwinSource.findServices(search);

    expect(found.services).toEqual([]);
    expect(found.period).toEqual({ from: "2026-11-02", to: "2026-11-03" });
    expect(runsOfTrains).not.toHaveBeenCalled();
  });
});

function storedRun(
  rid: string,
  date: string,
  actualArrival: string,
): DarwinRun {
  return {
    rid,
    serviceDate: date,
    uid: "W12345",
    toc: "NT",
    calls: [
      { crs: "LIV", ptd: "0630", atd: "0630" },
      { crs: "MIA", pta: "0721", ata: actualArrival },
    ],
  };
}

const service: ScheduledService = {
  originCrs: "LIV",
  destinationCrs: "MIA",
  publicDeparture: "0630",
  publicArrival: "0721",
  operatorCode: "NT",
  rids: ["202611020000001", "202611030000002", "202611040000003"],
  days: ["weekdays"],
};

const stations = { boardingCrs: "LIV", destinationCrs: "MIA" };

describe("calculateFromDarwin", () => {
  it("classifies the runs its search read and counts a RID with none as no data", () => {
    const runs = new Map([
      ["202611020000001", storedRun("202611020000001", "2026-11-02", "0722")],
    ]);

    const { result } = calculateFromDarwin(service, stations, runs, NOW);

    expect(result.withinFiveMinutes).toEqual({
      count: 1,
      total: 1,
      percentage: 100,
    });
    expect(result.calendar.map((mark) => mark.kind)).toEqual([
      "on_time",
      "no_data",
      "no_data",
    ]);
  });

  it("leaves today's run out, since it may still be under way", () => {
    const runs = new Map([
      ["202611040000003", storedRun("202611040000003", "2026-11-04", "0750")],
    ]);

    const { result } = calculateFromDarwin(service, stations, runs, NOW);

    expect(result.withinFiveMinutes.total).toBe(0);
  });
});
