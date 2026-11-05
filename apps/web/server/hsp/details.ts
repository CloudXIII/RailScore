import {
  classifyRun,
  dateOfRid,
  type Call,
  type HistoricalRun,
} from "@railscore/core";
import { decodeCalls, encodeCalls } from "../darwin/run";
import { record, text } from "../payload";
import { HspResponseError } from "./metrics";
import { darwinStationCode } from "./stations";

/**
 * A run from HSP serviceDetails. Each call carries HSP's reason code, when it gave one, in
 * `reason`: HSP has no cancellation flag and does not say whether a code is a late or a
 * cancellation reason. Stations keep Darwin's codes. HSP has no schedule UID.
 */
export type HspRun = {
  readonly rid: string;
  readonly serviceDate: string;
  readonly toc: string;
  readonly calls: readonly Call[];
};

/** Reads a serviceDetails answer. Throws when it is not in that shape or has no date. */
export function runFromDetails(payload: unknown, rid: string): HspRun {
  const details = record(record(payload)?.serviceAttributesDetails);
  if (!details || !Array.isArray(details.locations)) {
    throw new HspResponseError(
      "A historical run was not in the expected shape.",
    );
  }
  const stated = text(details.date_of_service);
  const serviceDate = /^\d{4}-\d{2}-\d{2}$/.test(stated)
    ? stated
    : dateOfRid(rid);
  if (!serviceDate) {
    throw new HspResponseError("A historical run had no date.");
  }
  const calls = details.locations.flatMap((value): Call[] => {
    const stop = record(value);
    const code = text(stop?.location);
    if (!stop || !/^[A-Z]{3}$/.test(code)) {
      return [];
    }
    const pta = clock(stop.gbtt_pta);
    const ptd = clock(stop.gbtt_ptd);
    const ata = clock(stop.actual_ta);
    const atd = clock(stop.actual_td);
    const reason = text(stop.late_canc_reason);
    return [
      {
        crs: darwinStationCode(code),
        ...(pta ? { pta } : {}),
        ...(ptd ? { ptd } : {}),
        ...(ata ? { ata } : {}),
        ...(atd ? { atd } : {}),
        ...(reason ? { reason } : {}),
      },
    ];
  });
  return { rid, serviceDate, toc: text(details.toc_code), calls };
}

/**
 * Classifies a run HSP gave. Unlike a Darwin run, HSP recorded the whole day, so a run with
 * no actual time anywhere did not run: it is cancelled.
 */
export function historicalRunFromHsp(
  run: HspRun,
  journey: { boardingCrs: string; destinationCrs: string },
): HistoricalRun {
  return classifyRun(
    { id: run.rid, serviceDate: run.serviceDate, calls: run.calls },
    journey,
  );
}

/**
 * A run's calls as `hsp_backlog_runs` keeps them: the `darwin_runs` call text, where a call
 * with a reason carries the `c` flag, and the codes one per call, joined by `;` ("" when the
 * run has none). Codes are letters and digits.
 */
export function encodeHspCalls(calls: readonly Call[]): {
  calls: string;
  reasons: string;
} {
  const reasons = calls.map((call) => call.reason ?? "");
  return {
    calls: encodeCalls(
      calls.map(({ reason, ...call }) =>
        reason === undefined ? call : { ...call, cancelled: true },
      ),
    ),
    reasons: reasons.some(Boolean) ? reasons.join(";") : "",
  };
}

/** The calls `encodeHspCalls` stored. A flagged call stored without its code keeps `""`. */
export function decodeHspCalls(stored: {
  calls: string;
  reasons: string;
}): Call[] {
  const codes = stored.reasons ? stored.reasons.split(";") : [];
  return decodeCalls(stored.calls).map(
    ({ cancelled, platform: _platform, ...call }, index) =>
      cancelled ? { ...call, reason: codes[index] ?? "" } : call,
  );
}

function clock(value: unknown): string {
  const hhmm = text(value);
  return /^\d{4}$/.test(hhmm) ? hhmm : "";
}
