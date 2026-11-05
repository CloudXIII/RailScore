import { describe, expect, it } from "vitest";
import type { DarwinUpdate } from "./push-port";
import { decodeCalls, encodeCalls } from "../call-text";
import {
  foldRepeatedCalls,
  historicalRunFromDarwin,
  mergeUpdate,
  type DarwinRun,
} from "./run";

const rid = "202611026782766";

/** Clapham Junction to Waterloo, via Vauxhall. LNDNASJ stands in for a timing point with no CRS. */
const schedule: DarwinUpdate = {
  kind: "schedule",
  rid,
  serviceDate: "2026-11-02",
  uid: "C82766",
  toc: "SW",
  calls: [
    { tpl: "CLPHMJN", ptd: "0812" },
    { tpl: "LNDNASJ", ptd: "0815" },
    { tpl: "VAUXHLM", pta: "0817", ptd: "0818" },
    { tpl: "WATRLMN", pta: "0823" },
  ],
};

function arrived(times: { atd?: string; ata?: string }): DarwinUpdate {
  return {
    kind: "status",
    rid,
    serviceDate: "2026-11-02",
    calls: [
      ...(times.atd ? [{ tpl: "CLPHMJN", ptd: "0812", atd: times.atd }] : []),
      ...(times.ata ? [{ tpl: "WATRLMN", pta: "0823", ata: times.ata }] : []),
    ],
  };
}

describe("mergeUpdate", () => {
  it("keeps a schedule's calls at stations with a CRS", () => {
    const run = mergeUpdate(undefined, schedule);
    expect(run?.calls.map((call) => call.crs)).toEqual(["CLJ", "VXH", "WAT"]);
  });

  it("adds actual times from train statuses, in any order with the schedule", () => {
    const first = mergeUpdate(undefined, arrived({ atd: "0813" }));
    const scheduled = mergeUpdate(first, schedule);
    const run = mergeUpdate(scheduled, arrived({ ata: "0826" }));
    expect(run).toEqual<DarwinRun>({
      rid,
      serviceDate: "2026-11-02",
      uid: "C82766",
      toc: "SW",
      calls: [
        { crs: "CLJ", ptd: "0812", atd: "0813" },
        { crs: "VXH", pta: "0817", ptd: "0818" },
        { crs: "WAT", pta: "0823", ata: "0826" },
      ],
    });
  });

  it("lets a later schedule lift a cancellation", () => {
    const cancelled = mergeUpdate(undefined, {
      ...schedule,
      calls: schedule.calls.map((call) => ({ ...call, cancelled: true })),
    });
    expect(cancelled?.calls.every((call) => call.cancelled)).toBe(true);
    const reinstated = mergeUpdate(cancelled, schedule);
    expect(reinstated?.calls.some((call) => call.cancelled)).toBe(false);
  });

  it("stores nothing for a train with no public call", () => {
    expect(
      mergeUpdate(undefined, {
        ...schedule,
        calls: [{ tpl: "LNDNASJ", ptd: "0815" }],
      }),
    ).toBeUndefined();
  });
});

describe("encodeCalls", () => {
  it("round-trips every field", () => {
    const calls = [
      { crs: "CLJ", ptd: "0812", atd: "0813" },
      { crs: "VXH", pta: "0817", ptd: "0818", cancelled: true },
      { crs: "WAT", pta: "0823", ata: "0826", platform: "12" },
    ];
    expect(encodeCalls(calls)).toBe(
      "CLJ,,0812,,0813,,;VXH,0817,0818,,,c,;WAT,0823,,0826,,,12",
    );
    expect(decodeCalls(encodeCalls(calls))).toEqual(calls);
  });
});

