import { describe, expect, it } from "vitest";
import {
  departureSlices,
  departureWindows,
  searchClockRange,
  trailingDays,
} from "./analysis-period";

describe("trailingDays", () => {
  it("covers the chosen number of days and ends yesterday in London", () => {
    const period = trailingDays(30, new Date("2026-10-08T12:00:00Z"));
    expect(period).toEqual({ from: "2026-09-08", to: "2026-10-07" });
    expect(trailingDays(90, new Date("2026-10-08T12:00:00Z")).from).toBe(
      "2026-07-10",
    );
  });
});

describe("departureWindows", () => {
  it("searches from the chosen minute through the 59 that follow", () => {
    expect(departureWindows("0700")).toEqual([
      { fromTime: "0700", toTime: "0759" },
    ]);
    expect(departureWindows("0630")).toEqual([
      { fromTime: "0630", toTime: "0729" },
    ]);
  });

  it("does not pull in midnight when the window ends at 23:59", () => {
    expect(departureWindows("2300")).toEqual([
      { fromTime: "2300", toTime: "2359" },
    ]);
  });

  it("splits a window that crosses midnight", () => {
    expect(departureWindows("2330")).toEqual([
      { fromTime: "2330", toTime: "2359" },
      { fromTime: "0000", toTime: "0029" },
    ]);
    expect(departureWindows("2345")).toEqual([
      { fromTime: "2345", toTime: "2359" },
      { fromTime: "0000", toTime: "0044" },
    ]);
  });
});

describe("departureSlices", () => {
  it("cuts a window that starts on the quarter into four quarter-hours", () => {
    const slices = departureSlices("0830");
    expect(slices).toHaveLength(4);
    expect(slices[0]).toEqual({ fromTime: "0830", toTime: "0844" });
    expect(slices.at(-1)).toEqual({ fromTime: "0915", toTime: "0929" });
  });

  it("cuts at clock quarter-hours, so other start minutes share slices", () => {
    const slices = departureSlices("0710");
    expect(slices[0]).toEqual({ fromTime: "0710", toTime: "0714" });
    expect(slices[1]).toEqual({ fromTime: "0715", toTime: "0729" });
    expect(slices.at(-1)).toEqual({ fromTime: "0800", toTime: "0809" });
  });

  it("covers the same minutes as the departure windows", () => {
    for (const time of ["0710", "2300", "2330", "2359"]) {
      const minutes = (windows: Array<{ fromTime: string; toTime: string }>) =>
        windows.flatMap((window) => {
          const from = clock(window.fromTime);
          return Array.from(
            { length: clock(window.toTime) - from + 1 },
            (_, index) => from + index,
          );
        });
      expect(minutes(departureSlices(time))).toEqual(
        minutes(departureWindows(time)),
      );
    }
  });

  it("splits at midnight without a slice that wraps", () => {
    const slices = departureSlices("2330");
    expect(slices[1]).toEqual({ fromTime: "2345", toTime: "2359" });
    expect(slices[2]).toEqual({ fromTime: "0000", toTime: "0014" });
    expect(slices.every((slice) => slice.fromTime <= slice.toTime)).toBe(true);
  });
});

function clock(hhmm: string): number {
  return Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(2, 4));
}

describe("searchClockRange", () => {
  it("covers the chosen minute and the 59 that follow", () => {
    expect(searchClockRange("0700")).toEqual({ from: "0700", to: "0759" });
    expect(searchClockRange("0630")).toEqual({ from: "0630", to: "0729" });
  });

  it("wraps a window that crosses midnight as one span", () => {
    expect(searchClockRange("2330")).toEqual({ from: "2330", to: "0029" });
    expect(searchClockRange("2300")).toEqual({ from: "2300", to: "2359" });
  });
});
