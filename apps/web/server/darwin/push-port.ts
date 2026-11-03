/**
 * Reads the parts of a Darwin Push Port v18 XML document this app keeps: each schedule's public
 * calls and cancellation reason, and the actual times, platforms and late reason a train status
 * (TS) reports for them. Namespace prefixes differ
 * between the Kafka feed and the snapshot files, so tags are matched with any prefix.
 * A snapshot file is several XML documents one after another; that is read the same way.
 */

/** One public call. Times are HHMM. */
export type DarwinCall = {
  readonly tpl: string;
  readonly pta?: string;
  readonly ptd?: string;
  readonly ata?: string;
  readonly atd?: string;
  readonly cancelled?: boolean;
  /** Platform Darwin gave for public display. A suppressed platform is left out. */
  readonly platform?: string;
};

export type DarwinUpdate =
  | {
      readonly kind: "schedule";
      readonly rid: string;
      readonly serviceDate: string;
      readonly uid: string;
      readonly toc: string;
      readonly calls: readonly DarwinCall[];
      /** Darwin's reason code for a cancellation, as text, e.g. "526". */
      readonly cancelReason?: string;
    }
  | {
      readonly kind: "status";
      readonly rid: string;
      readonly serviceDate: string;
      readonly calls: readonly DarwinCall[];
      /** Darwin's reason code for running late, as text, e.g. "895". */
      readonly lateReason?: string;
    };

const SCHEDULE = /<(?:\w+:)?schedule\b([^>]*)>([\s\S]*?)<\/(?:\w+:)?schedule>/g;
/** Origin, intermediate and destination calls. Operational-only calls and passing points have no public times. */
const SCHEDULE_CALL = /<(?:\w+:)?(?:OR|IP|DT)\b([^>]*?)\/?>/g;
const STATUS = /<(?:\w+:)?TS\b([^>]*)>([\s\S]*?)<\/(?:\w+:)?TS>/g;
const STATUS_LOCATION =
  /<(?:\w+:)?Location\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?Location>)/g;
const ARRIVAL = /<(?:\w+:)?arr\b([^>]*?)\/?>/;
const DEPARTURE = /<(?:\w+:)?dep\b([^>]*?)\/?>/;
const PLATFORM = /<(?:\w+:)?plat\b([^>]*)>([^<]*)</;
const CANCEL_REASON = /<(?:\w+:)?cancelReason\b[^>]*>([^<]*)</;
const LATE_REASON = /<(?:\w+:)?LateReason\b[^>]*>([^<]*)</;

export function parsePushPort(xml: string): DarwinUpdate[] {
  const updates: DarwinUpdate[] = [];
  for (const [, attributes, body] of xml.matchAll(SCHEDULE)) {
    const rid = attribute(attributes, "rid");
    const serviceDate = attribute(attributes, "ssd");
    if (
      !rid ||
      !serviceDate ||
      attribute(attributes, "isPassengerSvc") === "false"
    ) {
      continue;
    }
    const calls: DarwinCall[] = [];
    for (const [, call] of body.matchAll(SCHEDULE_CALL)) {
      const planned = plannedTimes(call);
      if (!planned) {
        continue;
      }
      calls.push({
        ...planned,
        ...(attribute(call, "can") === "true" ? { cancelled: true } : {}),
      });
    }
    const cancelReason = CANCEL_REASON.exec(body)?.[1]?.trim();
    updates.push({
      kind: "schedule",
      rid,
      serviceDate,
      uid: attribute(attributes, "uid") ?? "",
      toc: attribute(attributes, "toc") ?? "",
      calls,
      ...(cancelReason ? { cancelReason } : {}),
    });
  }
  for (const [, attributes, body] of xml.matchAll(STATUS)) {
    const rid = attribute(attributes, "rid");
    const serviceDate = attribute(attributes, "ssd");
    if (!rid || !serviceDate) {
      continue;
    }
    const calls: DarwinCall[] = [];
    for (const [, location, children = ""] of body.matchAll(STATUS_LOCATION)) {
      const planned = plannedTimes(location);
      if (!planned) {
        continue;
      }
      const ata = actualTime(ARRIVAL.exec(children)?.[1]);
      const atd = actualTime(DEPARTURE.exec(children)?.[1]);
      const platform = publicPlatform(children);
      if (!ata && !atd && !platform) {
        continue;
      }
      calls.push({
        ...planned,
        ...(ata ? { ata } : {}),
        ...(atd ? { atd } : {}),
        ...(platform ? { platform } : {}),
      });
    }
    // The late reason belongs to the whole train, outside its locations.
    const lateReason = LATE_REASON.exec(
      body.replace(STATUS_LOCATION, ""),
    )?.[1]?.trim();
    if (calls.length > 0 || lateReason) {
      updates.push({
        kind: "status",
        rid,
        serviceDate,
        calls,
        ...(lateReason ? { lateReason } : {}),
      });
    }
  }
  return updates;
}

/** TIPLOC with its public arrival and departure. A call with neither is not a passenger stop. */
function plannedTimes(
  attributes: string,
): { tpl: string; pta?: string; ptd?: string } | undefined {
  const tpl = attribute(attributes, "tpl");
  const pta = hhmm(attribute(attributes, "pta"));
  const ptd = hhmm(attribute(attributes, "ptd"));
  if (!tpl || (!pta && !ptd)) {
    return undefined;
  }
  return { tpl, ...(pta ? { pta } : {}), ...(ptd ? { ptd } : {}) };
}

/** The `at` of an arrival or departure. A removed actual (`atRemoved`) is not one. */
function actualTime(attributes: string | undefined): string | undefined {
  if (!attributes || attribute(attributes, "atRemoved") === "true") {
    return undefined;
  }
  return hhmm(attribute(attributes, "at"));
}

/** The platform of a status location, unless Darwin marks it suppressed from public display. */
function publicPlatform(children: string): string | undefined {
  const match = PLATFORM.exec(children);
  if (!match || attribute(match[1] ?? "", "platsup") === "true") {
    return undefined;
  }
  return match[2]?.trim() || undefined;
}

function attribute(attributes: string, name: string): string | undefined {
  return new RegExp(`(?:^|\\s)${name}="([^"]*)"`).exec(attributes)?.[1];
}

/** `HH:MM` or `HH:MM:SS` as HHMM. */
function hhmm(value: string | undefined): string | undefined {
  const match = value ? /^(\d{2}):(\d{2})/.exec(value) : null;
  return match ? `${match[1]}${match[2]}` : undefined;
}
