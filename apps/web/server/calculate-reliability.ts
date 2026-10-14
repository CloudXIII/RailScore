import "server-only";
import { randomUUID } from "node:crypto";
import {
  calculateReliability,
  type HistoricalRun,
  type ReliabilityResult,
} from "@railscore/core";
import { logHspCalls, usesMockData } from "./env";
import { reliabilityByDayType, type DayTypeResult } from "./day-split";
import {
  noteCalculationProgress,
  type ProvisionalFigures,
} from "./hsp/calculation-progress";
import { acquireCalculation, releaseCalculation } from "./hsp/calculation-lock";
import { HspRequestError, postHsp } from "./hsp/client";
import { DailyLimitError } from "./hsp/daily-limit";
import { CHUNK_BUDGET_MS, chunkDecision } from "./hsp/calculation-chunk";
import {
  historicalRunFromDetails,
  HspResponseError,
  matchesServiceKey,
  serviceKey,
  toHistoricalRun,
  unreadableDetails,
  type ScheduledService,
} from "./hsp/map";
import { loadStoredRuns, saveRun } from "./hsp/run-store";
import { mockRuns } from "./mock/catalogue";

type ServiceCalculation =
  | {
      readonly status: "complete";
      readonly result: ReliabilityResult;
      readonly byDay: readonly DayTypeResult[];
    }
  | {
      readonly status: "working";
      readonly saved: number;
      readonly total: number;
      readonly provisional?: ProvisionalFigures;
    };

/** One page request saves a short slice of runs. The page calls again until every run is stored. */
export async function calculateService(input: {
  service: ScheduledService;
  boardingCrs: string;
  destinationCrs: string;
  /** Key the waiting page polls. It can name a folded schedule rather than the train's own key. */
  progressKey?: string;
  now?: Date;
}): Promise<ServiceCalculation> {
  const stations = {
    boardingCrs: input.boardingCrs,
    destinationCrs: input.destinationCrs,
  };
  if (usesMockData()) {
    return { status: "complete", ...summarise(mockRuns(input.service)) };
  }
  const rids = input.service.rids;
  if (rids.length === 0) {
    return { status: "complete", ...summarise([]) };
  }

  const now = input.now ?? new Date();
  const stored = await loadStoredRuns(rids, now);
  if (resolvedCount(rids, stored) === rids.length) {
    return { status: "complete", ...resultFrom(stored, rids, stations) };
  }

  const key = serviceKey(input.service);
  const progressKey = input.progressKey ?? key;
  noteCalculationProgress(
    progressKey,
    resolvedCount(rids, stored),
    rids.length,
    provisionalFrom(stored, stations),
  );
  const owner = randomUUID();
  const held = await acquireCalculation(key, owner, now.getTime());
  if (!held) {
    return working(stored, rids, stations);
  }

  const deadline = Date.now() + CHUNK_BUDGET_MS;
  let savedThisChunk = 0;
  let failure: unknown;
  try {
    const fresh = await loadStoredRuns(rids, new Date());
    if (rids.every((rid) => fresh.has(rid))) {
      return { status: "complete", ...resultFrom(fresh, rids, stations) };
    }
    const chunk = await fetchMissing(
      rids,
      fresh,
      stations,
      deadline,
      progressKey,
    );
    savedThisChunk = chunk.saved;
    failure = chunk.failure;
  } finally {
    await releaseCalculation(key, owner);
  }

  const after = await loadStoredRuns(rids, new Date());
  const resolved = resolvedCount(rids, after);
  if (failure instanceof DailyLimitError) {
    throw failure;
  }
  const decision = chunkDecision({
    resolved,
    total: rids.length,
    savedThisChunk,
    failed: failure !== undefined,
    busy: failure instanceof HspRequestError && failure.kind === "busy",
  });
  if (decision === "failed") {
    throw failure instanceof Error
      ? failure
      : new Error("Historical data could not be loaded.");
  }
  if (decision === "complete") {
    return { status: "complete", ...resultFrom(after, rids, stations) };
  }
  return working(after, rids, stations);
}

