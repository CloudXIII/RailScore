"use client";

import { useEffect, useState } from "react";
import type { HistoricalRun } from "@railscore/core";
import type { TrainBacklog } from "@/features/backlog-figures";
import type { BacklogEvent } from "@/server/hsp/backlog";
import type { BacklogTrain } from "@/server/hsp/match";
import type { DayPattern } from "@/server/query";

/** What the page asks HSP about: the listed trains, and the train whose runs it shows. */
export type BacklogRequest = {
  readonly fromCrs: string;
  readonly toCrs: string;
  readonly days: DayPattern;
  readonly periodDays: number;
  readonly trains: readonly BacklogTrain[];
  readonly runsOf?: string;
};

export type BacklogState = {
  readonly trains: ReadonlyMap<string, TrainBacklog>;
  /** Trains HSP gave nothing for so far. Their figures are Darwin's until it does. */
  readonly missing: ReadonlySet<string>;
  readonly runs: readonly HistoricalRun[];
  /** True once the last attempt has ended, or failed. */
  readonly done: boolean;
  /** True once an attempt ended with something missing and another is due. */
  readonly busy: boolean;
};

const EMPTY: BacklogState = {
  trains: new Map(),
  missing: new Set(),
  runs: [],
  done: false,
  busy: false,
};

const DONE: BacklogState = { ...EMPTY, done: true };

/**
 * Waits before asking again for what an attempt left missing. HSP refuses every call in
 * spells of up to half a minute at busy times. A new attempt is cheap: the server sends
 * what it stored at once and asks HSP only for the rest.
 */
export const RETRY_DELAYS_MS = [15_000, 30_000, 60_000] as const;

/**
 * Streams HSP's figures for the days before Darwin, one event per line, into state as they
 * arrive. No request (HSP not needed) is done at once. When an answer ends with trains or
 * runs missing, as when HSP is busy, it is asked again a few times, keeping what came.
 */
export function useBacklog(request: BacklogRequest | undefined): BacklogState {
  const body = request ? JSON.stringify(request) : "";
  const [state, setState] = useState<BacklogState>(body ? EMPTY : DONE);

  useEffect(() => {
    if (!body) {
      setState(DONE);
      return;
    }
    const controller = new AbortController();
    void followBacklog(body, controller.signal, setState);
    return () => controller.abort();
  }, [body]);

  return state;
}

/**
 * Asks for the backlog of `body`, a BacklogRequest as JSON, and again after each delay while
 * something is missing. Every new state goes to `onState`. Nothing more once `signal` aborts.
 */
export async function followBacklog(
  body: string,
  signal: AbortSignal,
  onState: (state: BacklogState) => void,
  delays: readonly number[] = RETRY_DELAYS_MS,
): Promise<void> {
  const asked = JSON.parse(body) as BacklogRequest;
  let current = EMPTY;
  const publish = (next: BacklogState) => {
    current = next;
    onState(next);
  };
  publish(EMPTY);
  for (let attempt = 0; ; attempt += 1) {
    await read(body, signal, (event) => publish(apply(current, event)));
    if (signal.aborted) {
      return;
    }
    const delay = delays[attempt];
    if (delay === undefined || isComplete(current, asked)) {
      publish(finished(current, asked));
      return;
    }
    publish({ ...current, busy: true });
    if (!(await wait(delay, signal))) {
      return;
    }
  }
}

/** Every train answered, and every run of the history train fetched. */
export function isComplete(
  state: BacklogState,
  request: Pick<BacklogRequest, "trains" | "runsOf">,
): boolean {
  if (!request.trains.every((train) => state.trains.has(train.key))) {
    return false;
  }
  const history = request.runsOf ? state.trains.get(request.runsOf) : undefined;
  return !history || state.runs.length >= history.runCount;
}

/** The last state: a train still unanswered, even after a failed request, is missing. */
export function finished(
  state: BacklogState,
  request: Pick<BacklogRequest, "trains">,
): BacklogState {
  const unanswered = request.trains
    .map((train) => train.key)
    .filter((key) => !state.trains.has(key));
  return {
    ...state,
    missing: new Set([...state.missing, ...unanswered]),
    done: true,
  };
}

/** Resolves true after `ms`, or false at once when `signal` aborts. */
function wait(ms: number, signal: AbortSignal): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", stop);
      resolve(true);
    }, ms);
    const stop = () => {
      clearTimeout(timer);
      resolve(false);
    };
    signal.addEventListener("abort", stop, { once: true });
  });
}

async function read(
  body: string,
  signal: AbortSignal,
  onEvent: (event: BacklogEvent) => void,
): Promise<void> {
  try {
    const response = await fetch("/api/backlog", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      signal,
    });
    if (!response.ok || !response.body) {
      return;
    }
    const reader = response.body
      .pipeThrough(new TextDecoderStream())
      .getReader();
    let buffered = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }
      buffered += value;
      const lines = buffered.split("\n");
      buffered = lines.pop() ?? "";
      for (const line of lines) {
        if (line.trim()) {
          onEvent(JSON.parse(line) as BacklogEvent);
        }
      }
    }
  } catch {
    // An aborted or broken answer keeps what arrived. The figures stay Darwin's for the rest.
  }
}

/**
 * Adds one event to the state. A later attempt sends again what the server stored, so a
 * train answered is no longer missing and a run already held is not added twice.
 */
export function apply(state: BacklogState, event: BacklogEvent): BacklogState {
  switch (event.type) {
    case "train": {
      const trains = new Map(state.trains);
      trains.set(event.key, { byDay: event.byDay, runCount: event.runCount });
      const missing = new Set(state.missing);
      missing.delete(event.key);
      return { ...state, trains, missing };
    }
    case "missing": {
      const keys = event.keys.filter((key) => !state.trains.has(key));
      return keys.length === 0
        ? state
        : { ...state, missing: new Set([...state.missing, ...keys]) };
    }
    case "runs": {
      const held = new Set(state.runs.map((run) => run.id));
      const runs = event.runs.filter((run) => !held.has(run.id));
      return runs.length === 0
        ? state
        : { ...state, runs: [...state.runs, ...runs] };
    }
    case "end":
      // The attempt's end; the hook decides whether another follows.
      return state;
  }
}
