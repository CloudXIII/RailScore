/**
 * HSP serviceMetrics: the trains between two stations in a clock window and date range,
 * each with its run identifiers and how many runs arrived within each asked tolerance.
 */

/** Tolerances asked for, in minutes late at the destination. A high one counts every arrival. */
export const METRIC_TOLERANCES = ["5", "14", "29", "999"] as const;

/**
 * Runs of one HSP train in the period by arrival. `runs` includes cancellations and runs that
 * did not call at the boarding station, which HSP counts outside every tolerance.
 * `arrived` is every run within the high tolerance: it reached the destination.
 */
export type HspCounts = {
  readonly runs: number;
  readonly within5: number;
  readonly within14: number;
  readonly within29: number;
  readonly arrived: number;
};

export type HspService = {
  readonly originCrs: string;
  readonly destinationCrs: string;
  /** Public departure from the searched boarding station, HHMM. */
  readonly publicDeparture: string;
  readonly publicArrival: string;
  readonly operatorCode: string;
  readonly rids: readonly string[];
  /** Absent when a tolerance came back missing or unreadable. */
  readonly counts?: HspCounts;
};

export class HspResponseError extends Error {}

export const NO_COUNTS: HspCounts = {
  runs: 0,
  within5: 0,
  within14: 0,
  within29: 0,
  arrived: 0,
};

/** Reads a serviceMetrics answer. A row with no departure, operator, origin or destination is dropped. */
export function parseServiceMetrics(payload: unknown): HspService[] {
  const root = record(payload);
  if (!root || !Array.isArray(root.Services)) {
    throw new HspResponseError(
      "The service list was not in the expected shape.",
    );
  }
  return root.Services.flatMap((value): HspService[] => {
    const service = record(value);
    const attributes = record(service?.serviceAttributesMetrics);
    const departure = text(attributes?.gbtt_ptd);
    const operator = text(attributes?.toc_code);
    const origin = text(attributes?.origin_location);
    const destination = text(attributes?.destination_location);
    if (!attributes || !departure || !operator || !origin || !destination) {
      return [];
    }
    const rids = Array.isArray(attributes.rids)
      ? attributes.rids.filter((rid): rid is string => typeof rid === "string")
      : [];
    const counts = parseCounts(service?.Metrics);
    return [
      {
        originCrs: origin,
        destinationCrs: destination,
        publicDeparture: departure,
        publicArrival: text(attributes.gbtt_pta),
        operatorCode: operator,
        rids,
        ...(counts ? { counts } : {}),
      },
    ];
  });
}

function parseCounts(value: unknown): HspCounts | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const at = (tolerance: string) => {
    const metric = value
      .map(record)
      .find((entry) => text(entry?.tolerance_value) === tolerance);
    const within = Number(text(metric?.num_tolerance) || Number.NaN);
    const outside = Number(text(metric?.num_not_tolerance) || Number.NaN);
    return Number.isInteger(within) && Number.isInteger(outside)
      ? { within, runs: within + outside }
      : undefined;
  };
  const five = at("5");
  const fourteen = at("14");
  const twentyNine = at("29");
  const all = at("999");
  if (!five || !fourteen || !twentyNine || !all) {
    return undefined;
  }
  return {
    runs: five.runs,
    within5: five.within,
    within14: fourteen.within,
    within29: twentyNine.within,
    arrived: all.within,
  };
}

export function addCounts(
  left: HspCounts,
  right: HspCounts | undefined,
): HspCounts {
  if (!right) {
    return left;
  }
  return {
    runs: left.runs + right.runs,
    within5: left.within5 + right.within5,
    within14: left.within14 + right.within14,
    within29: left.within29 + right.within29,
    arrived: left.arrived + right.arrived,
  };
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function text(value: unknown): string {
  return typeof value === "string"
    ? value.trim()
    : typeof value === "number"
      ? String(value)
      : "";
}
