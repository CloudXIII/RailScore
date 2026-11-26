import { describe, expect, it } from "vitest";
import { decodeCalls } from "../call-text";
import { callsAtTime, matchTrains, type CandidateRun } from "./match";
import type { TrustMovement } from "./movements";

const STATIONS: Record<string, string> = { "1": "AAA", "2": "BBB", "3": "CCC" };
const crsOf = (stanox: string) => STATIONS[stanox];

function run(rid: string, uid: string, calls: string): CandidateRun {
  return {
    rid,
    uid,
    serviceDate: `${rid.slice(0, 4)}-${rid.slice(4, 6)}-${rid.slice(6, 8)}`,
    calls: decodeCalls(calls),
  };
}

function moved(
  trainId: string,
  stanox: string,
  event: "arrival" | "departure",
  planned: string,
): TrustMovement {
  return {
    trainId,
    stanox,
    event,
    planned,
    actual: planned,
    plannedAt: 0,
    lateness: 0,
  };
}

const today = run(
  "202611257000001",
  "C00001",
  "AAA,,2300;BBB,2310,2311;CCC,2320,",
);
const lastWeek = run(
  "202611187000001",
  "C00001",
  "AAA,,2300;BBB,2310,2311;CCC,2320,",
);

describe("callsAtTime", () => {
  it("matches the public time of the event, at the station when known", () => {
    expect(
      callsAtTime(today.calls, moved("x", "2", "arrival", "2310"), crsOf),
    ).toEqual([1]);
    expect(
      callsAtTime(today.calls, moved("x", "2", "departure", "2310"), crsOf),
    ).toEqual([]);
    expect(
      callsAtTime(today.calls, moved("x", "3", "arrival", "2310"), crsOf),
    ).toEqual([]);
    // Unknown station: the time alone.
    expect(
      callsAtTime(today.calls, moved("x", "9", "arrival", "2310"), crsOf),
    ).toEqual([1]);
  });
});

describe("matchTrains", () => {
  it("matches an activated train by schedule UID and day", () => {
    const matched = matchTrains(
      [today, lastWeek],
      [{ trainId: "721A01MX25", uid: "C00001", date: "2026-11-25" }],
      new Map([["721A01MX25", [moved("721A01MX25", "9", "arrival", "2310")]]]),
      crsOf,
    );
    expect(matched).toEqual(new Map([["721A01MX25", today.rid]]));
  });

  it("matches a train without activation by two calls on the day its ID ends with", () => {
    const movements = new Map([
      [
        "721A01MX25",
        [
          moved("721A01MX25", "1", "departure", "2300"),
          moved("721A01MX25", "2", "arrival", "2310"),
        ],
      ],
    ]);
    expect(matchTrains([lastWeek, today], [], movements, crsOf)).toEqual(
      new Map([["721A01MX25", today.rid]]),
    );
  });

  it("needs two calls", () => {
    const movements = new Map([
      ["721A01MX25", [moved("721A01MX25", "1", "departure", "2300")]],
    ]);
    expect(matchTrains([today], [], movements, crsOf).size).toBe(0);
  });

  it("leaves a tie unmatched", () => {
    const twin = run("202611257000002", "C00002", "AAA,,2300;BBB,2310,2311");
    const movements = new Map([
      [
        "721A01MX25",
        [
          moved("721A01MX25", "1", "departure", "2300"),
          moved("721A01MX25", "2", "arrival", "2310"),
        ],
      ],
    ]);
    expect(matchTrains([today, twin], [], movements, crsOf).size).toBe(0);
  });

  it("gives a run claimed by two voting trains to neither, and never takes an activated one", () => {
    const calls = (id: string) => [
      moved(id, "1", "departure", "2300"),
      moved(id, "2", "arrival", "2310"),
    ];
    const two = new Map([
      ["721A01MX25", calls("721A01MX25")],
      ["725A01MX25", calls("725A01MX25")],
    ]);
    expect(matchTrains([today], [], two, crsOf).size).toBe(0);
    const activated = matchTrains(
      [today],
      [{ trainId: "721A01MX25", uid: "C00001", date: "2026-11-25" }],
      two,
      crsOf,
    );
    expect(activated).toEqual(new Map([["721A01MX25", today.rid]]));
  });
});
