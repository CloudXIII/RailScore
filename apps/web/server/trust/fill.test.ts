import { describe, expect, it } from "vitest";
import { decodeCalls } from "../call-text";
import { fillRefusals, fillRuns, NO_FILL, type FillStats } from "./fill";
import type { CandidateRun } from "./match";
import type { TrustMovement } from "./movements";

const STATIONS: Record<string, string> = {
  "1": "AAA",
  "2": "BBB",
  "3": "CCC",
  "4": "DDD",
};
const crsOf = (stanox: string) => STATIONS[stanox];
const rid = "202611257000001";
const window = {
  from: Date.parse("2026-11-25T23:00Z"),
  to: Date.parse("2026-11-26T02:00Z"),
};

function runOf(calls: string): Map<string, CandidateRun> {
  return new Map([
    [
      rid,
      {
        rid,
        uid: "C00001",
        serviceDate: "2026-11-25",
        calls: decodeCalls(calls),
      },
    ],
  ]);
}

function moved(
  stanox: string,
  event: "arrival" | "departure",
  planned: string,
  actual: string,
  lateness: number,
  plannedAt = Date.parse(
    `2026-11-25T${planned.slice(0, 2)}:${planned.slice(2)}Z`,
  ),
): TrustMovement {
  return { trainId: "T", stanox, event, planned, actual, plannedAt, lateness };
}

const matched = new Map([["T", rid]]);

describe("fillRuns", () => {
  it("fills only the actual times Darwin lacks, inside the window", () => {
    const runs = runOf(
      "AAA,,2250,,2251;BBB,2310,2311,,;CCC,2320,2321,,,c;DDD,2330,,,",
    );
    const { fills, stats } = fillRuns(
      runs,
      matched,
      new Map([
        [
          "T",
          [
            moved("1", "departure", "2250", "2252", 2), // Darwin has it: compared, kept
            moved("2", "arrival", "2310", "2312", 2),
            moved("2", "departure", "2311", "2313", 2),
            moved("3", "arrival", "2320", "2322", 2), // cancelled call
            moved("4", "arrival", "2330", "2330", 0),
          ],
        ],
      ]),
      window,
      crsOf,
    );
    expect(fills).toEqual([
      {
        rid,
        before:
          "AAA,,2250,,2251,,;BBB,2310,2311,,,,;CCC,2320,2321,,,c,;DDD,2330,,,,,",
        after:
          "AAA,,2250,,2251,,;BBB,2310,2311,2312,2313,,;CCC,2320,2321,,,c,;DDD,2330,,2330,,,",
      },
    ]);
    expect(stats).toMatchObject({
      runsChanged: 1,
      timesFilled: 3,
      overlap: 1,
      sameMinute: 0,
      withinOneMinute: 1,
      cancelled: 1,
    });
  });

  it("leaves calls outside the window and implausible lateness alone", () => {
    const runs = runOf("AAA,,2250,,;BBB,2310,,,");
    const { fills, stats } = fillRuns(
      runs,
      matched,
      new Map([
        [
          "T",
          [
            moved(
              "1",
              "departure",
              "2250",
              "2251",
              1,
              Date.parse("2026-11-25T22:50Z"),
            ),
            moved("2", "arrival", "2310", "0950", 640),
          ],
        ],
      ]),
      { from: Date.parse("2026-11-25T23:00Z"), to: window.to },
      crsOf,
    );
    expect(fills).toEqual([]);
    expect(stats.implausible).toBe(1);
  });

  it("measures agreement without filling when given no window", () => {
    const runs = runOf("AAA,,2250,,2251;BBB,2310,,2310,");
    const { fills, stats } = fillRuns(
      runs,
      matched,
      new Map([
        [
          "T",
          [
            moved("1", "departure", "2250", "2251", 1),
            moved("2", "arrival", "2310", "2312", 2),
          ],
        ],
      ]),
      NO_FILL,
      crsOf,
    );
    expect(fills).toEqual([]);
    expect(stats).toMatchObject({
      overlap: 2,
      sameMinute: 1,
      withinOneMinute: 1,
    });
  });

  it("skips a movement that matches no call or several", () => {
    const runs = runOf("AAA,,2250,,;AAA,2250,2251,,");
    const { stats } = fillRuns(
      runs,
      matched,
      new Map([
        [
          "T",
          [
            moved("9", "departure", "2250", "2250", 0),
            moved("1", "arrival", "2359", "2359", 0),
          ],
        ],
      ]),
      window,
      crsOf,
    );
    expect(stats.unmatchedCalls).toBe(1);
  });
});

describe("fillRefusals", () => {
  const good: FillStats = {
    runsChanged: 1_500,
    timesFilled: 19_000,
    overlap: 800,
    sameMinute: 650,
    withinOneMinute: 790,
    unmatchedCalls: 0,
    implausible: 0,
    cancelled: 0,
  };

  it("accepts a fill like 25 November's", () => {
    expect(fillRefusals(good)).toEqual([]);
  });

  it("refuses too few calls to compare, poor agreement, or too many runs", () => {
    expect(
      fillRefusals({ ...good, overlap: 99, withinOneMinute: 99 }),
    ).toHaveLength(1);
    expect(fillRefusals({ ...good, withinOneMinute: 700 })).toEqual([
      "88% within a minute of Darwin, 90% needed",
    ]);
    expect(fillRefusals({ ...good, runsChanged: 20_001 })).toHaveLength(1);
  });
});
