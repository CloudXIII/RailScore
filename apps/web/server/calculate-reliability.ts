import "server-only";
import {
  calculateReliability,
  type HistoricalRun,
  type ReliabilityResult,
} from "@railscore/core";
import { loadSettledDarwinRuns } from "./darwin/store";
import { database } from "./db";
import { reliabilityByDayType, type DayTypeResult } from "./day-split";
import { usesMockData } from "./env";
import { mockRuns } from "./mock/catalogue";
import {
  historicalRunFromDetails,
  matchesServiceKey,
  serviceDateOf,
  type ScheduledService,
} from "./services/map";

type ServiceCalculation = {
  readonly result: ReliabilityResult;
  readonly byDay: readonly DayTypeResult[];
};

/**
 * Reliability of one train from its stored Darwin runs. A run with no settled Darwin record,
 * such as one from before the import began or lost from the feed, has no known outcome.
 */
export async function calculateService(input: {
  service: ScheduledService;
  boardingCrs: string;
  destinationCrs: string;
  now?: Date;
}): Promise<ServiceCalculation> {
  if (usesMockData()) {
    return summarise(mockRuns(input.service));
  }
  const rids = input.service.rids;
  const sql = database();
  const stored =
    sql && rids.length > 0
      ? await loadSettledDarwinRuns(sql, rids, input.now ?? new Date())
      : new Map<string, unknown>();
  const stations = {
    boardingCrs: input.boardingCrs,
    destinationCrs: input.destinationCrs,
  };
  return summarise(
    rids.map((rid) => {
      const payload = stored.get(rid);
      return payload === undefined
        ? missingRun(rid)
        : historicalRunFromDetails(payload, stations, rid);
    }),
  );
}

export function findSelectedService(
  services: readonly ScheduledService[],
  key: string,
): ScheduledService | undefined {
  return services.find((service) => matchesServiceKey(service, key));
}

function missingRun(rid: string): HistoricalRun {
  const serviceDate = serviceDateOf({}, rid);
  return serviceDate
    ? { id: rid, serviceDate, outcome: "missing_actual" }
    : { id: rid, outcome: "missing_actual" };
}

function summarise(runs: readonly HistoricalRun[]): ServiceCalculation {
  return {
    result: calculateReliability(runs),
    byDay: reliabilityByDayType(runs),
  };
}
