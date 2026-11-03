import { describe, expect, it } from "vitest";
import { chunkDecision, createProcessGate } from "./calculation-chunk";
import { historicalRunFromDetails, unreadableDetails } from "../services/map";

describe("createProcessGate", () => {
  it("lets one holder through and refuses a second until release", () => {
    const gate = createProcessGate();
    expect(gate.tryAcquire("0630-0721-NT-LIV-MIA", "a", 0, 20_000)).toBe(true);
    expect(gate.tryAcquire("0630-0721-NT-LIV-MIA", "b", 1_000, 20_000)).toBe(
      false,
    );
    gate.release("0630-0721-NT-LIV-MIA", "a");
    expect(gate.tryAcquire("0630-0721-NT-LIV-MIA", "b", 2_000, 20_000)).toBe(
      true,
    );
  });

  it("does not let a finished holder release someone else's lease", () => {
    const gate = createProcessGate();
    gate.tryAcquire("service", "a", 0, 1_000);
    expect(gate.tryAcquire("service", "b", 1_000, 20_000)).toBe(true);
    gate.release("service", "a");
    expect(gate.tryAcquire("service", "c", 1_500, 20_000)).toBe(false);
  });
});

describe("chunkDecision", () => {
  it("shows the result only when every run is stored", () => {
    expect(
      chunkDecision({
        resolved: 90,
        total: 90,
        savedThisChunk: 30,
        failed: false,
      }),
    ).toBe("complete");
  });

  it("continues when the slice ran out of time after saving runs", () => {
    expect(
      chunkDecision({
        resolved: 30,
        total: 90,
        savedThisChunk: 30,
        failed: false,
      }),
    ).toBe("working");
    expect(
      chunkDecision({
        resolved: 30,
        total: 90,
        savedThisChunk: 30,
        failed: true,
      }),
    ).toBe("working");
  });

  it("surfaces a failure that stored nothing", () => {
    expect(
      chunkDecision({
        resolved: 0,
        total: 90,
        savedThisChunk: 0,
        failed: true,
      }),
    ).toBe("failed");
  });

  it("keeps waiting when a busy source stored nothing", () => {
    expect(
      chunkDecision({
        resolved: 0,
        total: 90,
        savedThisChunk: 0,
        failed: true,
        busy: true,
      }),
    ).toBe("working");
  });
});

describe("unreadableDetails", () => {
  it("keeps the RID date and classifies as no data", () => {
    const unread = unreadableDetails(
      "202608289999999",
      new Date("2026-10-09T12:00:00Z"),
    );
    expect(unread.serviceDate).toBe("2026-08-28");
    expect(
      historicalRunFromDetails(
        unread.payload,
        { boardingCrs: "LIV", destinationCrs: "MIA" },
        "202608289999999",
      ),
    ).toEqual({
      id: "202608289999999",
      serviceDate: "2026-08-28",
      outcome: "missing_actual",
    });
  });
});
