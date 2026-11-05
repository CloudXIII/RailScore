import type { Call } from "@railscore/core";

/**
 * The call text `darwin_runs` and `hsp_backlog_runs` both keep: one short string per run.
 */

/** A public call as a Darwin run keeps it: the shared call, with the last public platform. */
export type StoredCall = Omit<Call, "reason"> & {
  /** Last public platform Darwin gave. */
  readonly platform?: string;
};

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
