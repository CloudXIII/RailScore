import { describe, expect, it } from "vitest";
import {
  formatHhmm,
  journeyMinutes,
  minutesApart,
  signedLatenessMinutes,
} from "./civil-time";
import { calculateReliability, type HistoricalRun } from "./reliability";

function arrived(id: string, latenessMinutes: number): HistoricalRun {
  return { id, outcome: "arrived", latenessMinutes };
}

describe("calculateReliability", () => {
  it("counts an arrival within 5 minutes, including exactly 5 and early", () => {
    const result = calculateReliability([
      arrived("a", 0),
      arrived("b", 5),
      arrived("c", -3),
      arrived("d", 6),
    ]);

    expect(result.status).toBe("ok");
    expect(result.withinFiveMinutes).toEqual({
      count: 3,
      total: 4,
      percentage: 75,
    });
    expect(result.distribution.cancelled).toBe(0);
  });

  it("rounds the percentage to a whole number and keeps the counts", () => {
    const result = calculateReliability([
      arrived("1", 0),
      arrived("2", 0),
      arrived("3", 0),
      arrived("4", 0),
      arrived("5", 0),
      arrived("6", 20),
      arrived("7", 20),
    ]);

    expect(result.withinFiveMinutes).toEqual({
      count: 5,
      total: 7,
      percentage: 71,
    });
  });

  it("counts cancellations and missed calls against punctuality and as cancelled", () => {
    const result = calculateReliability([
      arrived("on-time", 1),
      { id: "cancelled", outcome: "cancelled" },
      { id: "skipped", outcome: "did_not_call" },
    ]);

    expect(result.withinFiveMinutes).toEqual({
      count: 1,
      total: 3,
      percentage: 33,
    });
    expect(result.distribution.cancelled).toBe(2);
    expect(result.excludedCount).toBe(0);
    expect(result.status).toBe("ok");
  });

  it("leaves a run with no data out of every figure", () => {
    const result = calculateReliability([
      arrived("on-time", 2),
      { id: "gap", outcome: "missing_actual" },
    ]);

    expect(result.status).toBe("partial");
    expect(result.withinFiveMinutes).toEqual({
      count: 1,
      total: 1,
      percentage: 100,
    });
    expect(result.distribution.cancelled).toBe(0);
    expect(result.excludedCount).toBe(1);
  });

  it("splits runs into lateness bands that add up to the total", () => {
    const result = calculateReliability([
      arrived("a", 5),
      arrived("b", 6),
      arrived("c", 14),
      arrived("d", 15),
      arrived("e", 29),
      arrived("f", 30),
      { id: "g", outcome: "cancelled" },
    ]);

    expect(result.distribution).toEqual({
      withinFive: 1,
      sixToFourteen: 2,
      fifteenToTwentyNine: 2,
      thirtyOrMore: 1,
      cancelled: 1,
    });
    expect(result.withinFiveMinutes.total).toBe(7);
  });

  it("returns no history when every run has no usable outcome", () => {
    const result = calculateReliability([
      { id: "gap-1", outcome: "missing_actual" },
      { id: "gap-2", outcome: "missing_actual" },
    ]);

    expect(result.status).toBe("no_history");
    expect(result.withinFiveMinutes.percentage).toBeNull();
    expect(result.excludedCount).toBe(2);
  });

  it("does not round a punctuality figure up to 100 when a run was late", () => {
    const runs = [
      ...Array.from({ length: 199 }, (_, index) => arrived(String(index), 0)),
      arrived("late", 6),
    ];
    const result = calculateReliability(runs);

    expect(result.withinFiveMinutes).toEqual({
      count: 199,
      total: 200,
      percentage: 99,
    });
  });

  it("does not round a punctuality figure down to 0 when a run was on time", () => {
    const runs = [
      arrived("on-time", 0),
      ...Array.from({ length: 999 }, (_, index) => arrived(String(index), 40)),
    ];
    const result = calculateReliability(runs);

    expect(result.withinFiveMinutes).toEqual({
      count: 1,
      total: 1000,
      percentage: 1,
    });
  });

  it("keeps 100 percent only when every known run was on time", () => {
    const result = calculateReliability([arrived("a", 0), arrived("b", -2)]);

    expect(result.withinFiveMinutes).toEqual({
      count: 2,
      total: 2,
      percentage: 100,
    });
  });

  it("returns no history when there are no runs", () => {
    const result = calculateReliability([]);

    expect(result.status).toBe("no_history");
    expect(result.withinFiveMinutes.percentage).toBeNull();
  });

  it("places dated runs on the calendar and keeps the worse run when a date repeats", () => {
    const result = calculateReliability([
      {
        id: "early",
        serviceDate: "2026-09-08",
        outcome: "arrived",
        latenessMinutes: -2,
      },
      {
        id: "late",
        serviceDate: "2026-09-09",
        outcome: "arrived",
        latenessMinutes: 12,
      },
      { id: "same-day", serviceDate: "2026-09-09", outcome: "cancelled" },
      { id: "gap", serviceDate: "2026-09-10", outcome: "missing_actual" },
      arrived("undated", 4),
    ]);

    expect(result.calendar).toEqual([
      { serviceDate: "2026-09-08", kind: "on_time", latenessMinutes: -2 },
      { serviceDate: "2026-09-09", kind: "cancelled" },
      { serviceDate: "2026-09-10", kind: "no_data" },
    ]);
    expect(
      result.calendar.filter((mark) => mark.serviceDate === "2026-09-09"),
    ).toHaveLength(1);
    expect(result.distribution.sixToFourteen).toBe(1);
    expect(result.distribution.cancelled).toBe(1);
    expect(result.withinFiveMinutes.total).toBe(4);
  });

  it("reports a fully cancelled sample as 0% within 5 minutes", () => {
    const result = calculateReliability([
      { id: "c1", outcome: "cancelled" },
      { id: "c2", outcome: "cancelled" },
    ]);

    expect(result.status).toBe("ok");
    expect(result.withinFiveMinutes).toEqual({
      count: 0,
      total: 2,
      percentage: 0,
    });
    expect(result.distribution.cancelled).toBe(2);
  });
});

