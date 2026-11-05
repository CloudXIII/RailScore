import type { HistoricalRun } from "@railscore/core";
import type { DayPattern, ServiceDay } from "./day-type";

/**
 * What the page and `/api/backlog` exchange: the request body, and the newline-delimited
 * events of the answer. Types only, shared by the client hook and the server.
 */

/** One public schedule of a listed train: the train itself or a schedule folded into it. */
export type BacklogLeg = {
  readonly originCrs: string;
  readonly destinationCrs: string;
  /** Departure from the boarding station, HHMM. */
  readonly publicDeparture: string;
  /** Arrival at the searched destination, HHMM. Absent from pages sent before it was asked. */
  readonly publicArrival?: string;
};

/** A listed Darwin train, as the page asks HSP about it. */
export type BacklogTrain = {
  /** The list's service key. */
  readonly key: string;
  readonly operatorCode: string;
  readonly legs: readonly BacklogLeg[];
};

/** What the page asks HSP about: the listed trains, and the train whose runs it shows. */
export type BacklogRequest = {
  readonly fromCrs: string;
  readonly toCrs: string;
  readonly days: DayPattern;
  readonly periodDays: number;
  readonly trains: readonly BacklogTrain[];
  /** Key of the one train whose runs are fetched one by one, for its arrival history. */
  readonly runsOf?: string;
};

/**
 * Runs of one HSP train in the period by arrival. `runs` includes cancellations and runs that
 * did not call at the boarding station, which HSP counts outside every tolerance.
 * `arrived` is every run within the high tolerance: it reached the destination.
 */
export type HspCounts = {
  readonly runs: number;
  readonly within5: number;
  readonly within14: number;
  readonly within29: number;
  readonly arrived: number;
};

export type BacklogEvent =
  /** HSP's counts for one listed train, by day type, before Darwin's first day. */
  | {
      readonly type: "train";
      readonly key: string;
      readonly byDay: Partial<Record<ServiceDay, HspCounts>>;
      /** Runs HSP listed for the train, each one fetched for the arrival history. */
      readonly runCount: number;
    }
  /** HSP gave no answer for these trains in time. */
  | { readonly type: "missing"; readonly keys: readonly string[] }
  /** Runs of the history train, newest first, classified by the HSP rules. */
  | { readonly type: "runs"; readonly runs: readonly HistoricalRun[] }
  | { readonly type: "end" };
