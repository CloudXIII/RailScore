import { describe, expect, it } from "vitest";
import type { HistoricalRun } from "@railscore/core";
import {
  historyFigures,
  listPunctuality,
  shownPeriod,
  type TrainEarlierDays,
} from "./earlier-days-figures";

const NO_RUNS = { runs: 0, within5: 0, within14: 0, within29: 0, arrived: 0 };

const earlierDays: TrainEarlierDays = {
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
        { runs: 3, within5: 1, within14: 2, within29: 3, arrived: 3 },
        earlierDays,
      ),
    ).toEqual({
      runs: 15,
      within5: 9,
      within14: 12,
      within29: 14,
      arrived: 14,
    });
  });

  it("keeps Darwin's alone before HSP answers, and HSP's alone without Darwin", () => {
    const darwin = {
      runs: 3,
      within5: 1,
      within14: 2,
      within29: 3,
      arrived: 3,
    };
    expect(listPunctuality(darwin, undefined)).toBe(darwin);
    expect(listPunctuality(undefined, earlierDays)).toEqual({
      runs: 12,
      within5: 8,
      within14: 10,
      within29: 11,
      arrived: 11,
    });
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
      earlierDays,
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

  it("gives the same figures from the counts as one run per counted run would", () => {
    const figures = historyFigures({
      darwinRuns: [],
      earlierDays,
      hspRuns: [],
    });
    expect(figures.complete).toBe(false);
    expect(figures.result.status).toBe("ok");
    expect(figures.result.withinFiveMinutes).toEqual({
      count: 8,
      total: 12,
      percentage: 67,
    });
    expect(figures.result.distribution).toEqual({
      withinFive: 8,
      sixToFourteen: 2,
      fifteenToTwentyNine: 1,
      thirtyOrMore: 0,
      cancelled: 1,
    });
    expect(figures.result.calendar).toEqual([]);
  });

  it("never counts a band below zero when HSP's counts do not nest", () => {
    const figures = historyFigures({
      darwinRuns: [],
      earlierDays: {
        byDay: {
          weekdays: {
            runs: 3,
            within5: 2,
            within14: 1,
            within29: 1,
            arrived: 3,
          },
        },
        runCount: 3,
      },
      hspRuns: [],
    });
    expect(figures.result.distribution).toEqual({
      withinFive: 2,
      sixToFourteen: 0,
      fifteenToTwentyNine: 0,
      thirtyOrMore: 2,
      cancelled: 0,
    });
    expect(figures.result.withinFiveMinutes.total).toBe(4);
  });

  it("uses the runs alone once every HSP run is in", () => {
    const figures = historyFigures({
      darwinRuns,
      earlierDays: { ...earlierDays, runCount: 1 },
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
  const noRecord: TrainEarlierDays = {
    byDay: { weekdays: NO_RUNS },
    runCount: 0,
  };

  it("keeps the whole period when HSP has the train's runs", () => {
    expect(shownPeriod({ period, hsp, earlierDays, missing: false })).toEqual({
      period,
    });
  });

  it("starts on Darwin's first day, with a note, when HSP has no record of the train", () => {
    expect(
      shownPeriod({ period, hsp, earlierDays: noRecord, missing: false }),
    ).toEqual({
      period: { from: "2026-11-04", to: "2026-11-04" },
      note: "There is no record of this train before 04/11/2026, so its history starts then.",
    });
  });

  it("leaves out the days before Darwin when HSP gave no answer", () => {
    expect(
      shownPeriod({ period, hsp, earlierDays: undefined, missing: true }),
    ).toEqual({ period: { from: "2026-11-04", to: "2026-11-04" } });
  });

  it("keeps the period while HSP is still asked, and without HSP", () => {
    expect(
      shownPeriod({ period, hsp, earlierDays: undefined, missing: false }),
    ).toEqual({ period });
    expect(
      shownPeriod({
        period,
        hsp: undefined,
        earlierDays: noRecord,
        missing: false,
      }),
    ).toEqual({ period });
  });
});
