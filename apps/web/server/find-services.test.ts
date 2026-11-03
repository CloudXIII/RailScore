import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DarwinRun } from "./darwin/run";
import {
  oldestRunDate,
  runsOfTrains,
  runsOnDay,
  timetableDate,
} from "./darwin/store";
import { database } from "./db";
import { findServices } from "./find-services";

vi.mock("./db", () => ({ database: vi.fn() }));
vi.mock("./darwin/store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./darwin/store")>()),
  oldestRunDate: vi.fn(),
  runsOfTrains: vi.fn(),
  runsOnDay: vi.fn(),
  timetableDate: vi.fn(),
}));

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

describe("findServices", () => {
  beforeEach(() => {
    delete process.env.RAILSCORE_DATA;
    vi.mocked(database).mockReset();
    vi.mocked(oldestRunDate).mockReset();
    vi.mocked(runsOfTrains).mockReset();
    vi.mocked(runsOnDay).mockReset();
    vi.mocked(timetableDate).mockReset();
  });

  it("lists sample trains in mock mode without the database", async () => {
    process.env.RAILSCORE_DATA = "mock";

    const found = await findServices(search);

    expect(found.services.length).toBeGreaterThan(0);
    expect(database).not.toHaveBeenCalled();
  });

  it("lists nothing without a database", async () => {
    vi.mocked(database).mockReturnValue(undefined);

    const found = await findServices(search);

    expect(found).toEqual({
      services: [],
      retired: [],
      period: { from: "2026-10-05", to: "2026-11-03" },
      runs: new Map(),
    });
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

    const found = await findServices(search);

    expect(found.period).toEqual({ from: "2026-11-02", to: "2026-11-03" });
    expect(found.services).toHaveLength(1);
    expect(found.services[0]).toMatchObject({
      publicDeparture: "0812",
      rids: ["202611020000001", "202611030000002"],
      punctuality: { runs: 2, within5: 1, within14: 1, within29: 2 },
    });
    expect([...found.runs.keys()].sort()).toEqual([
      "202611020000001",
      "202611030000002",
      "202611040000003",
    ]);
  });

  it("lists nothing when no timetable day has a train on the route", async () => {
    vi.mocked(database).mockReturnValue({} as ReturnType<typeof database>);
    vi.mocked(oldestRunDate).mockResolvedValue("2026-10-01");
    vi.mocked(timetableDate).mockResolvedValue("2026-11-04");
    vi.mocked(runsOnDay).mockResolvedValue([]);

    const found = await findServices(search);

    expect(found.services).toEqual([]);
    expect(found.period).toEqual({ from: "2026-10-05", to: "2026-11-03" });
    expect(runsOfTrains).not.toHaveBeenCalled();
  });
});
