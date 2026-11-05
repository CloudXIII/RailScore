import { signedLatenessMinutes } from "./civil-time";
import type { HistoricalRun } from "./reliability";

/**
 * One public call of a run, as recorded. Times are HHMM; a time not given is absent.
 * Each feed is translated into this shape before any rule reads it.
 */
export type Call = {
  readonly crs: string;
  /** Public (timetabled) arrival and departure. */
  readonly pta?: string;
  readonly ptd?: string;
  /** Actual arrival and departure. */
  readonly ata?: string;
  readonly atd?: string;
  /** Darwin cancelled this call. */
  readonly cancelled?: boolean;
  /**
   * HSP's late or cancellation reason code at this call; HSP does not say which kind it is.
   * `""` when HSP gave a code that was not kept.
   */
  readonly reason?: string;
};

/** The stations a passenger boards and leaves at. */
export type Journey = {
  readonly boardingCrs: string;
  readonly destinationCrs: string;
};

/** Where in a run's calls the passenger boards and leaves. Absent when the run has no such call. */
export type PassengerLeg = {
  readonly boarding?: number;
  readonly destination?: number;
};

/**
 * The calls a passenger boards and leaves at, as indexes into `calls`.
 *
 * The destination is the first call there after boarding, preferring one with a public
 * arrival, so a train that starts and ends at the same station, such as Waterloo round the
 * Kingston loop, is read at its arrival and not at its departure. Boarding is the last call
 * with a public departure from the boarding station before that, so a train that passes
 * Clapham Junction twice is boarded the second time. Darwin can repeat a call at the end of a
 * run when its schedule changes: when the destination has no actual arrival, a later call
 * there with the same public arrival that has one is taken instead.
 */
export function passengerLeg(
  calls: readonly Call[],
  journey: Journey,
): PassengerLeg {
  const isBoarding = (call: Call) => call.crs === journey.boardingCrs;
  const isDestination = (call: Call) => call.crs === journey.destinationCrs;
  const departing = calls.findIndex((call) => isBoarding(call) && call.ptd);
  const firstBoarding =
    departing === -1 ? calls.findIndex(isBoarding) : departing;
  const after = (call: Call, index: number) => index > firstBoarding;
  const withArrival = calls.findIndex(
    (call, index) => after(call, index) && isDestination(call) && call.pta,
  );
  const destination =
    withArrival === -1
      ? calls.findIndex(
          (call, index) => after(call, index) && isDestination(call),
        )
      : withArrival;
  if (destination === -1) {
    return firstBoarding === -1 ? {} : { boarding: firstBoarding };
  }
  let boarding = firstBoarding;
  for (let index = firstBoarding + 1; index < destination; index += 1) {
    if (isBoarding(calls[index]!) && calls[index]!.ptd) {
      boarding = index;
    }
  }
  const first = calls[destination]!;
  const repeated = first.ata
    ? -1
    : calls.findIndex(
        (call, index) =>
          index > destination &&
          isDestination(call) &&
          call.pta === first.pta &&
          call.ata,
      );
  return {
    ...(boarding === -1 ? {} : { boarding }),
    destination: repeated === -1 ? destination : repeated,
  };
}

/**
 * How one run went for a passenger on `journey`. No feed has a cancellation flag for the
 * whole run, so it is read from the calls:
 *
 * - **Arrived** when the destination has an actual arrival, unless the passenger could not
 *   board: a public departure from the boarding station with no actual departure, including a
 *   train that ran through and left only a passing time. That is a missed call.
 * - **Cancelled** when no call has an actual time.
 * - **Did not call** when some call has an actual time and the destination was cancelled or
 *   has a reason code.
 * - **Missing actual** otherwise: the outcome is unknown and left out of every figure.
 *
 * A Darwin run with no movement seen at all should be read as unknown before it gets here,
 * since Darwin may simply not have seen it; HSP recorded the whole day.
 */
export function classifyRun(
  run: {
    readonly id: string;
    readonly serviceDate?: string;
    readonly calls: readonly Call[];
  },
  journey: Journey,
): HistoricalRun {
  const base = run.serviceDate
    ? { id: run.id, serviceDate: run.serviceDate }
    : { id: run.id };
  const leg = passengerLeg(run.calls, journey);
  if (leg.destination === undefined) {
    return { ...base, outcome: "missing_actual" };
  }
  const destination = run.calls[leg.destination]!;
  const boarding =
    leg.boarding === undefined ? undefined : run.calls[leg.boarding];
  if (!destination.ata) {
    return { ...base, outcome: notArrived(run.calls, destination) };
  }
  if (!destination.pta) {
    return { ...base, outcome: "missing_actual" };
  }
  if (boarding && !departedFrom(boarding)) {
    return { ...base, outcome: "did_not_call" };
  }
  try {
    return {
      ...base,
      outcome: "arrived",
      latenessMinutes: signedLatenessMinutes(destination.pta, destination.ata),
    };
  } catch {
    return { ...base, outcome: "missing_actual" };
  }
}

/** A call Darwin cancelled, or one HSP gave a reason code for. */
function isFlagged(call: Call): boolean {
  return call.cancelled === true || call.reason !== undefined;
}

/** Outcome of a run with no actual arrival at the destination. */
function notArrived(
  calls: readonly Call[],
  destination: Call,
): "cancelled" | "did_not_call" | "missing_actual" {
  if (!calls.some(hasActual)) {
    return "cancelled";
  }
  return isFlagged(destination) ? "did_not_call" : "missing_actual";
}

function departedFrom(call: Call): boolean {
  if (call.ptd) {
    return Boolean(call.atd);
  }
  return hasActual(call) || !isFlagged(call);
}

function hasActual(call: Call): boolean {
  return Boolean(call.ata || call.atd);
}
