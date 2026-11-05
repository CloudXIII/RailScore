import { describe, expect, it } from "vitest";
import { decodeCalls } from "../call-text";
import { decodeMonth, encodeMonthChunk } from "./month";
import { refoldMonthRuns, refoldRunCalls } from "./refold";
import type { DarwinRun } from "./run";

const repeated =
  "PAD,,0738,,0737,,10;RDG,0816,0824,,,,;TLH,0828,0828,,,c,3;RDG,0816,,0821,,,12";
const folded =
  "PAD,,0738,,0737,,10;RDG,0816,0824,0821,,,12;TLH,0828,0828,,,c,3";
const loop =
  "WAT,,0530,,0529,,8;CLJ,0540,0540,0540,0541,,5;KNG,0616,0618,0615,0617,,3;CLJ,0639,0640,0637,0639,,10;WAT,0649,,0648,,,5";

function run(date: string, tail: string, calls: string): DarwinRun {
  return {
    rid: `${date.replaceAll("-", "")}${tail}`,
    serviceDate: date,
    uid: "W12345",
    toc: "GW",
    calls: decodeCalls(calls),
  };
}

describe("refoldRunCalls", () => {
  it("folds a repeated last stop, once", () => {
    expect(refoldRunCalls(repeated)).toBe(folded);
    expect(refoldRunCalls(folded)).toBeUndefined();
  });

  it("leaves a loop alone", () => {
    expect(refoldRunCalls(loop)).toBeUndefined();
  });
});

describe("refoldMonthRuns", () => {
  const cut = run("2026-11-02", "0000001", repeated);
  const fine = run("2026-11-03", "0000002", folded);

  it("folds the runs of a month and packs them as one chunk, once", () => {
    const text = [encodeMonthChunk([cut]), encodeMonthChunk([fine])].join("\n");
    const rewritten = refoldMonthRuns("2026-11-01", "W12345", text);
    expect(rewritten).toBeDefined();
    expect(decodeMonth("2026-11-01", "W12345", rewritten!)).toEqual([
      { ...cut, calls: decodeCalls(folded) },
      fine,
    ]);
    expect(refoldMonthRuns("2026-11-01", "W12345", rewritten!)).toBeUndefined();
  });

  it("leaves a month with nothing to fold as it is", () => {
    const text = [encodeMonthChunk([fine]), encodeMonthChunk([fine])].join(
      "\n",
    );
    expect(refoldMonthRuns("2026-11-01", "W12345", text)).toBeUndefined();
  });
});
