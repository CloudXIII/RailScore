import { describe, expect, it } from "vitest";
import { calculateReliability, type HistoricalRun } from "./reliability";
import { NO_RUNS, sumTallies } from "./tally";

const tally = { runs: 10, within5: 6, within14: 8, within29: 9, arrived: 9 };

describe("sumTallies", () => {
  it("adds every field, a missing tally adding nothing", () => {
    expect(sumTallies([tally, undefined, tally])).toEqual({
      runs: 20,
      within5: 12,
      within14: 16,
      within29: 18,
      arrived: 18,
    });
    expect(sumTallies([])).toEqual(NO_RUNS);
  });
});

describe("calculateReliability with tallies", () => {
  const dated: HistoricalRun = {
    id: "a",
    serviceDate: "2026-11-04",
    outcome: "arrived",
    latenessMinutes: 40,
  };

  it("puts counted runs in the totals and bands, and off the calendar", () => {
    const result = calculateReliability([dated], [tally]);
    expect(result.withinFiveMinutes).toEqual({
      count: 6,
      total: 11,
      percentage: 55,
    });
    expect(result.distribution).toEqual({
      withinFive: 6,
      sixToFourteen: 2,
      fifteenToTwentyNine: 1,
      thirtyOrMore: 1,
      cancelled: 1,
    });
    expect(result.calendar.map((mark) => mark.serviceDate)).toEqual([
      "2026-11-04",
    ]);
    expect(result.status).toBe("ok");
  });

  it("has a history from counts alone", () => {
    expect(calculateReliability([], [tally]).status).toBe("ok");
    expect(calculateReliability([], [NO_RUNS]).status).toBe("no_history");
  });

  it("never counts a band below zero", () => {
    const result = calculateReliability(
      [],
      [{ runs: 2, within5: 2, within14: 1, within29: 1, arrived: 1 }],
    );
    expect(result.distribution).toEqual({
      withinFive: 2,
      sixToFourteen: 0,
      fifteenToTwentyNine: 0,
      thirtyOrMore: 0,
      cancelled: 1,
    });
  });
});
