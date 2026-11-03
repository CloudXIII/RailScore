import { describe, expect, it } from "vitest";
import { toHistoricalRun } from "../services/map";
import type { DarwinUpdate } from "./push-port";
import {
  decodeCalls,
  encodeCalls,
  detailsPayloadFromDarwin,
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

describe("detailsPayloadFromDarwin", () => {
  const stations = { boardingCrs: "CLJ", destinationCrs: "WAT" };
  const scheduled = mergeUpdate(undefined, schedule)!;

  it("classifies an arrival with the shared run rules", () => {
    const run = mergeUpdate(
      mergeUpdate(scheduled, arrived({ atd: "0813" })),
      arrived({ ata: "0829" }),
    )!;
    expect(
      toHistoricalRun(detailsPayloadFromDarwin(run), stations, rid),
    ).toEqual({
      id: rid,
      serviceDate: "2026-11-02",
      outcome: "arrived",
      latenessMinutes: 6,
    });
  });

  it("reads a fully cancelled run as cancelled", () => {
    const run = mergeUpdate(undefined, {
      ...schedule,
      calls: schedule.calls.map((call) => ({ ...call, cancelled: true })),
    })!;
    expect(
      toHistoricalRun(detailsPayloadFromDarwin(run), stations, rid).outcome,
    ).toBe("cancelled");
  });

  it("reads a run cut short before the destination as a missed call", () => {
    const shortened = mergeUpdate(scheduled, {
      ...schedule,
      calls: schedule.calls.map((call) =>
        call.tpl === "WATRLMN" ? { ...call, cancelled: true } : call,
      ),
    });
    const run = mergeUpdate(shortened, arrived({ atd: "0812" }))!;
    expect(
      toHistoricalRun(detailsPayloadFromDarwin(run), stations, rid).outcome,
    ).toBe("did_not_call");
  });
});
