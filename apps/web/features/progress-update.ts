import type { ProvisionalFigures } from "@/server/hsp/calculation-progress";

export type ProgressSnapshot = {
  saved: number;
  total: number;
  provisional?: ProvisionalFigures;
};

/**
 * The next count to show while a calculation is running.
 * A late response must not move the count backwards, and a count from before
 * this wait started is ignored.
 */
export function applyProgressUpdate(
  current: ProgressSnapshot | undefined,
  incoming: {
    saved: number | null;
    total: number | null;
    ageMs: number | null;
    provisional?: ProvisionalFigures | null;
  },
  elapsedMs: number,
): ProgressSnapshot | undefined {
  if (
    typeof incoming.saved !== "number" ||
    typeof incoming.total !== "number" ||
    incoming.total <= 0
  ) {
    return current;
  }
  if (typeof incoming.ageMs === "number" && incoming.ageMs > elapsedMs + 400) {
    return current;
  }
  const saved = Math.min(incoming.saved, incoming.total);
  if (current && current.total === incoming.total && saved < current.saved) {
    return current;
  }
  const provisional = incoming.provisional ?? current?.provisional;
  return provisional
    ? { saved, total: incoming.total, provisional }
    : { saved, total: incoming.total };
}
