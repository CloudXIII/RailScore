import type { StoredCall } from "../call-text";
import type { TrustActivation, TrustMovement } from "./movements";
import stanoxCrs from "./stanox-crs.json";

/**
 * Matches TRUST trains to Darwin runs (RIDs). An activation names the train's schedule UID and
 * start day, the same as a run's `uid` and service date. A train whose activation came before
 * the capture is matched by its calls instead: station (STANOX mapped to CRS) and public time,
 * among runs of the day the train ID ends with, needing two calls and a clear winner.
 */

/** A Darwin run as the matching needs it. */
export type CandidateRun = {
  readonly rid: string;
  readonly uid: string;
  readonly serviceDate: string;
  readonly calls: readonly StoredCall[];
};

const CRS_BY_STANOX: Readonly<Record<string, string>> = stanoxCrs;

export function crsOfStanox(stanox: string): string | undefined {
  return CRS_BY_STANOX[stanox];
}

/** Calls of a run whose public time for this event is the movement's, at its station when known. */
export function callsAtTime(
  calls: readonly StoredCall[],
  movement: TrustMovement,
  crsOf: (stanox: string) => string | undefined = crsOfStanox,
): number[] {
  const crs = crsOf(movement.stanox);
  const hits: number[] = [];
  calls.forEach((call, index) => {
    const planned = movement.event === "arrival" ? call.pta : call.ptd;
    if (planned === movement.planned && (!crs || call.crs === crs)) {
      hits.push(index);
    }
  });
  return hits;
}

/** Calls of one run a train must match by station and time. */
const VOTES_NEEDED = 2;

/**
 * RID by train ID. A RID claimed by two trains goes to neither, as does a train whose vote ties.
 * `movements` are each train's latest reports (`latestMovements`).
 */
export function matchTrains(
  runs: readonly CandidateRun[],
  activations: readonly TrustActivation[],
  movements: ReadonlyMap<string, readonly TrustMovement[]>,
  crsOf: (stanox: string) => string | undefined = crsOfStanox,
): Map<string, string> {
  const matched = new Map<string, string>();
  const byUid = new Map<string, string[]>();
  for (const run of runs) {
    const key = `${run.uid}|${run.serviceDate}`;
    byUid.set(key, [...(byUid.get(key) ?? []), run.rid]);
  }
  const activationOf = new Map(
    activations.map((activation) => [activation.trainId, activation]),
  );
  for (const trainId of movements.keys()) {
    const activation = activationOf.get(trainId);
    const rids =
      activation && byUid.get(`${activation.uid}|${activation.date}`);
    if (rids?.length === 1) {
      matched.set(trainId, rids[0]!);
    }
  }

  const index = new Map<string, Set<string>>();
  for (const run of runs) {
    for (const call of run.calls) {
      for (const [event, time] of [
        ["arrival", call.pta],
        ["departure", call.ptd],
      ] as const) {
        if (time) {
          const key = `${call.crs}|${event}|${time}`;
          let rids = index.get(key);
          if (!rids) {
            rids = new Set();
            index.set(key, rids);
          }
          rids.add(run.rid);
        }
      }
    }
  }
  const claimed = new Set(matched.values());
  const voted = new Map<string, string>();
  const votersOf = new Map<string, number>();
  for (const [trainId, trainMovements] of movements) {
    if (matched.has(trainId)) {
      continue;
    }
    // A TRUST train ID ends with the day of the month the train started; a RID starts with
    // its date, so the same timetable on another day is left out.
    const day = trainId.slice(8, 10);
    const tally = new Map<string, number>();
    for (const movement of trainMovements) {
      const crs = crsOf(movement.stanox);
      if (!crs) {
        continue;
      }
      for (const rid of index.get(
        `${crs}|${movement.event}|${movement.planned}`,
      ) ?? []) {
        if (rid.slice(6, 8) === day) {
          tally.set(rid, (tally.get(rid) ?? 0) + 1);
        }
      }
    }
    const [first, second] = [...tally].sort(
      (left, right) => right[1] - left[1],
    );
    if (
      first &&
      first[1] >= VOTES_NEEDED &&
      (!second || second[1] < first[1]) &&
      !claimed.has(first[0])
    ) {
      voted.set(trainId, first[0]);
      votersOf.set(first[0], (votersOf.get(first[0]) ?? 0) + 1);
    }
  }
  for (const [trainId, rid] of voted) {
    if (votersOf.get(rid) === 1) {
      matched.set(trainId, rid);
    }
  }
  return matched;
}
