import { describe, expect, it } from "vitest";
import {
  calculationPhase,
  progressMoment,
  retryDelaySeconds,
  searchPhase,
  SLOW_SOURCE_MESSAGE,
} from "./wait-phase";

describe("searchPhase", () => {
  it("names the period first, then moves on with the wait", () => {
    const at = (elapsedMs: number) =>
      searchPhase({ elapsedMs, periodDays: 90, days: "all" });

    expect(at(0)).toBe("Looking up trains from the last 90 days");
    expect(at(5_000)).toBe(
      "Checking the weekday, Saturday and Sunday timetables",
    );
    expect(at(20_000)).toBe(
      "Busy routes have many trains, so this can take a little longer",
    );
    expect(at(40_000)).toBe(SLOW_SOURCE_MESSAGE);
  });

  it("does not mention every day type for a single one", () => {
    expect(
      searchPhase({ elapsedMs: 5_000, periodDays: 30, days: "weekdays" }),
    ).toBe("Gathering every train that matches your time");
  });
});

describe("calculationPhase", () => {
  const base = { hasProvisional: false, stalled: false, periodDays: 60 };

  it("follows the journeys checked", () => {
    expect(calculationPhase(base)).toBe(
      "Fetching this train's journeys from the last 60 days",
    );
    expect(calculationPhase({ ...base, saved: 2, total: 40 })).toBe(
      "The first journeys are arriving",
    );
    expect(
      calculationPhase({ ...base, saved: 10, total: 40, hasProvisional: true }),
    ).toBe("Early figures are in. Checking the remaining journeys");
    expect(
      calculationPhase({ ...base, saved: 36, total: 40, hasProvisional: true }),
    ).toBe("Almost there, checking the last few journeys");
  });

  it("says the source is slow when the count stops moving", () => {
    expect(
      calculationPhase({ ...base, saved: 10, total: 40, stalled: true }),
    ).toBe(SLOW_SOURCE_MESSAGE);
  });
});

describe("progressMoment", () => {
  it("keeps the earlier moment while the count is unchanged", () => {
    const remembered = { saved: 12, at: 1_000 };
    expect(progressMoment(remembered, 12, 20_000)).toBe(remembered);
  });

  it("starts again when the count moves", () => {
    expect(progressMoment({ saved: 12, at: 1_000 }, 13, 20_000)).toEqual({
      saved: 13,
      at: 20_000,
    });
  });

  it("forgets a moment from an earlier visit", () => {
    expect(progressMoment({ saved: 12, at: 0 }, 12, 10 * 60 * 1000)).toEqual({
      saved: 12,
      at: 10 * 60 * 1000,
    });
  });
});

describe("retryDelaySeconds", () => {
  it("grows with each try and levels off", () => {
    expect([1, 2, 3, 5, 10].map(retryDelaySeconds)).toEqual([
      10, 15, 20, 30, 30,
    ]);
  });
});
