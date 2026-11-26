import { describe, expect, it } from "vitest";
import {
  londonHour,
  nextOutage,
  outageHolds,
  type OutageState,
} from "./outage";

const at = (iso: string) => new Date(iso);

describe("nextOutage", () => {
  it("starts when the day has gone 20 minutes without an actual time", () => {
    const state: OutageState = { lastActualAt: at("2026-11-25T23:10Z") };
    expect(nextOutage(state, at("2026-11-25T23:30Z"), true).event).toBe("none");
    const step = nextOutage(state, at("2026-11-25T23:31Z"), true);
    expect(step.event).toBe("started");
    expect(step.state.outageFrom).toEqual(at("2026-11-25T23:10Z"));
    expect(outageHolds(step.state)).toBe(true);
  });

  it("never starts between 01:00 and 05:00 London", () => {
    const state: OutageState = { lastActualAt: at("2026-11-26T01:00Z") };
    expect(nextOutage(state, at("2026-11-26T03:00Z"), true).event).toBe("none");
    expect(nextOutage(state, at("2026-11-26T05:00Z"), true).event).toBe(
      "started",
    );
  });

  it("reads the night in London time in summer", () => {
    expect(londonHour(at("2026-07-01T00:30Z"))).toBe(1);
    const state: OutageState = { lastActualAt: at("2026-06-30T23:30Z") };
    // 00:30 UTC is 01:30 BST: night.
    expect(nextOutage(state, at("2026-07-01T00:30Z"), true).event).toBe("none");
  });

  it("changes nothing while the import is still reading a backlog", () => {
    const quiet: OutageState = { lastActualAt: at("2026-11-25T20:00Z") };
    expect(nextOutage(quiet, at("2026-11-25T23:00Z"), false)).toEqual({
      state: quiet,
      event: "none",
    });
  });

  it("does not start without any actual time on record", () => {
    expect(nextOutage({}, at("2026-11-25T23:00Z"), true).event).toBe("none");
  });

  it("ends once actual times have been back for 30 minutes", () => {
    const from = at("2026-11-25T18:00Z");
    let state: OutageState = {
      lastActualAt: at("2026-11-25T19:00Z"),
      outageFrom: from,
    };
    let step = nextOutage(state, at("2026-11-25T19:05Z"), true);
    expect(step.event).toBe("ongoing");
    expect(step.state.okSince).toEqual(at("2026-11-25T19:05Z"));
    state = { ...step.state, lastActualAt: at("2026-11-25T19:24Z") };
    expect(nextOutage(state, at("2026-11-25T19:25Z"), true).event).toBe(
      "ongoing",
    );
    state = { ...state, lastActualAt: at("2026-11-25T19:44Z") };
    step = nextOutage(state, at("2026-11-25T19:45Z"), true);
    expect(step.event).toBe("ended");
    expect(step.state.closedAt).toEqual(at("2026-11-25T19:45Z"));
    expect(step.state.outageFrom).toEqual(from);
    expect(outageHolds(step.state)).toBe(false);
  });

  it("starts the recovery again when actual times stop once more", () => {
    const state: OutageState = {
      lastActualAt: at("2026-11-25T19:00Z"),
      outageFrom: at("2026-11-25T18:00Z"),
      okSince: at("2026-11-25T19:05Z"),
    };
    const step = nextOutage(state, at("2026-11-25T19:30Z"), true);
    expect(step.event).toBe("ongoing");
    expect(step.state.okSince).toBeUndefined();
  });

  it("holds through the night once started", () => {
    const state: OutageState = {
      lastActualAt: at("2026-11-26T02:00Z"),
      outageFrom: at("2026-11-25T23:10Z"),
      okSince: at("2026-11-26T02:05Z"),
    };
    const late = { ...state, lastActualAt: at("2026-11-26T04:50Z") };
    expect(nextOutage(late, at("2026-11-26T04:55Z"), true).event).toBe(
      "ongoing",
    );
    const morning = { ...state, lastActualAt: at("2026-11-26T05:10Z") };
    expect(nextOutage(morning, at("2026-11-26T05:15Z"), true).event).toBe(
      "ended",
    );
  });

  it("closes after eight hours and waits for actual times before another", () => {
    const state: OutageState = {
      lastActualAt: at("2026-11-25T10:00Z"),
      outageFrom: at("2026-11-25T10:00Z"),
    };
    const capped = nextOutage(state, at("2026-11-25T18:00Z"), true);
    expect(capped.event).toBe("capped");
    expect(nextOutage(capped.state, at("2026-11-25T18:20Z"), true).event).toBe(
      "none",
    );
    const back = {
      ...capped.state,
      lastActualAt: at("2026-11-25T19:00Z"),
    };
    expect(nextOutage(back, at("2026-11-25T19:30Z"), true).event).toBe(
      "started",
    );
  });
});
