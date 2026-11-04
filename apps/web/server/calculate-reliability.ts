import "server-only";
import {
  calculateReliability,
  type HistoricalRun,
  type ReliabilityResult,
} from "@railscore/core";
import { londonIsoDate } from "@railscore/core";
import { historicalRunFromDarwin, type DarwinRun } from "./darwin/run";
import { reliabilityByDayType, type DayTypeResult } from "./day-split";
import { usesMockData } from "./env";
import { mockRuns } from "./mock/catalogue";
import {
  matchesServiceKey,
  serviceDateOf,
  type ScheduledService,
} from "./services/map";

type ServiceCalculation = {
  readonly result: ReliabilityResult;
  readonly byDay: readonly DayTypeResult[];
};

/**
 * Reliability of one train from the Darwin runs its search read. A run of today may still be
 * under way, and a RID with no stored run (lost from the feed) has no known outcome.
 */
export function calculateService(input: {
  service: ScheduledService;
  boardingCrs: string;
  destinationCrs: string;
  runs: ReadonlyMap<string, DarwinRun>;
  now?: Date;
}): ServiceCalculation {
  if (usesMockData()) {
    return summarise(mockRuns(input.service));
  }
  const today = londonIsoDate(input.now ?? new Date());
  const stations = {
    boardingCrs: input.boardingCrs,
    destinationCrs: input.destinationCrs,
  };
  return summarise(
    input.service.rids.map((rid) => {
      const run = input.runs.get(rid);
      return run && run.serviceDate < today
        ? historicalRunFromDarwin(run, stations)
        : missingRun(rid);
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
