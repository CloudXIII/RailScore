import { describe, expect, it } from "vitest";
import type { HistoricalRun } from "@railscore/core";
import {
  historyFigures,
  listPunctuality,
  runsFromCounts,
  shownPeriod,
  type TrainBacklog,
} from "./backlog-figures";

const NO_RUNS = { runs: 0, within5: 0, within14: 0, within29: 0, arrived: 0 };

const backlog: TrainBacklog = {
  byDay: {
    weekdays: { runs: 10, within5: 6, within14: 8, within29: 9, arrived: 9 },
    saturday: { runs: 2, within5: 2, within14: 2, within29: 2, arrived: 2 },
  },
  runCount: 12,
};

describe("listPunctuality", () => {
  it("adds HSP's counts to Darwin's", () => {
    expect(
      listPunctuality(
        { runs: 3, within5: 1, within14: 2, within29: 3 },
        backlog,
      ),
    ).toEqual({ runs: 15, within5: 9, within14: 12, within29: 14 });
  });

  it("keeps Darwin's alone before HSP answers, and HSP's alone without Darwin", () => {
    const darwin = { runs: 3, within5: 1, within14: 2, within29: 3 };
    expect(listPunctuality(darwin, undefined)).toBe(darwin);
    expect(listPunctuality(undefined, backlog)).toEqual({
      runs: 12,
      within5: 8,
      within14: 10,
      within29: 11,
    });
  });
});

describe("runsFromCounts", () => {
  it("stands one run in for each counted run, in its band", () => {
    const runs = runsFromCounts(backlog.byDay);
    expect(runs).toHaveLength(12);
    const outcomes = runs.map((run) =>
      run.outcome === "arrived" ? run.latenessMinutes : run.outcome,
    );
    expect(outcomes.filter((value) => value === 0)).toHaveLength(8);
    expect(outcomes.filter((value) => value === 10)).toHaveLength(2);
    expect(outcomes.filter((value) => value === 20)).toHaveLength(1);
    expect(outcomes.filter((value) => value === "cancelled")).toHaveLength(1);
  });
});

describe("historyFigures", () => {
  const darwinRuns: HistoricalRun[] = [
    {
      id: "d1",
      serviceDate: "2026-11-04",
      outcome: "arrived",
      latenessMinutes: 2,
    },
  ];
  const hspRun: HistoricalRun = {
    id: "h1",
    serviceDate: "2026-10-20",
    outcome: "arrived",
    latenessMinutes: 40,
  };

  it("uses HSP's counts for the figures and fetched runs for the calendar while runs arrive", () => {
    const figures = historyFigures({
      darwinRuns,
      backlog,
      hspRuns: [hspRun],
    });
    expect(figures.complete).toBe(false);
    expect(figures.result.withinFiveMinutes).toMatchObject({
      count: 9,
      total: 13,
    });
    expect(figures.result.distribution).toEqual({
      withinFive: 9,
      sixToFourteen: 2,
      fifteenToTwentyNine: 1,
      thirtyOrMore: 0,
      cancelled: 1,
    });
    expect(figures.result.calendar.map((mark) => mark.serviceDate)).toEqual([
      "2026-10-20",
      "2026-11-04",
    ]);
  });

  it("uses the runs alone once every HSP run is in", () => {
    const figures = historyFigures({
      darwinRuns,
      backlog: { ...backlog, runCount: 1 },
      hspRuns: [hspRun],
    });
    expect(figures.complete).toBe(true);
    expect(figures.result.withinFiveMinutes).toMatchObject({
      count: 1,
      total: 2,
    });
    expect(figures.result.distribution.thirtyOrMore).toBe(1);
  });
});

describe("shownPeriod", () => {
  const period = { from: "2026-10-06", to: "2026-11-04" };
  const hsp = { from: "2026-10-06", to: "2026-11-03" };
  const noRecord: TrainBacklog = { byDay: { weekdays: NO_RUNS }, runCount: 0 };

  it("keeps the whole period when HSP has the train's runs", () => {
    expect(shownPeriod({ period, hsp, backlog, missing: false })).toEqual({
      period,
    });
  });

  it("starts on Darwin's first day, with a note, when HSP has no record of the train", () => {
    expect(
      shownPeriod({ period, hsp, backlog: noRecord, missing: false }),
    ).toEqual({
      period: { from: "2026-11-04", to: "2026-11-04" },
      note: "There is no record of this train before 04/11/2026, so its history starts then.",
    });
  });

  it("leaves out the days before Darwin when HSP gave no answer", () => {
    expect(
      shownPeriod({ period, hsp, backlog: undefined, missing: true }),
    ).toEqual({ period: { from: "2026-11-04", to: "2026-11-04" } });
  });

  it("keeps the period while HSP is still asked, and without HSP", () => {
    expect(
      shownPeriod({ period, hsp, backlog: undefined, missing: false }),
    ).toEqual({ period });
    expect(
      shownPeriod({
        period,
        hsp: undefined,
        backlog: noRecord,
        missing: false,
      }),
    ).toEqual({ period });
  });
});
