/**
 * Reads the parts of Network Rail's Train Movements feed (TRUST) the Darwin backup needs.
 * A Kafka message value is a JSON array of TRUST messages, each `{ header: { msg_type }, body }`.
 * Kept: activations (0001), which name the schedule UID and start day of a train ID, and
 * movements (0003) at a public time, which carry the actual time. Everything else is dropped.
 *
 * TRUST timestamps are epoch milliseconds of UK clock time, as if that clock were UTC: equal to
 * UTC in winter, an hour ahead in summer. Clock times (HHMM) are read straight from them, and
 * `ukClockToUtc` gives the real instant.
 */

/** A train ID's schedule UID and the day it started (`YYYY-MM-DD`). */
export type TrustActivation = {
  readonly trainId: string;
  readonly uid: string;
  readonly date: string;
};

/** A train passing a public time with an actual time. Clock times are HHMM, UK clock. */
export type TrustMovement = {
  readonly trainId: string;
  readonly stanox: string;
  readonly event: "arrival" | "departure";
  /** Public (timetable) time. */
  readonly planned: string;
  readonly actual: string;
  /** The public time as a UTC instant, epoch ms. */
  readonly plannedAt: number;
  /** Whole minutes from the public time to the actual time; early is negative. */
  readonly lateness: number;
};

export type TrustBatch = {
  readonly activations: TrustActivation[];
  readonly movements: TrustMovement[];
};

type TrustMessage = {
  header?: { msg_type?: unknown };
  body?: Record<string, unknown>;
};

/** Reads one Kafka message value. An unreadable value gives nothing. */
export function parseTrustMessage(value: string): TrustBatch {
  const batch: TrustBatch = { activations: [], movements: [] };
  let messages: unknown;
  try {
    messages = JSON.parse(value);
  } catch {
    return batch;
  }
  if (!Array.isArray(messages)) {
    return batch;
  }
  for (const message of messages as TrustMessage[]) {
    const type = message?.header?.msg_type;
    const body = message?.body;
    if (!body) {
      continue;
    }
    if (type === "0001") {
      const activation = activationOf(body);
      if (activation) {
        batch.activations.push(activation);
      }
    } else if (type === "0003") {
      const movement = movementOf(body);
      if (movement) {
        batch.movements.push(movement);
      }
    }
  }
  return batch;
}

function activationOf(
  body: Record<string, unknown>,
): TrustActivation | undefined {
  const trainId = text(body.train_id);
  const uid = text(body.train_uid);
  const date = text(body.tp_origin_timestamp);
  if (!trainId || !uid || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return undefined;
  }
  return { trainId, uid, date };
}

function movementOf(body: Record<string, unknown>): TrustMovement | undefined {
  const trainId = text(body.train_id);
  const stanox = text(body.loc_stanox);
  const event = text(body.event_type);
  const planned = Number(text(body.gbtt_timestamp));
  const actual = Number(text(body.actual_timestamp));
  if (
    !trainId ||
    !stanox ||
    (event !== "ARRIVAL" && event !== "DEPARTURE") ||
    !(planned > 0) ||
    !(actual > 0)
  ) {
    return undefined;
  }
  return {
    trainId,
    stanox,
    event: event === "ARRIVAL" ? "arrival" : "departure",
    planned: clockOf(planned),
    actual: clockOf(actual),
    plannedAt: ukClockToUtc(planned),
    lateness: Math.floor(actual / 60_000) - Math.floor(planned / 60_000),
  };
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** HHMM of a TRUST timestamp. */
function clockOf(ms: number): string {
  const date = new Date(ms);
  return (
    String(date.getUTCHours()).padStart(2, "0") +
    String(date.getUTCMinutes()).padStart(2, "0")
  );
}

const LONDON_OFFSET = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London",
  timeZoneName: "shortOffset",
});

/** London's offset from UTC at an instant, in ms: 0 in winter, an hour in summer. */
function londonOffsetMs(at: number): number {
  const name =
    LONDON_OFFSET.formatToParts(new Date(at)).find(
      (part) => part.type === "timeZoneName",
    )?.value ?? "GMT";
  const hours = /GMT([+-]\d+)/.exec(name)?.[1];
  return hours ? Number(hours) * 3_600_000 : 0;
}

/** The UTC instant of a TRUST timestamp (UK clock time written as if it were UTC). */
export function ukClockToUtc(ms: number): number {
  return ms - londonOffsetMs(ms - londonOffsetMs(ms));
}

/**
 * Each train's movements, the latest report of each call only: TRUST sends a correction as a
 * new movement for the same place, event and public time. Input order is message order.
 */
export function latestMovements(
  movements: readonly TrustMovement[],
): Map<string, TrustMovement[]> {
  const byTrain = new Map<string, Map<string, TrustMovement>>();
  for (const movement of movements) {
    let calls = byTrain.get(movement.trainId);
    if (!calls) {
      calls = new Map();
      byTrain.set(movement.trainId, calls);
    }
    calls.set(
      `${movement.stanox}|${movement.event}|${movement.plannedAt}`,
      movement,
    );
  }
  return new Map(
    [...byTrain].map(([trainId, calls]) => [trainId, [...calls.values()]]),
  );
}
