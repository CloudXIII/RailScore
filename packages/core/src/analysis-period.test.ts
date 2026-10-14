import { describe, expect, it } from "vitest";
import {
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

  it("does not pull in midnight when the hour ends at 23:59", () => {
    expect(departureWindows("2300")).toEqual([
      { fromTime: "2300", toTime: "2359" },
    ]);
  });

  it("splits a window that crosses midnight on the 59th minute", () => {
    expect(departureWindows("2330")).toEqual([
      { fromTime: "2330", toTime: "2359" },
      { fromTime: "0000", toTime: "0029" },
    ]);
  });
});

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
