import { decodeCalls, encodeCalls } from "../call-text";
import { decodeMonth, encodeMonthChunk } from "./month";
import { foldRepeatedCalls, type DarwinRun } from "./run";

/**
 * Stored text with the repeated last calls folded (`foldRepeatedCalls`), for the one-off
 * rewrite in `scripts/fold-repeated-calls.ts`. Undefined when nothing needs folding, so a
 * second pass changes nothing.
 */

/** A `darwin_runs.calls` text, folded. */
export function refoldRunCalls(calls: string): string | undefined {
  const folded = encodeCalls(foldRepeatedCalls(decodeCalls(calls)));
  return folded === calls ? undefined : folded;
}

/**
 * A `darwin_months.runs` text, folded and packed again as one chunk. A RID appended twice
 * keeps only its later copy, as on read.
 */
export function refoldMonthRuns(
  month: string,
  uid: string,
  text: string,
): string | undefined {
  const runs = decodeMonth(month, uid, text);
  let changed = false;
  const folded = runs.map((run): DarwinRun => {
    const calls = foldRepeatedCalls(run.calls);
    if (encodeCalls(calls) === encodeCalls(run.calls)) {
      return run;
    }
    changed = true;
    return { ...run, calls };
  });
  return changed ? encodeMonthChunk(folded) : undefined;
}
