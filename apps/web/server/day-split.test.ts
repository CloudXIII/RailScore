import { describe, expect, it } from "vitest";
import type { HistoricalRun } from "@railscore/core";
import { reliabilityByDayType } from "./day-split";

function arrived(
  id: string,
  serviceDate: string | undefined,
  latenessMinutes: number,
): HistoricalRun {
  return serviceDate
    ? { id, serviceDate, outcome: "arrived", latenessMinutes }
    : { id, outcome: "arrived", latenessMinutes };
}

describe("reliabilityByDayType", () => {
  it("splits runs into weekdays, Saturdays and Sundays in that order", () => {
    const split = reliabilityByDayType([
      arrived("sun", "2026-09-13", 20),
      arrived("mon", "2026-09-14", 1),
      arrived("fri", "2026-09-18", 8),
      arrived("sat", "2026-09-12", 2),
    ]);
    expect(
      split.map((entry) => [
        entry.day,
        entry.result.withinFiveMinutes.total,
        entry.result.withinFiveMinutes.percentage,
      ]),
    ).toEqual([
      ["weekdays", 2, 50],
      ["saturday", 1, 100],
      ["sunday", 1, 0],
    ]);
  });

  it("leaves out day types with no runs and runs with no date", () => {
    const split = reliabilityByDayType([
      arrived("mon", "2026-09-14", 1),
      arrived("undated", undefined, 1),
    ]);
    expect(split.map((entry) => entry.day)).toEqual(["weekdays"]);
    expect(split[0]?.result.withinFiveMinutes.total).toBe(1);
  });
});
