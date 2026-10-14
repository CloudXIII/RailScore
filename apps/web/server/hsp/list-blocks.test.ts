import { describe, expect, it } from "vitest";
import {
  isBlockUsable,
  joinBlocks,
  missingRanges,
  splitIntoBlocks,
  weekBlocks,
} from "./list-blocks";
import type { ScheduledService } from "./map";

const service = (rids: string[]): ScheduledService => ({
  originCrs: "QQQ",
  destinationCrs: "RRR",
  publicDeparture: "0700",
  publicArrival: "0800",
  operatorCode: "VT",
  rids,
  days: ["weekdays"],
});

describe("weekBlocks", () => {
  it("starts on the Monday before the period and stops the last block at its end", () => {
    expect(weekBlocks({ from: "2026-09-08", to: "2026-09-23" })).toEqual([
      { start: "2026-09-07", end: "2026-09-13" },
      { start: "2026-09-14", end: "2026-09-20" },
      { start: "2026-09-21", end: "2026-09-23" },
    ]);
  });

  it("gives the same block keys to a period one day later", () => {
    const today = weekBlocks({ from: "2026-09-08", to: "2026-10-07" }).map(
      (block) => block.start,
    );
    const tomorrow = weekBlocks({ from: "2026-09-09", to: "2026-10-08" }).map(
      (block) => block.start,
    );
    expect(tomorrow).toEqual(today);
  });
});

describe("isBlockUsable", () => {
  const block = { start: "2026-09-07", end: "2026-09-13" };

  it("keeps a block fetched days after its last date for good", () => {
    const stored = {
      services: [],
      coveredTo: "2026-09-13",
      fetchedAt: new Date("2026-09-20T12:00:00Z"),
    };
    expect(isBlockUsable(block, stored, new Date("2026-12-01T12:00:00Z"))).toBe(
      true,
    );
  });

  it("refreshes a recent block after a few hours", () => {
    const stored = {
      services: [],
      coveredTo: "2026-09-13",
      fetchedAt: new Date("2026-09-14T08:00:00Z"),
    };
    expect(isBlockUsable(block, stored, new Date("2026-09-14T10:00:00Z"))).toBe(
      true,
    );
    expect(isBlockUsable(block, stored, new Date("2026-09-14T20:00:00Z"))).toBe(
      false,
    );
  });

  it("does not use a block stored before its week ended", () => {
    const stored = {
      services: [],
      coveredTo: "2026-09-10",
      fetchedAt: new Date("2026-09-11T08:00:00Z"),
    };
    expect(isBlockUsable(block, stored, new Date("2026-09-11T09:00:00Z"))).toBe(
      false,
    );
  });
});

describe("missingRanges", () => {
  it("joins neighbouring missing blocks into one request", () => {
    const blocks = weekBlocks({ from: "2026-09-07", to: "2026-10-04" });
    const ranges = missingRanges(blocks, [false, false, true, false]);
    expect(ranges.map((range) => range.map((block) => block.start))).toEqual([
      ["2026-09-07", "2026-09-14"],
      ["2026-09-28"],
    ]);
  });
});

describe("splitIntoBlocks and joinBlocks", () => {
  it("round-trips runs and drops those outside the period", () => {
    const blocks = weekBlocks({ from: "2026-09-08", to: "2026-09-20" });
    const split = splitIntoBlocks(
      [service(["202609074100001", "202609154100002", "202609184100003"])],
      blocks,
    );
    expect(split.map((list) => list.map((item) => item.rids))).toEqual([
      [["202609074100001"]],
      [["202609154100002", "202609184100003"]],
    ]);
    const joined = joinBlocks(split, { from: "2026-09-08", to: "2026-09-20" });
    expect(joined).toHaveLength(1);
    expect(joined[0]?.rids).toEqual(["202609154100002", "202609184100003"]);
  });

  it("keeps a service HSP listed with no runs in the last block", () => {
    const blocks = weekBlocks({ from: "2026-09-07", to: "2026-09-20" });
    const split = splitIntoBlocks([service([])], blocks);
    expect(split.map((list) => list.length)).toEqual([0, 1]);
  });
});