/** Fetches the runs not yet stored, newest first, publishing progress and provisional figures. */
async function fetchMissing(
  rids: readonly string[],
  stored: ReadonlyMap<string, unknown>,
  stations: { boardingCrs: string; destinationCrs: string },
  deadline: number,
  progressKey: string,
): Promise<{ saved: number; failure?: unknown }> {
  const missing = rids
    .filter((rid) => !stored.has(rid))
    .sort((left, right) => right.localeCompare(left));
  const known = new Map(stored);
  const publish = () =>
    noteCalculationProgress(
      progressKey,
      resolvedCount(rids, known),
      rids.length,
      provisionalFrom(known, stations),
    );
  publish();
  const started = Date.now();
  const chunk = await fetchChunk(
    missing,
    stations,
    deadline,
    (rid, payload) => {
      known.set(rid, payload);
      publish();
    },
  );
  if (logHspCalls()) {
    console.info(
      `[calculate] ${progressKey}: fetched=${chunk.saved} of missing=${missing.length} total=${rids.length} chunkMs=${Date.now() - started}`,
    );
  }
  return chunk;
}

/** Shown while runs are still loading, once enough of them have a known outcome. */
const PROVISIONAL_MIN_RUNS = 5;

function provisionalFrom(
  stored: ReadonlyMap<string, unknown>,
  stations: { boardingCrs: string; destinationCrs: string },
): ProvisionalFigures | undefined {
  const runs = [...stored].map(([rid, payload]) =>
    historicalRunFromDetails(payload, stations, rid),
  );
  const result = calculateReliability(runs);
  const onTime = result.withinFiveMinutes.percentage;
  const cancelled = result.cancellationRate.percentage;
  if (
    onTime === null ||
    cancelled === null ||
    result.withinFiveMinutes.total < PROVISIONAL_MIN_RUNS
  ) {
    return undefined;
  }
  return {
    onTimePercentage: onTime,
    cancelledPercentage: cancelled,
    known: result.withinFiveMinutes.total,
  };
}

function working(
  stored: ReadonlyMap<string, unknown>,
  rids: readonly string[],
  stations: { boardingCrs: string; destinationCrs: string },
): ServiceCalculation {
  const provisional = provisionalFrom(stored, stations);
  return {
    status: "working",
    saved: resolvedCount(rids, stored),
    total: rids.length,
    ...(provisional ? { provisional } : {}),
  };
}

export function findSelectedService(
  services: readonly ScheduledService[],
  key: string,
): ScheduledService | undefined {
  return services.find((service) => matchesServiceKey(service, key));
}

function resultFrom(
  stored: ReadonlyMap<string, unknown>,
  rids: readonly string[],
  stations: { boardingCrs: string; destinationCrs: string },
): { result: ReliabilityResult; byDay: DayTypeResult[] } {
  return summarise(
    rids.map((rid) => historicalRunFromDetails(stored.get(rid), stations, rid)),
  );
}

function summarise(runs: readonly HistoricalRun[]): {
  result: ReliabilityResult;
  byDay: DayTypeResult[];
} {
  return {
    result: calculateReliability(runs),
    byDay: reliabilityByDayType(runs),
  };
}

function resolvedCount(
  rids: readonly string[],
  stored: ReadonlyMap<string, unknown>,
): number {
  return rids.filter((rid) => stored.has(rid)).length;
}

/** Two detail calls in flight draw 503s. One at a time stays clear of that. */
async function fetchChunk(
  rids: readonly string[],
  stations: { boardingCrs: string; destinationCrs: string },
  deadline: number,
  onSaved: (rid: string, payload: unknown) => void,
): Promise<{ saved: number; failure?: unknown }> {
  let saved = 0;
  let failure: unknown;
  for (const rid of rids) {
    if (Date.now() >= deadline) {
      break;
    }
    try {
      const payload = await postHsp("/serviceDetails", { rid }, { deadline });
      try {
        toHistoricalRun(payload, stations, rid);
      } catch (error) {
        if (!(error instanceof HspResponseError)) {
          throw error;
        }
        onSaved(rid, await saveUnreadable(rid));
        saved += 1;
        continue;
      }
      await saveRun(rid, payload);
      saved += 1;
      onSaved(rid, payload);
    } catch (error) {
      if (error instanceof HspResponseError) {
        onSaved(rid, await saveUnreadable(rid));
        saved += 1;
        continue;
      }
      failure = error;
      break;
    }
  }
  return failure === undefined ? { saved } : { saved, failure };
}

async function saveUnreadable(rid: string): Promise<unknown> {
  const unread = unreadableDetails(rid);
  await saveRun(rid, unread.payload, unread.serviceDate);
  return unread.payload;
}
