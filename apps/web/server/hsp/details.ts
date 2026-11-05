import type { HistoricalRun } from "@railscore/core";
import {
  detailsPayloadFromDarwin,
  type DarwinRun,
  type StoredCall,
} from "../darwin/run";
import { serviceDateOf, toHistoricalRun } from "../services/map";
import { HspResponseError } from "./metrics";
import { record, text } from "../payload";
import { darwinStationCode } from "./stations";

/**
 * A run from HSP: the stored Darwin shape plus HSP's reason code at each call, "" where
 * there is none. HSP does not say whether a code is a late or a cancellation reason.
 */
export type HspRun = DarwinRun & { readonly reasons: readonly string[] };

/**
 * A serviceDetails answer in the stored Darwin shape, so it is kept as compact text and read
 * by the same rules. HSP gives a late or cancellation reason per call but no cancellation
 * flag; a call with a reason is stored with the `c` flag, which the rules read as a reason,
 * and the code itself is kept in `reasons`. HSP has no schedule UID, so `uid` is empty.
 * Stations keep Darwin's codes.
 */
export function runFromDetails(payload: unknown, rid: string): HspRun {
  const details = record(record(payload)?.serviceAttributesDetails);
  if (!details || !Array.isArray(details.locations)) {
    throw new HspResponseError(
      "A historical run was not in the expected shape.",
    );
  }
  const serviceDate = serviceDateOf(payload, rid);
  if (!serviceDate) {
    throw new HspResponseError("A historical run had no date.");
  }
  const reasons: string[] = [];
  const calls = details.locations.flatMap((value): StoredCall[] => {
    const stop = record(value);
    const code = text(stop?.location);
    if (!stop || !/^[A-Z]{3}$/.test(code)) {
      return [];
    }
    const crs = darwinStationCode(code);
    const pta = clock(stop.gbtt_pta);
    const ptd = clock(stop.gbtt_ptd);
    const ata = clock(stop.actual_ta);
    const atd = clock(stop.actual_td);
    const reason = text(stop.late_canc_reason);
    reasons.push(reason);
    return [
      {
        crs,
        ...(pta ? { pta } : {}),
        ...(ptd ? { ptd } : {}),
        ...(ata ? { ata } : {}),
        ...(atd ? { atd } : {}),
        ...(reason ? { cancelled: true } : {}),
      },
    ];
  });
  return {
    rid,
    serviceDate,
    uid: "",
    toc: text(details.toc_code),
    calls,
    reasons,
  };
}

/**
 * Classifies a run HSP gave. Unlike a Darwin run, HSP recorded the whole day, so a run with
 * no actual time anywhere did not run: it is cancelled.
 */
export function historicalRunFromHsp(
  run: DarwinRun,
  stations: { boardingCrs: string; destinationCrs: string },
): HistoricalRun {
  return toHistoricalRun(detailsPayloadFromDarwin(run), stations, run.rid);
}

/** Reason codes as stored: one per call, joined by `;`. Codes are letters and digits. */
export function encodeReasons(reasons: readonly string[]): string {
  return reasons.some(Boolean) ? reasons.join(";") : "";
}

/** The stored codes for `callCount` calls. A run stored without codes has none. */
export function decodeReasons(text: string, callCount: number): string[] {
  const codes = text ? text.split(";") : [];
  return Array.from({ length: callCount }, (_, index) => codes[index] ?? "");
}

function clock(value: unknown): string {
  const hhmm = text(value);
  return /^\d{4}$/.test(hhmm) ? hhmm : "";
}
