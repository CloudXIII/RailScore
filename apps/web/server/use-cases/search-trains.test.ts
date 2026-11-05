import { calculateReliability, type HistoricalRun } from "@railscore/core";
import { describe, expect, it, vi } from "vitest";
import { serviceKey, type ScheduledService } from "../services/fold";
import type { ServiceSearch, TrainSource } from "../train-source";
import { searchTrains, type TrainSearch } from "./search-trains";

function train(departure: string, arrival: string): ScheduledService {
  return {
    originCrs: "LDS",
    destinationCrs: "MAN",
    publicDeparture: departure,
    publicArrival: arrival,
    operatorCode: "TP",
    rids: ["202611030000001"],
    days: ["weekdays"],
  };
}

const listed = train("0805", "0908");
const retired = train("0815", "0918");
const runs: HistoricalRun[] = [
  {
    id: "202611030000001",
    serviceDate: "2026-11-03",
    outcome: "missing_actual",
  },
];

function source(found: Partial<ServiceSearch> = {}): TrainSource {
  return {
    sample: false,
    findServices: vi.fn(async () => ({
      services: [listed],
      retired: [retired],
      period: { from: "2026-10-06", to: "2026-11-04" },
      calculate: () => ({ result: calculateReliability(runs), runs }),
      ...found,
    })),
  };
}

const search: TrainSearch = {
  fromCrs: "LDS",
  toCrs: "MAN",
  timeHhmm: "0800",
  days: "weekdays",
  periodDays: 30,
  calculate: false,
};

const hsp = { from: "2026-10-06", to: "2026-11-03" };

describe("searchTrains", () => {
  it("lists the trains and asks HSP about them when Darwin does not cover the period", async () => {
    const view = await searchTrains(search, source({ hsp }));

    expect(view.services).toEqual([listed]);
    expect(view.history).toBeUndefined();
    expect(view.notice).toBeUndefined();
    expect(view.backlog?.trains.map((t) => t.key)).toEqual([
      serviceKey(listed),
    ]);
    expect(view.backlog?.runsOf).toBeUndefined();
  });

  it("asks HSP nothing once Darwin covers the period", async () => {
    const view = await searchTrains(search, source());

    expect(view.backlog).toBeUndefined();
  });

  it("shows a retired train's history and asks HSP about it first", async () => {
    const view = await searchTrains(
      { ...search, calculate: true, serviceKey: serviceKey(retired) },
      source({ hsp }),
    );

    expect(view.history?.service).toBe(retired);
    expect(view.history?.darwinRuns).toEqual(runs);
    expect(view.history?.hspDays).toEqual(hsp);
    expect(view.backlog?.trains.map((t) => t.key)).toEqual([
      serviceKey(retired),
      serviceKey(listed),
    ]);
    expect(view.backlog?.runsOf).toBe(serviceKey(retired));
  });

  it("says when no train was chosen, or the chosen one is not there", async () => {
    const none = await searchTrains({ ...search, calculate: true }, source());
    const unknown = await searchTrains(
      { ...search, calculate: true, serviceKey: "0000-0000-XX-AAA-BBB" },
      source(),
    );

    expect(none.notice).toBe("choose-train");
    expect(unknown.notice).toBe("train-not-found");
    expect(unknown.history).toBeUndefined();
  });
});
