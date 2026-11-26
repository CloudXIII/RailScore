/**
 * When Darwin is in an outage: it still answers, but sends no actual times. On 12 and
 * 25 November 2026 it sent none for hours while Kafka showed no gap, so the snapshot fill could
 * not help. The import notes the newest Darwin message carrying an actual time; this rule turns
 * that into an outage that starts, holds and ends, and the TRUST backup runs while it holds.
 */

/** No actual time for this long, by day, is an outage. */
const QUIET_LIMIT_MS = 20 * 60_000;
/** Actual times must be back this long before an outage ends. */
const RECOVERY_MS = 30 * 60_000;
/** An outage is closed after this long whatever Darwin does. */
const OUTAGE_CAP_MS = 8 * 3_600_000;
/** London hours, from and to, when few trains run: an outage can neither start nor end. */
const NIGHT_FROM_HOUR = 1;
const NIGHT_TO_HOUR = 5;

export type OutageState = {
  /** Newest Darwin message with an actual time. */
  readonly lastActualAt?: Date;
  /** Newest actual time before the outage; kept after the outage closes. */
  readonly outageFrom?: Date;
  /** When the outage closed; unset while it holds. */
  readonly closedAt?: Date;
  /** First import that found actual times back during the outage. */
  readonly okSince?: Date;
};

export type OutageStep = {
  readonly state: OutageState;
  readonly event: "none" | "started" | "ongoing" | "ended" | "capped";
};

export function outageHolds(state: OutageState): boolean {
  return state.outageFrom !== undefined && state.closedAt === undefined;
}

/**
 * The outage after an import. `caughtUp` false (a backlog still being read) changes nothing,
 * so an import that fell behind does not look like an outage.
 */
export function nextOutage(
  state: OutageState,
  now: Date,
  caughtUp: boolean,
): OutageStep {
  const holds = outageHolds(state);
  if (!caughtUp || !state.lastActualAt) {
    return { state, event: holds ? "ongoing" : "none" };
  }
  const quiet = now.getTime() - state.lastActualAt.getTime() > QUIET_LIMIT_MS;
  const night = isLondonNight(now);
  if (!holds) {
    // After a capped outage, wait for actual times to come back before starting another.
    const sameSilence =
      state.outageFrom !== undefined &&
      state.lastActualAt.getTime() <= state.outageFrom.getTime();
    if (!quiet || night || sameSilence) {
      return { state, event: "none" };
    }
    return {
      state: {
        lastActualAt: state.lastActualAt,
        outageFrom: state.lastActualAt,
      },
      event: "started",
    };
  }
  const outageFrom = state.outageFrom!;
  if (now.getTime() - outageFrom.getTime() >= OUTAGE_CAP_MS) {
    return { state: closed(state, now), event: "capped" };
  }
  if (quiet) {
    return {
      state: { lastActualAt: state.lastActualAt, outageFrom },
      event: "ongoing",
    };
  }
  const okSince = state.okSince ?? now;
  if (!night && now.getTime() - okSince.getTime() >= RECOVERY_MS) {
    return { state: closed(state, now), event: "ended" };
  }
  return {
    state: { lastActualAt: state.lastActualAt, outageFrom, okSince },
    event: "ongoing",
  };
}

function closed(state: OutageState, now: Date): OutageState {
  return {
    ...(state.lastActualAt ? { lastActualAt: state.lastActualAt } : {}),
    ...(state.outageFrom ? { outageFrom: state.outageFrom } : {}),
    closedAt: now,
  };
}

const LONDON_HOUR = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London",
  hour: "2-digit",
  hourCycle: "h23",
});

export function londonHour(at: Date): number {
  return Number(LONDON_HOUR.format(at));
}

function isLondonNight(at: Date): boolean {
  const hour = londonHour(at);
  return hour >= NIGHT_FROM_HOUR && hour < NIGHT_TO_HOUR;
}
