import type { HistoricalRun, PunctualityTally } from "@railscore/core";
import type { DayPattern, ServiceDay } from "./day-type";

/**
 * What the page and `/api/earlier-days` exchange: the request body, and the newline-delimited
 * events of the answer. Types only, shared by the client hook and the server.
 */

/** One public schedule of a listed train: the train itself or a schedule folded into it. */
export type EarlierDaysLeg = {
  readonly originCrs: string;
  readonly destinationCrs: string;
  /** Departure from the boarding station, HHMM. */
  readonly publicDeparture: string;
  /** Arrival at the searched destination, HHMM. Absent from pages sent before it was asked. */
  readonly publicArrival?: string;
};

/** A listed Darwin train, as the page asks HSP about it. */
export type EarlierDaysTrain = {
  /** The list's service key. */
  readonly key: string;
  readonly operatorCode: string;
  readonly legs: readonly EarlierDaysLeg[];
};

/** What the page asks HSP about: the listed trains, and the train whose runs it shows. */
export type EarlierDaysRequest = {
  readonly fromCrs: string;
  readonly toCrs: string;
  readonly days: DayPattern;
  readonly periodDays: number;
  readonly trains: readonly EarlierDaysTrain[];
  /** Key of the one train whose runs are fetched one by one, for its arrival history. */
  readonly runsOf?: string;
};

export type EarlierDaysEvent =
  /**
   * HSP's counts for one listed train, by day type, before Darwin's first day. HSP counts a
   * run within its high tolerance as arrived.
   */
  | {
      readonly type: "train";
      readonly key: string;
      readonly byDay: Partial<Record<ServiceDay, PunctualityTally>>;
      /** Runs HSP listed for the train, each one fetched for the arrival history. */
      readonly runCount: number;
    }
  /** HSP gave no answer for these trains in time. */
  | { readonly type: "missing"; readonly keys: readonly string[] }
  /** Runs of the history train, newest first, classified by the HSP rules. */
  | { readonly type: "runs"; readonly runs: readonly HistoricalRun[] }
  | { readonly type: "end" };
