import { addCalendarDays, londonIsoDate } from "@railscore/core";

export const MAX_ATTEMPTS = 4;
export const BUSY_PAUSE_MS = 5_000;
const MAX_RETRY_AFTER_MS = 10_000;
const MAX_BUSY_PAUSE_MS = 15_000;

/** A run is re-fetched until it was stored at least this many days after it ran. */
const SETTLED_AFTER_DAYS = 3;
export const RECENT_RUN_REFRESH_MS = 6 * 60 * 60 * 1000;

export function isRetryableStatus(status: number): boolean {
  return status === 429 || status === 502 || status === 503 || status === 504;
}

/** A list call refused on its own waits this long, then tries again while the search still has time. */
const LIST_BUSY_RETRY_MIN_MS = 2_000;
const LIST_BUSY_RETRY_MAX_MS = 4_000;

export function listBusyRetryMs(random: () => number = Math.random): number {
  return Math.round(
    LIST_BUSY_RETRY_MIN_MS +
      random() * (LIST_BUSY_RETRY_MAX_MS - LIST_BUSY_RETRY_MIN_MS),
  );
}

/** A 429 or 503 waits, then gets one more try. A numeric Retry-After can extend the wait. */
export function busyPauseMs(retryAfter: string | null): number {
  const seconds =
    retryAfter === null || retryAfter.trim() === ""
      ? Number.NaN
      : Number(retryAfter);
  if (Number.isFinite(seconds) && seconds * 1000 > BUSY_PAUSE_MS) {
    return Math.min(seconds * 1000, MAX_BUSY_PAUSE_MS);
  }
  return BUSY_PAUSE_MS;
}

/** `attempt` starts at 0. Honours a numeric Retry-After, otherwise exponential backoff with jitter. */
export function retryDelayMs(
  attempt: number,
  retryAfter: string | null,
  random: () => number = Math.random,
): number {
  const seconds =
    retryAfter === null || retryAfter.trim() === ""
      ? Number.NaN
      : Number(retryAfter);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(seconds * 1000, MAX_RETRY_AFTER_MS);
  }
  return Math.round(500 * 2 ** attempt * (0.5 + random()));
}

export type TokenBucket = { tokens: number; updatedAt: number };

/** Takes one token when the bucket has one. Idle time refills it, up to `capacity`. */
export function takeToken(
  bucket: TokenBucket,
  now: number,
  perSecond: number,
  capacity: number,
): boolean {
  const tokens = Math.min(
    capacity,
    bucket.tokens + ((now - bucket.updatedAt) / 1000) * perSecond,
  );
  bucket.updatedAt = now;
  if (tokens < 1) {
    bucket.tokens = tokens;
    return false;
  }
  bucket.tokens = tokens - 1;
  return true;
}

/**
 * List calls in flight at once, across every server instance, when
 * `HSP_LIST_SLOT_COUNT` is unset. Two run side by side; a third draws 503s,
 * and each of the two slows as HSP shares its time.
 */
export const LIST_SLOT_COUNT = 2;
/** List calls that start together all draw 503s. Staggered by this much, two both run. */
export const LIST_START_GAP_MS = 1_500;
/**
 * A holder that stopped frees its slot. Short enough that a stuck claim does not
 * block the next search for a minute, and renewed while a live call is still running.
 */
export const LIST_SLOT_LEASE_MS = 35_000;

export type ListSlot = {
  owner?: string;
  startedAt: number;
  leasedUntil: number;
};

/** Takes a free slot for `owner`, unless another list call started under `gapMs` ago. */
export function takeListSlot(
  slots: ListSlot[],
  owner: string,
  now: number,
  gapMs: number,
  leaseMs: number,
): number | undefined {
  if (slots.some((slot) => now - slot.startedAt < gapMs)) {
    return undefined;
  }
  const index = slots.findIndex((slot) => slot.leasedUntil <= now);
  if (index === -1) {
    return undefined;
  }
  slots[index] = { owner, startedAt: now, leasedUntil: now + leaseMs };
  return index;
}

export function releaseListSlot(
  slots: ListSlot[],
  index: number,
  owner: string,
  now: number,
): void {
  const slot = slots[index];
  if (slot?.owner === owner) {
    slots[index] = { startedAt: slot.startedAt, leasedUntil: now };
  }
}

/** An unreadable detail is withheld data, not a settled run. Retry it after a few hours. */
export function isUnreadablePlaceholderReusable(
  fetchedAt: Date,
  now: Date,
): boolean {
  return now.getTime() - fetchedAt.getTime() < RECENT_RUN_REFRESH_MS;
}

/** HSP may complete a recent day late, so a run stored soon after it ran is only trusted for a few hours. */
export function isStoredRunReusable(
  serviceDate: string,
  fetchedAt: Date,
  now: Date,
): boolean {
  if (
    londonIsoDate(fetchedAt) >= addCalendarDays(serviceDate, SETTLED_AFTER_DAYS)
  ) {
    return true;
  }
  return now.getTime() - fetchedAt.getTime() < RECENT_RUN_REFRESH_MS;
}
