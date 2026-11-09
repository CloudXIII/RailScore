import "server-only";
import {
  calculateReliability,
  dateOfRid,
  londonIsoDate,
  type HistoricalRun,
} from "@railscore/core";
import type { ScheduledService } from "@/shared/scheduled-service";
import type { ServiceCalculation, TrainSource } from "../train-source";
import { findDarwinServices } from "./find";
import { historicalRunFromDarwin, type DarwinRun } from "./run";

/** The next trains of today's Darwin timetable from the searched time, with their stored runs. */
export const darwinSource: TrainSource = {
  sample: false,
  async findServices(query) {
    const now = query.now ?? new Date();
    const found = await findDarwinServices(query, now);
    const stations = {
      boardingCrs: query.fromCrs,
      destinationCrs: query.toCrs,
    };
    return {
      services: found.services,
      retired: found.retired,
      ...(found.overnight ? { overnight: found.overnight } : {}),
      period: found.period,
      ...(found.earlier ? { earlier: found.earlier } : {}),
      ...(found.later ? { later: found.later } : {}),
      ...(found.laterDays ? { laterDays: found.laterDays } : {}),
      ...(found.hsp ? { hsp: found.hsp } : {}),
      calculate: (service) =>
        calculateFromDarwin(service, stations, found.runs, now),
    };
  },
};

/**
 * Reliability of one train from the Darwin runs its search read. A run of today may still be
 * under way, and a RID with no stored run (lost from the feed) has no known outcome.
 */
export function calculateFromDarwin(
  service: ScheduledService,
  stations: { boardingCrs: string; destinationCrs: string },
  runs: ReadonlyMap<string, DarwinRun>,
  now: Date,
): ServiceCalculation {
  const today = londonIsoDate(now);
  const classified = service.rids.map((rid) => {
    const run = runs.get(rid);
    return run && run.serviceDate < today
      ? historicalRunFromDarwin(run, stations)
      : missingRun(rid);
  });
  return { result: calculateReliability(classified), runs: classified };
}

function missingRun(rid: string): HistoricalRun {
  const serviceDate = dateOfRid(rid);
  return serviceDate
    ? { id: rid, serviceDate, outcome: "missing_actual" }
    : { id: rid, outcome: "missing_actual" };
}
