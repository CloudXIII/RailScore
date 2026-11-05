import type { PunctualityTally } from "@railscore/core";
import type { ServiceDay } from "./day-type";

/** A listed train, as the server folds it and the page shows it. */
export type ScheduledService = {
  readonly originCrs: string;
  readonly destinationCrs: string;
  readonly publicDeparture: string;
  readonly publicArrival: string;
  readonly operatorCode: string;
  readonly rids: readonly string[];
  readonly days: readonly ServiceDay[];
  /** Other public schedules folded into this train, with their run counts. Absent when there are none. */
  readonly variants?: readonly ServiceVariant[];
  /**
   * Counts of these runs by lateness, for the list. Absent when any part of the train came
   * without one. A run with no actual departure at the boarding stop is outside every
   * tolerance, as in the full calculation: the passenger could not board.
   */
  readonly punctuality?: PunctualityTally;
};

export type ServiceVariant = {
  readonly originCrs: string;
  readonly destinationCrs: string;
  readonly publicDeparture: string;
  readonly publicArrival: string;
  readonly runCount: number;
  readonly rids: readonly string[];
};

/** Minutes either way a departure may differ and still be the same train. */
export const SAME_TRAIN_MINUTES = 2;

export function serviceKey(service: {
  publicDeparture: string;
  publicArrival: string;
  operatorCode: string;
  originCrs: string;
  destinationCrs: string;
}): string {
  return [
    service.publicDeparture,
    service.publicArrival,
    service.operatorCode,
    service.originCrs,
    service.destinationCrs,
  ].join("-");
}

/** True when `key` names this train or one of the schedules folded into it. */
export function matchesServiceKey(
  service: ScheduledService,
  key: string,
): boolean {
  if (serviceKey(service) === key) {
    return true;
  }
  return (service.variants ?? []).some(
    (variant) =>
      serviceKey({ ...variant, operatorCode: service.operatorCode }) === key,
  );
}
