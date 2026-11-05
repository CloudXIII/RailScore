import {
  clockMinutes,
  dateOfRid,
  formatHhmm,
  NO_RUNS,
  sumTallies,
  type PunctualityTally,
} from "@railscore/core";
import type { EarlierDaysLeg, EarlierDaysTrain } from "@/shared/contracts";
import type { HspService } from "./metrics";

/** A quarter-hour of departures, both ends inclusive, HHMM. */
export type Quarter = { readonly fromTime: string; readonly toTime: string };

/** The quarter-hour a departure falls in: 07:07 is 0700–0714. */
export function quarterOf(hhmm: string): Quarter {
  const start = Math.floor(clockMinutes(hhmm) / 15) * 15;
  return { fromTime: formatHhmm(start), toTime: formatHhmm(start + 14) };
}

/** Quarter-hours the trains leave in, earliest first, each once. */
export function quartersOf(trains: readonly EarlierDaysTrain[]): Quarter[] {
  const starts = new Set(
    trains.flatMap((train) =>
      train.legs.map((leg) => quarterOf(leg.publicDeparture).fromTime),
    ),
  );
  return [...starts].sort().map((fromTime) => quarterOf(fromTime));
}

export type TrainEarlierDays = {
  readonly counts: PunctualityTally;
  readonly rids: readonly string[];
};

/**
 * HSP trains joined to the listed trains. A train is the same when the operator, origin,
 * departure from the boarding station and destination match the train or a schedule folded
 * into it. Darwin and HSP read the same timetable, so the times agree to the minute. When
 * the origin differs, as when Darwin has no station code for the first call, the one listed
 * train with the same operator, departure and destination is taken.
 *
 * An HSP train left over is then the same train for the passenger when it is the one listed
 * train with the same operator, departure and arrival at the searched stations, and runs on
 * none of the days already joined to it: a train that ran to or from somewhere else for a
 * week of works, as the 07:50 Paddington to Great Malvern ending at Worcester Shrub Hill.
 * Two portions of one train run on the same days, so they stay apart.
 *
 * Counts of every HSP train joined to one listed train are added. An HSP train with no count
 * adds none, and one that joins no listed train is left out.
 */
export function matchEarlierDays(
  trains: readonly EarlierDaysTrain[],
  services: readonly HspService[],
): Map<string, TrainEarlierDays> {
  const joined = new Map<
    string,
    { counts: PunctualityTally; rids: string[] }
  >();
  const join = (train: EarlierDaysTrain, service: HspService) => {
    const current = joined.get(train.key) ?? { counts: NO_RUNS, rids: [] };
    joined.set(train.key, {
      counts: sumTallies([current.counts, service.counts]),
      rids: [...current.rids, ...service.rids],
    });
  };
  const leftOver: HspService[] = [];
  for (const service of services) {
    const train = matchingTrain(trains, service);
    if (train) {
      join(train, service);
    } else {
      leftOver.push(service);
    }
  }
  for (const service of leftOver) {
    const train = samePassengerTrain(trains, service);
    if (!train || service.rids.length === 0) {
      continue;
    }
    const days = new Set((joined.get(train.key)?.rids ?? []).map(dayOfRid));
    if (service.rids.some((rid) => days.has(dayOfRid(rid)))) {
      continue;
    }
    join(train, service);
  }
  return joined;
}

/** The one listed train leaving and arriving at the searched stations at the same times. */
function samePassengerTrain(
  trains: readonly EarlierDaysTrain[],
  service: HspService,
): EarlierDaysTrain | undefined {
  if (!service.publicArrival) {
    return undefined;
  }
  const candidates = trains.filter(
    (train) =>
      train.operatorCode === service.operatorCode &&
      train.legs.some(
        (leg) =>
          leg.publicDeparture === service.publicDeparture &&
          leg.publicArrival === service.publicArrival,
      ),
  );
  return candidates.length === 1 ? candidates[0] : undefined;
}

/** The service date a RID starts with. A RID without one stands for its own day. */
function dayOfRid(rid: string): string {
  return dateOfRid(rid) ?? rid;
}

function matchingTrain(
  trains: readonly EarlierDaysTrain[],
  service: HspService,
): EarlierDaysTrain | undefined {
  const sameRun = (leg: EarlierDaysLeg) =>
    leg.publicDeparture === service.publicDeparture &&
    leg.destinationCrs === service.destinationCrs;
  const candidates = trains.filter(
    (train) =>
      train.operatorCode === service.operatorCode && train.legs.some(sameRun),
  );
  const exact = candidates.find((train) =>
    train.legs.some(
      (leg) => sameRun(leg) && leg.originCrs === service.originCrs,
    ),
  );
  return exact ?? (candidates.length === 1 ? candidates[0] : undefined);
}