describe("clock spans", () => {
  it("counts a journey that arrives after midnight", () => {
    expect(journeyMinutes("2350", "0010")).toBe(20);
  });

  it("uses the shorter gap between two clock times", () => {
    expect(minutesApart("2359", "0001")).toBe(2);
    expect(minutesApart("1052", "1051")).toBe(1);
  });

  it("leaves an unreadable clock unset rather than failing the list", () => {
    expect(journeyMinutes("1052", "")).toBeNaN();
    expect(minutesApart("1052", "10:52")).toBeNaN();
  });
});

describe("signedLatenessMinutes", () => {
  it("treats an early arrival as negative lateness", () => {
    expect(signedLatenessMinutes("0630", "0628")).toBe(-2);
  });

  it("wraps an arrival just after midnight", () => {
    expect(signedLatenessMinutes("2350", "0010")).toBe(20);
  });

  it("keeps a gap of more than 12 hours as lateness", () => {
    expect(signedLatenessMinutes("0600", "1830")).toBe(750);
    expect(signedLatenessMinutes("0000", "1201")).toBe(721);
  });

  it("rejects a clock time that is not HHMM", () => {
    expect(() => signedLatenessMinutes("630", "0632")).toThrow(/HHMM/);
  });
});

describe("formatHhmm", () => {
  it("writes minutes from midnight as HHMM, wrapped into the day", () => {
    expect(formatHhmm(7 * 60 + 5)).toBe("0705");
    expect(formatHhmm(24 * 60 + 10)).toBe("0010");
    expect(formatHhmm(-10)).toBe("2350");
  });
});
