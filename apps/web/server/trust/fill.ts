import { minutesApart } from "@railscore/core";
import { encodeCalls, type StoredCall } from "../call-text";
import { callsAtTime, crsOfStanox, type CandidateRun } from "./match";
import type { TrustMovement } from "./movements";

/**
 * Fills the actual times Darwin lacks from matched TRUST movements, and measures how far the
 * two sources agree where both have one. Darwin is never overwritten, a cancelled call is never
 * filled, and only calls whose public time is inside the window are filled.
 */

/** Public times, as UTC epoch ms, whose calls may be filled: `from` included, `to` not. */
export type FillWindow = { readonly from: number; readonly to: number };

/** No window: measure agreement only. */
export const NO_FILL: FillWindow = { from: 0, to: 0 };

/** Lateness TRUST may report for a call to be used, in minutes. */
const EARLIEST = -30;
const LATEST = 600;

export type FillStats = {
  /** Runs whose calls change. */
  runsChanged: number;
  timesFilled: number;
  /** Calls where Darwin and TRUST both have the actual time. */
  overlap: number;
  sameMinute: number;
  withinOneMinute: number;
  /** Movements matching no call, or several, of their run. */
  unmatchedCalls: number;
  /** Lateness outside what the fill accepts. */
  implausible: number;
  cancelled: number;
};

export type RunFill = {
  readonly rid: string;
  readonly before: string;
  readonly after: string;
};

export function fillRuns(
  runs: ReadonlyMap<string, CandidateRun>,
  matched: ReadonlyMap<string, string>,
  movements: ReadonlyMap<string, readonly TrustMovement[]>,
  window: FillWindow,
  crsOf: (stanox: string) => string | undefined = crsOfStanox,
): { fills: RunFill[]; stats: FillStats } {
  const stats: FillStats = {
    runsChanged: 0,
    timesFilled: 0,
    overlap: 0,
    sameMinute: 0,
    withinOneMinute: 0,
    unmatchedCalls: 0,
    implausible: 0,
    cancelled: 0,
  };
  const changed = new Map<string, StoredCall[]>();
  for (const [trainId, rid] of matched) {
    const run = runs.get(rid);
    if (!run) {
      continue;
    }
    for (const movement of movements.get(trainId) ?? []) {
      const calls = changed.get(rid) ?? [...run.calls];
      const hits = callsAtTime(calls, movement, crsOf);
      if (hits.length !== 1) {
        stats.unmatchedCalls += 1;
        continue;
      }
      const index = hits[0]!;
      const call = calls[index]!;
      if (movement.lateness < EARLIEST || movement.lateness > LATEST) {
        stats.implausible += 1;
        continue;
      }
      const stored = run.calls[index]!;
      const darwin = movement.event === "arrival" ? stored.ata : stored.atd;
      if (darwin) {
        stats.overlap += 1;
        const apart = minutesApart(darwin, movement.actual);
        if (apart === 0) {
          stats.sameMinute += 1;
        }
        if (apart <= 1) {
          stats.withinOneMinute += 1;
        }
        continue;
      }
      if (movement.plannedAt < window.from || movement.plannedAt >= window.to) {
        continue;
      }
      if (call.cancelled) {
        stats.cancelled += 1;
        continue;
      }
      if (movement.event === "arrival" ? call.ata : call.atd) {
        // Another train ID matched to the same run filled it first.
        continue;
      }
      calls[index] =
        movement.event === "arrival"
          ? { ...call, ata: movement.actual }
          : { ...call, atd: movement.actual };
      changed.set(rid, calls);
      stats.timesFilled += 1;
    }
  }
  const fills: RunFill[] = [];
  for (const [rid, calls] of changed) {
    const before = encodeCalls(runs.get(rid)!.calls);
    const after = encodeCalls(calls);
    if (after !== before) {
      fills.push({ rid, before, after });
    }
  }
  stats.runsChanged = fills.length;
  return { fills, stats };
}

/** What an automatic fill needs. Measured on 25 November 2026: 98% within a minute. */
const FILL_LIMITS = {
  minOverlap: 100,
  minWithinOneMinute: 0.9,
  maxRuns: 20_000,
} as const;

/** Why an automatic fill must not be written; empty when it may. */
export function fillRefusals(stats: FillStats): string[] {
  const refusals: string[] = [];
  if (stats.overlap < FILL_LIMITS.minOverlap) {
    refusals.push(
      `only ${stats.overlap} calls to compare with Darwin, ${FILL_LIMITS.minOverlap} needed`,
    );
  } else if (
    stats.withinOneMinute / stats.overlap <
    FILL_LIMITS.minWithinOneMinute
  ) {
    refusals.push(
      `${percent(stats.withinOneMinute, stats.overlap)} within a minute of Darwin, ${percent(FILL_LIMITS.minWithinOneMinute, 1)} needed`,
    );
  }
  if (stats.runsChanged > FILL_LIMITS.maxRuns) {
    refusals.push(
      `${stats.runsChanged} runs would change, at most ${FILL_LIMITS.maxRuns}`,
    );
  }
  return refusals;
}

function percent(part: number, whole: number): string {
  return `${Math.round((part / whole) * 100)}%`;
}
