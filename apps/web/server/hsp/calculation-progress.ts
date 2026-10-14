/** Headline figures from the runs saved so far. */
export type ProvisionalFigures = {
  readonly onTimePercentage: number;
  readonly cancelledPercentage: number;
  /** Runs with a known outcome behind the figures. */
  readonly known: number;
};

type Progress = {
  saved: number;
  total: number;
  updatedAt: number;
  provisional?: ProvisionalFigures;
};

type Store = Map<string, Progress>;

const STALE_MS = 3 * 60 * 1000;

function store(): Store {
  const g = globalThis as typeof globalThis & {
    __railscoreCalculationProgress?: Store;
  };
  g.__railscoreCalculationProgress ??= new Map();
  return g.__railscoreCalculationProgress;
}

/** Latest run count for one service, so the waiting page can show it while HSP is still being called. */
export function noteCalculationProgress(
  serviceKey: string,
  saved: number,
  total: number,
  provisional?: ProvisionalFigures,
): void {
  store().set(serviceKey, {
    saved,
    total,
    updatedAt: Date.now(),
    ...(provisional ? { provisional } : {}),
  });
}

export function readCalculationProgress(
  serviceKey: string,
  now = Date.now(),
): Progress | undefined {
  const row = store().get(serviceKey);
  if (!row || now - row.updatedAt > STALE_MS || row.total <= 0) {
    return undefined;
  }
  return { ...row, saved: Math.min(row.saved, row.total) };
}

/** Drop a previous calculation so the next wait does not show its finished count. */
export function clearCalculationProgress(serviceKey: string): void {
  store().delete(serviceKey);
}