describe("mergeUpdate reasons and platforms", () => {
  it("keeps the newest platform and late reason, and takes the cancel reason from the schedule", () => {
    const first = mergeUpdate(undefined, {
      ...schedule,
      cancelReason: "526",
    })!;
    const platformed = mergeUpdate(first, {
      kind: "status",
      rid,
      serviceDate: "2026-11-02",
      lateReason: "104",
      calls: [{ tpl: "CLPHMJN", ptd: "0812", platform: "9" }],
    })!;
    const moved = mergeUpdate(platformed, {
      kind: "status",
      rid,
      serviceDate: "2026-11-02",
      calls: [{ tpl: "CLPHMJN", ptd: "0812", atd: "0813", platform: "10" }],
    })!;
    const rescheduled = mergeUpdate(moved, schedule)!;

    expect(moved.calls[0]).toEqual({
      crs: "CLJ",
      ptd: "0812",
      atd: "0813",
      platform: "10",
    });
    expect(moved).toMatchObject({ lateReason: "104", cancelReason: "526" });
    expect(rescheduled.calls[0]?.platform).toBe("10");
    expect(rescheduled.lateReason).toBe("104");
    expect(rescheduled.cancelReason).toBeUndefined();
  });
});

describe("historicalRunFromDarwin", () => {
  const stations = { boardingCrs: "CLJ", destinationCrs: "WAT" };
  const scheduled = mergeUpdate(undefined, schedule)!;

  it("leaves a run with no movement seen out, rather than cancelled", () => {
    expect(historicalRunFromDarwin(scheduled, stations)).toEqual({
      id: rid,
      serviceDate: "2026-11-02",
      outcome: "missing_actual",
    });
  });

  it("still reads a run Darwin cancelled as cancelled", () => {
    const run = mergeUpdate(undefined, {
      ...schedule,
      calls: schedule.calls.map((call) => ({ ...call, cancelled: true })),
    })!;
    expect(historicalRunFromDarwin(run, stations).outcome).toBe("cancelled");
  });

  it("classifies a seen run with the shared run rules", () => {
    const run = mergeUpdate(
      mergeUpdate(scheduled, arrived({ atd: "0813" })),
      arrived({ ata: "0829" }),
    )!;
    expect(historicalRunFromDarwin(run, stations)).toMatchObject({
      outcome: "arrived",
      latenessMinutes: 6,
    });
  });

  it("reads a run cut short before the destination as a missed call", () => {
    const shortened = mergeUpdate(scheduled, {
      ...schedule,
      calls: schedule.calls.map((call) =>
        call.tpl === "WATRLMN" ? { ...call, cancelled: true } : call,
      ),
    });
    const run = mergeUpdate(shortened, arrived({ atd: "0812" }))!;
    expect(historicalRunFromDarwin(run, stations).outcome).toBe("did_not_call");
  });
});

describe("the passenger's leg on loops and repeated calls", () => {
  it("reads a Kingston loop train at its arrival back into Waterloo", () => {
    // 4 November 2026, Waterloo 05:30 round the Kingston loop and back to Waterloo.
    const run: DarwinRun = {
      rid: "202611047683639",
      serviceDate: "2026-11-04",
      uid: "W1",
      toc: "SW",
      calls: decodeCalls(
        "WAT,,0530,,0529,,8;CLJ,0540,0540,0540,0541,,5;KNG,0616,0618,0615,0617,,3;CLJ,0639,0640,0637,0639,,10;WAT,0649,,0648,,,5",
      ),
    };
    expect(
      historicalRunFromDarwin(run, {
        boardingCrs: "CLJ",
        destinationCrs: "WAT",
      }),
    ).toMatchObject({ outcome: "arrived", latenessMinutes: -1 });
  });

  it("takes the arrival Darwin repeated at the end after a schedule change", () => {
    // 4 November 2026, Paddington 06:20, cut short at Reading.
    const run: DarwinRun = {
      rid: "202611047115392",
      serviceDate: "2026-11-04",
      uid: "W2",
      toc: "GW",
      calls: decodeCalls(
        "PAD,,0620,,0619,,11;SLO,0636,0639,0635,0638,,4;RDG,0700,0701,,,,14;TLH,0705,0705,,,c,3;DID,0726,,,,c,4;RDG,0700,,0657,,,12",
      ),
    };
    expect(
      historicalRunFromDarwin(run, {
        boardingCrs: "PAD",
        destinationCrs: "RDG",
      }),
    ).toMatchObject({ outcome: "arrived", latenessMinutes: -3 });
  });

  it("reads a Wirral line train at the destination after boarding", () => {
    const run: DarwinRun = {
      rid: "202611030000006",
      serviceDate: "2026-11-03",
      uid: "C08015",
      toc: "ME",
      calls: decodeCalls(
        "CTR,,1842,,1842,,;PSL,1908,1908,1908,1908,,;LVC,1929,1929,1929,1929,,;PSL,1946,1947,1950,,,;CTR,2015,,,,,",
      ),
    };
    expect(
      historicalRunFromDarwin(run, {
        boardingCrs: "LVC",
        destinationCrs: "PSL",
      }),
    ).toMatchObject({ outcome: "arrived", latenessMinutes: 4 });
  });

  it("still reads the first arrival when it has an actual time", () => {
    const run: DarwinRun = {
      rid: "202611047115393",
      serviceDate: "2026-11-04",
      uid: "W3",
      toc: "GW",
      calls: decodeCalls(
        "PAD,,0620,,0619,,;RDG,0700,0701,0702,0703,,;DID,0726,,0728,,,;RDG,0700,,0710,,,",
      ),
    };
    expect(
      historicalRunFromDarwin(run, {
        boardingCrs: "PAD",
        destinationCrs: "RDG",
      }),
    ).toMatchObject({ outcome: "arrived", latenessMinutes: 2 });
  });
});

