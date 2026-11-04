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
  /** Trains HSP gave nothing for. Their figures are Darwin's alone. */
  readonly missing: ReadonlySet<string>;
  readonly runs: readonly HistoricalRun[];
  /** True once the answer has ended, or failed. */
  readonly done: boolean;
};

const EMPTY: BacklogState = {
  trains: new Map(),
  missing: new Set(),
  runs: [],
  done: false,
};

const DONE: BacklogState = { ...EMPTY, done: true };

/**
 * Streams HSP's figures for the days before Darwin, one event per line, into state as they
 * arrive. No request (HSP not needed) is done at once. A failed request ends with what came.
 */
export function useBacklog(request: BacklogRequest | undefined): BacklogState {
  const body = request ? JSON.stringify(request) : "";
  const [state, setState] = useState<BacklogState>(body ? EMPTY : DONE);

  useEffect(() => {
    if (!body) {
      setState(DONE);
      return;
    }
    setState(EMPTY);
    const controller = new AbortController();
    void read(body, controller.signal, (event) =>
      setState((current) => apply(current, event)),
    ).finally(() => {
      if (!controller.signal.aborted) {
        setState((current) => ({ ...current, done: true }));
      }
    });
    return () => controller.abort();
  }, [body]);

  return state;
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

function apply(state: BacklogState, event: BacklogEvent): BacklogState {
  switch (event.type) {
    case "train": {
      const trains = new Map(state.trains);
      trains.set(event.key, { byDay: event.byDay, runCount: event.runCount });
      return { ...state, trains };
    }
    case "missing":
      return { ...state, missing: new Set([...state.missing, ...event.keys]) };
    case "runs":
      return { ...state, runs: [...state.runs, ...event.runs] };
    case "end":
      return { ...state, done: true };
  }
}
