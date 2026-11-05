import "server-only";
import { calculateReliability, trailingDays } from "@railscore/core";
import type { TrainSource } from "../train-source";
import { mockRuns, mockServices, shiftClock } from "./catalogue";

/** Made-up trains, so the screens can be tried without a database. */
export const mockSource: TrainSource = {
  sample: true,
  async findServices(query) {
    return {
      services: mockServices(query),
      retired: [],
      period: trailingDays(query.periodDays, query.now ?? new Date()),
      earlier: shiftClock(query.timeHhmm, -60),
      later: shiftClock(query.timeHhmm, 60),
      calculate: (service) => {
        const runs = mockRuns(service);
        return { result: calculateReliability(runs), runs };
      },
    };
  },
};