/** 4 November 2026, Paddington 07:38 to Didcot Parkway, cut short at Reading. */
describe("a train cut short", () => {
  const cutShort = "202611046748197";
  const scheduled: DarwinUpdate = {
    kind: "schedule",
    rid: cutShort,
    serviceDate: "2026-11-04",
    uid: "C48197",
    toc: "GW",
    calls: [
      { tpl: "PADTON", ptd: "0738" },
      { tpl: "RDNGSTN", pta: "0816", ptd: "0824" },
      { tpl: "TILHRST", pta: "0828", ptd: "0828", cancelled: true },
      { tpl: "DIDCOTP", pta: "0850", cancelled: true },
    ],
  };
  const arrivedReading: DarwinUpdate = {
    kind: "status",
    rid: cutShort,
    serviceDate: "2026-11-04",
    calls: [{ tpl: "RDNGSTN", pta: "0816", ata: "0821", platform: "12" }],
  };

  it("keeps the arrival at its new last stop on that stop, not as an extra call", () => {
    const run = mergeUpdate(mergeUpdate(undefined, scheduled), arrivedReading);
    expect(run?.calls.map((call) => call.crs)).toEqual([
      "PAD",
      "RDG",
      "TLH",
      "DID",
    ]);
    expect(run?.calls[1]).toEqual({
      crs: "RDG",
      pta: "0816",
      ptd: "0824",
      ata: "0821",
      platform: "12",
    });
  });

  it("keeps the arrival when the schedule comes after the status", () => {
    const run = mergeUpdate(mergeUpdate(undefined, arrivedReading), scheduled);
    expect(run?.calls.map((call) => call.crs)).toEqual([
      "PAD",
      "RDG",
      "TLH",
      "DID",
    ]);
    expect(run?.calls[1]?.ata).toBe("0821");
  });

  it("folds a repeat stored at the end back into its call", () => {
    const calls = foldRepeatedCalls(
      decodeCalls(
        "PAD,,0738,,0737,,10;SLO,0753,0753,0756,0758,,2;RDG,0816,0824,,,,;TLH,0828,0828,,,c,3;DID,0850,,,,c,4;RDG,0816,,0821,,,12",
      ),
    );
    expect(encodeCalls(calls)).toBe(
      "PAD,,0738,,0737,,10;SLO,0753,0753,0756,0758,,2;RDG,0816,0824,0821,,,12;TLH,0828,0828,,,c,3;DID,0850,,,,c,4",
    );
  });

  it("leaves the two calls of a loop at one station apart", () => {
    const loop =
      "WAT,,0530,,0529,,8;CLJ,0540,0540,0540,0541,,5;KNG,0616,0618,0615,0617,,3;CLJ,0639,0640,0637,0639,,10;WAT,0649,,0648,,,5";
    expect(encodeCalls(foldRepeatedCalls(decodeCalls(loop)))).toBe(loop);
  });
});
