import { afterEach, describe, expect, it, vi } from "vitest";
import type { HistoricalRun } from "@railscore/core";
import type { BacklogTrain } from "@/shared/contracts";
import {
  apply,
  finished,
  followBacklog,
  isComplete,
  type BacklogState,
} from "./use-backlog";

const empty: BacklogState = {
  trains: new Map(),
  missing: new Set(),
  runs: [],
  done: false,
  busy: false,
};

const counts = { runs: 2, within5: 2, within14: 2, within29: 2, arrived: 2 };

const run = (id: string): HistoricalRun => ({
  id,
  serviceDate: "2026-11-02",
  outcome: "arrived",
  latenessMinutes: 1,
});

const trains = [{ key: "A" }, { key: "B" }] as unknown as BacklogTrain[];

describe("a backlog asked again", () => {
  it("takes a train out of missing once a later attempt answers it", () => {
    const missed = apply(empty, { type: "missing", keys: ["A", "B"] });
    const answered = apply(missed, {
      type: "train",
      key: "A",
      byDay: { weekdays: counts },
      runCount: 2,
    });
    expect([...answered.missing]).toEqual(["B"]);
    expect(
      apply(answered, { type: "missing", keys: ["A"] }).missing.has("A"),
    ).toBe(false);
  });

  it("does not add a run the server sends again", () => {
    const first = apply(empty, { type: "runs", runs: [run("r1")] });
    const again = apply(first, { type: "runs", runs: [run("r1"), run("r2")] });
    expect(again.runs.map((each) => each.id)).toEqual(["r1", "r2"]);
  });

  it("is complete once every train is answered and the history's runs are in", () => {
    let state = apply(empty, {
      type: "train",
      key: "A",
      byDay: { weekdays: counts },
      runCount: 2,
    });
    state = apply(state, { type: "train", key: "B", byDay: {}, runCount: 0 });
    expect(isComplete(state, { trains })).toBe(true);
    expect(isComplete(state, { trains, runsOf: "A" })).toBe(false);
    state = apply(state, { type: "runs", runs: [run("r1"), run("r2")] });
    expect(isComplete(state, { trains, runsOf: "A" })).toBe(true);
  });

  it("marks every unanswered train missing at the end, even after a failed request", () => {
    const state = finished(empty, { trains });
    expect(state.done).toBe(true);
    expect([...state.missing]).toEqual(["A", "B"]);
  });
});

describe("followBacklog", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const answer = (...events: object[]) =>
    new Response(
      events
        .map(
          (event) => `${JSON.stringify(event)}
`,
        )
        .join(""),
    );

  const train = (key: string, runCount: number) => ({
    type: "train",
    key,
    byDay: { weekdays: counts },
    runCount,
  });

  it("asks again after a busy answer and keeps what came, without doubles", async () => {
    const fetch = vi
      .fn()
      // HSP busy: A answered with one run of two, B left out.
      .mockResolvedValueOnce(
        answer(
          train("A", 2),
          { type: "runs", runs: [run("r1")] },
          { type: "missing", keys: ["B"] },
          { type: "end" },
        ),
      )
      // The stored answers again, then the rest.
      .mockResolvedValueOnce(
        answer(
          train("A", 2),
          { type: "runs", runs: [run("r1")] },
          train("B", 0),
          { type: "runs", runs: [run("r2")] },
          { type: "end" },
        ),
      );
    vi.stubGlobal("fetch", fetch);
    const states: BacklogState[] = [];
    await followBacklog(
      JSON.stringify({ trains, runsOf: "A" }),
      new AbortController().signal,
      (state) => states.push(state),
      [1, 1],
    );
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(states.some((state) => state.busy && !state.done)).toBe(true);
    const last = states.at(-1)!;
    expect(last.done).toBe(true);
    expect([...last.missing]).toEqual([]);
    expect([...last.trains.keys()]).toEqual(["A", "B"]);
    expect(last.runs.map((each) => each.id)).toEqual(["r1", "r2"]);
  });

  it("gives up after the last delay and marks the rest missing", async () => {
    const fetch = vi
      .fn()
      .mockImplementation(async () =>
        answer({ type: "missing", keys: ["A", "B"] }, { type: "end" }),
      );
    vi.stubGlobal("fetch", fetch);
    const states: BacklogState[] = [];
    await followBacklog(
      JSON.stringify({ trains }),
      new AbortController().signal,
      (state) => states.push(state),
      [1],
    );
    expect(fetch).toHaveBeenCalledTimes(2);
    const last = states.at(-1)!;
    expect(last.done).toBe(true);
    expect([...last.missing]).toEqual(["A", "B"]);
  });

  it("asks once when the first answer is complete", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(answer(train("A", 0), train("B", 0), { type: "end" }));
    vi.stubGlobal("fetch", fetch);
    await followBacklog(
      JSON.stringify({ trains }),
      new AbortController().signal,
      () => undefined,
      [1, 1],
    );
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
