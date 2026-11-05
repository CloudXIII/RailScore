import { beforeEach, describe, expect, it } from "vitest";
import { calculateService } from "./calculate-reliability";
import type { DarwinRun } from "./darwin/run";
import type { ScheduledService } from "./services/fold";

const NOW = new Date("2026-11-04T12:00:00Z");

function run(rid: string, date: string, actualArrival: string): DarwinRun {
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

describe("calculateService", () => {
  beforeEach(() => {
    delete process.env.RAILSCORE_DATA;
  });

  it("classifies the runs its search read and counts a RID with none as no data", () => {
    const runs = new Map([
      ["202611020000001", run("202611020000001", "2026-11-02", "0722")],
    ]);

    const { result } = calculateService({
      service,
      ...stations,
      runs,
      now: NOW,
    });

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
      ["202611040000003", run("202611040000003", "2026-11-04", "0750")],
    ]);

    const { result } = calculateService({
      service,
      ...stations,
      runs,
      now: NOW,
    });

    expect(result.withinFiveMinutes.total).toBe(0);
  });
});
