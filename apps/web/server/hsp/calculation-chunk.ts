/**
 * One slice of a calculation. `calculation-lock.ts` decides who may run;
 * this file says how long that slice may call HSP, and keeps a second
 * slice of the same service from starting in this process.
 */

/** How long one request may call HSP before it must return and let the page continue. */
export const CHUNK_BUDGET_MS = 10_000;

/** Longer than a chunk, so a crashed holder does not block the service. */
export const LEASE_MS = 20_000;

export type ProcessGate = {
  tryAcquire(key: string, owner: string, now: number, holdMs: number): boolean;
  release(key: string, owner: string): void;
};

/** One holder per key in this process. A live lease refuses a second acquire. */
export function createProcessGate(): ProcessGate {
  const held = new Map<string, { owner: string; until: number }>();
  return {
    tryAcquire(key, owner, now, holdMs) {
      const current = held.get(key);
      if (current && current.until > now) {
        return false;
      }
      held.set(key, { owner, until: now + holdMs });
      return true;
    },
    release(key, owner) {
      const current = held.get(key);
      if (current?.owner === owner) {
        held.delete(key);
      }
    },
  };
}

export const processGate = createProcessGate();

/**
 * A chunk that saved nothing and then failed is shown as that failure.
 * A chunk that stored some runs, ran out of time, or met a busy source asks the page to continue.
 */
export function chunkDecision(input: {
  resolved: number;
  total: number;
  savedThisChunk: number;
  failed: boolean;
  busy?: boolean;
}): "complete" | "working" | "failed" {
  if (input.resolved >= input.total) {
    return "complete";
  }
  if (input.failed && !input.busy && input.savedThisChunk === 0) {
    return "failed";
  }
  return "working";
}
