import { describe, expect, it } from "vitest";
import { listedTimetable } from "./timetable-day";

const day = (date: string, trains: number) => ({ date, trains });
const trainsOf = (found: { trains: number }) => found.trains;

describe("listedTimetable", () => {
  it("lists the latest day when it is the only one", () => {
    expect(listedTimetable([day("2026-11-07", 37)], trainsOf)?.date).toBe(
      "2026-11-07",
    );
    expect(listedTimetable([], trainsOf)).toBeUndefined();
  });

  it("lists the day before when the latest has a reduced timetable", () => {
    // Waterloo to Southampton on 7 November 2026: 37 diverted trains against 77.
    expect(
      listedTimetable([day("2026-11-07", 37), day("2026-10-31", 77)], trainsOf)
        ?.date,
    ).toBe("2026-10-31");
  });

  it("keeps the latest day from three quarters of the trains up", () => {
    expect(
      listedTimetable([day("2026-11-07", 75), day("2026-10-31", 100)], trainsOf)
        ?.date,
    ).toBe("2026-11-07");
    expect(
      listedTimetable([day("2026-11-07", 74), day("2026-10-31", 100)], trainsOf)
        ?.date,
    ).toBe("2026-10-31");
  });

  it("keeps the latest day when it has more trains", () => {
    expect(
      listedTimetable([day("2026-11-07", 90), day("2026-10-31", 40)], trainsOf)
        ?.date,
    ).toBe("2026-11-07");
  });
});
