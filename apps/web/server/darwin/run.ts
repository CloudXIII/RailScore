import type { HistoricalRun } from "@railscore/core";
import { toHistoricalRun } from "../services/map";
import type { DarwinCall, DarwinUpdate } from "./push-port";
import tiplocCrs from "./tiploc-crs.json";

/** A public call at a station, as stored. Times are HHMM. */
export type StoredCall = {
  readonly crs: string;
  readonly pta?: string;
  readonly ptd?: string;
  readonly ata?: string;
  readonly atd?: string;
  readonly cancelled?: boolean;
  /** Last public platform Darwin gave. */
  readonly platform?: string;
};

/** One Darwin run (RID) as the database keeps it. */
export type DarwinRun = {
  readonly rid: string;
  readonly serviceDate: string;
  readonly uid: string;
  readonly toc: string;
  readonly calls: readonly StoredCall[];
  /** Darwin's latest reason code for running late. */
  readonly lateReason?: string;
  /** Darwin's reason code for a cancellation, from the latest schedule. */
  readonly cancelReason?: string;
};

const CRS_BY_TIPLOC: Readonly<Record<string, string>> = tiplocCrs;

export function crsOf(tpl: string): string | undefined {
  return CRS_BY_TIPLOC[tpl];
}

/**
 * Folds one update into a run. A schedule replaces the calling pattern and its cancellation
 * reason, and keeps the actual times and platforms already seen at calls it still has. A train
 * status adds actual times, platforms and a late reason, and a call the schedule never gave is
 * added at the end. Undefined when there is still no public call.
 */
export function mergeUpdate(
  run: DarwinRun | undefined,
  update: DarwinUpdate,
): DarwinRun | undefined {
  const incoming = update.calls
    .map(toStoredCall)
    .filter((call) => call !== undefined);
  if (update.kind === "schedule") {
    const previous = new Map(
      (run?.calls ?? []).map((call) => [callKey(call), call]),
    );
    const calls = incoming.map((call) => {
      const seen = previous.get(callKey(call));
      return withActuals(call, seen);
    });
    if (calls.length === 0) {
      return run;
    }
    return {
      rid: update.rid,
      serviceDate: update.serviceDate,
      uid: update.uid || run?.uid || "",
      toc: update.toc || run?.toc || "",
      calls,
      ...(run?.lateReason ? { lateReason: run.lateReason } : {}),
      ...(update.cancelReason ? { cancelReason: update.cancelReason } : {}),
    };
  }
  const calls = [...(run?.calls ?? [])];
  for (const call of incoming) {
    const index = calls.findIndex((known) => callKey(known) === callKey(call));
    if (index === -1) {
      calls.push(call);
    } else {
      calls[index] = withActuals(calls[index]!, call);
    }
  }
  if (calls.length === 0) {
    return run;
  }
  const lateReason = update.lateReason ?? run?.lateReason;
  return {
    rid: update.rid,
    serviceDate: run?.serviceDate ?? update.serviceDate,
    uid: run?.uid ?? "",
    toc: run?.toc ?? "",
    calls,
    ...(lateReason ? { lateReason } : {}),
    ...(run?.cancelReason ? { cancelReason: run.cancelReason } : {}),
  };
}

function toStoredCall(call: DarwinCall): StoredCall | undefined {
  const crs = crsOf(call.tpl);
  if (!crs) {
    return undefined;
  }
  return {
    crs,
    ...(call.pta ? { pta: call.pta } : {}),
    ...(call.ptd ? { ptd: call.ptd } : {}),
    ...(call.ata ? { ata: call.ata } : {}),
    ...(call.atd ? { atd: call.atd } : {}),
    ...(call.cancelled ? { cancelled: true } : {}),
    ...(call.platform ? { platform: call.platform } : {}),
  };
}

/** Station and public times, so a circular route's two calls at one station stay apart. */
function callKey(call: StoredCall): string {
  return `${call.crs}|${call.pta ?? ""}|${call.ptd ?? ""}`;
}

/** `call` with the actual times and platform of `from`, where `from` has them. */
function withActuals(
  call: StoredCall,
  from: StoredCall | undefined,
): StoredCall {
  if (!from) {
    return call;
  }
  const ata = from.ata ?? call.ata;
  const atd = from.atd ?? call.atd;
  const platform = from.platform ?? call.platform;
  return {
    ...call,
    ...(ata ? { ata } : {}),
    ...(atd ? { atd } : {}),
    ...(platform ? { platform } : {}),
  };
}

/**
 * Calls as one short text: `CRS,pta,ptd,ata,atd,c,platform` per call, joined by `;`.
 * Plain columns would cost a row per call. This keeps a run near 25 bytes a call.
 */
export function encodeCalls(calls: readonly StoredCall[]): string {
  return calls
    .map((call) =>
      [
        call.crs,
        call.pta ?? "",
        call.ptd ?? "",
        call.ata ?? "",
        call.atd ?? "",
        call.cancelled ? "c" : "",
        call.platform ?? "",
      ].join(","),
    )
    .join(";");
}

export function decodeCalls(text: string): StoredCall[] {
  if (!text) {
    return [];
  }
  return text.split(";").map((part) => {
    const [crs = "", pta, ptd, ata, atd, flag, platform] = part.split(",");
    return {
      crs,
      ...(pta ? { pta } : {}),
      ...(ptd ? { ptd } : {}),
      ...(ata ? { ata } : {}),
      ...(atd ? { atd } : {}),
      ...(flag === "c" ? { cancelled: true } : {}),
      ...(platform ? { platform } : {}),
    };
  });
}

/** Reason text a cancelled call carries, so the run rules read it as one. */
const CANCELLED_REASON = "DARWIN_CANCELLED";

/**
 * The run in the serviceDetails shape `toHistoricalRun` reads (first defined by HSP).
 * A cancelled call reads as a call with a late or cancel reason.
 */
export function detailsPayloadFromDarwin(run: DarwinRun): unknown {
  return {
    serviceAttributesDetails: {
      date_of_service: run.serviceDate,
      toc_code: run.toc,
      rid: run.rid,
      locations: run.calls.map((call) => ({
        location: call.crs,
        gbtt_ptd: call.ptd ?? "",
        gbtt_pta: call.pta ?? "",
        actual_td: call.atd ?? "",
        actual_ta: call.ata ?? "",
        late_canc_reason: call.cancelled ? CANCELLED_REASON : "",
      })),
    },
  };
}

/**
 * Classifies a run with the shared run rules. HSP reads a run with no actual time
 * anywhere as cancelled. Here it only means no movement was seen, as for runs that
 * ran before the first import, so the outcome is unknown unless Darwin cancelled a call.
 */
export function historicalRunFromDarwin(
  run: DarwinRun,
  stations: { boardingCrs: string; destinationCrs: string },
): HistoricalRun {
  const seen = run.calls.some((call) => call.ata || call.atd || call.cancelled);
  if (!seen) {
    return {
      id: run.rid,
      serviceDate: run.serviceDate,
      outcome: "missing_actual",
    };
  }
  return toHistoricalRun(detailsPayloadFromDarwin(run), stations, run.rid);
}
