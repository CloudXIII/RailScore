import { describe, expect, it } from "vitest";
import { listedPeriod, listState, type StoredList } from "./list-cache";

const stored = (coveredTo: string, fetchedAt: string): StoredList => ({
  services: [],
  coveredTo,
  fetchedAt: new Date(fetchedAt),
});

describe("listState", () => {
  it("uses a list fetched for this period within the last few hours", () => {
    expect(
      listState(
        stored("2026-10-07", "2026-10-08T08:00:00Z"),
        "2026-10-07",
        new Date("2026-10-08T10:00:00Z"),
      ),
    ).toBe("fresh");
  });

  it("waits for a new list when the stored one ends before the period", () => {
    expect(
      listState(
        stored("2026-10-07", "2026-10-08T08:00:00Z"),
        "2026-10-08",
        new Date("2026-10-09T08:00:00Z"),
      ),
    ).toBe("missing");
  });

  it("asks again after six hours, as HSP may still add recent runs", () => {
    expect(
      listState(
        stored("2026-10-07", "2026-10-08T08:00:00Z"),
        "2026-10-07",
        new Date("2026-10-08T15:00:00Z"),
      ),
    ).toBe("stale");
  });

  it("waits for a new list when the stored one is absent or ends early", () => {
    expect(
      listState(
        stored("2026-09-30", "2026-10-01T08:00:00Z"),
        "2026-10-07",
        new Date("2026-10-08T08:00:00Z"),
      ),
    ).toBe("missing");
    expect(
      listState(undefined, "2026-10-07", new Date("2026-10-08T08:00:00Z")),
    ).toBe("missing");
  });
});

describe("listedPeriod", () => {
  it("spans every list shown, from the earliest start to the latest end", () => {
    expect(
      listedPeriod(
        [
          stored("2026-10-07", "2026-10-08T08:00:00Z"),
          stored("2026-10-05", "2026-10-06T08:00:00Z"),
        ],
        30,
        { from: "2026-09-08", to: "2026-10-07" },
      ),
    ).toEqual({ from: "2026-09-06", to: "2026-10-07" });
  });

  it("is the search period when nothing is listed", () => {
    const period = { from: "2026-09-08", to: "2026-10-07" };
    expect(listedPeriod([], 30, period)).toEqual(period);
  });
});
