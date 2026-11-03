import { describe, expect, it } from "vitest";
import { decodeMonth, encodeMonthChunk, monthOf } from "./month";
import type { DarwinRun } from "./run";

function run(date: string, tail: string, calls: DarwinRun["calls"]): DarwinRun {
  return {
    rid: `${date.replaceAll("-", "")}${tail}`,
    serviceDate: date,
    uid: "W12345",
    toc: "SW",
    calls,
  };
}

const onTime = run("2026-11-02", "6782766", [
  { crs: "CLJ", ptd: "0812", atd: "0812" },
  { crs: "VXH", pta: "0817", ptd: "0818", ata: "0817", atd: "0819" },
  { crs: "WAT", pta: "0823", ata: "0822" },
]);

const late = run("2026-11-03", "6782767", [
  { crs: "CLJ", ptd: "0812", atd: "0815" },
  { crs: "VXH", pta: "0817", ptd: "0818", ata: "0820", atd: "0821" },
  { crs: "WAT", pta: "0823", ata: "0828" },
]);

describe("month rows", () => {
  it("gives back exactly the runs of every appended day", () => {
    const text = [encodeMonthChunk([onTime]), encodeMonthChunk([late])].join(
      "\n",
    );

    expect(decodeMonth("2026-11-01", "W12345", text)).toEqual([onTime, late]);
  });

  it("keeps cancellations, missing actuals, times past midnight, platforms, reasons and the operator", () => {
    const odd: DarwinRun = {
      ...run("2026-11-04", "0000001", [
        { crs: "EUS", ptd: "2355", atd: "2358", platform: "15" },
        { crs: "WFJ", pta: "0010", ptd: "0011", ata: "0014", platform: "3B" },
        { crs: "MKC", pta: "0040", cancelled: true },
        { crs: "XXX", ata: "0050" },
      ]),
      toc: "LM",
      lateReason: "895",
      cancelReason: "526",
    };
    const text = encodeMonthChunk([odd]);

    expect(decodeMonth("2026-11-01", "W12345", text)).toEqual([odd]);
  });

  it("keeps a RID that does not start with its date", () => {
    const strange = { ...onTime, rid: "X1" };

    expect(
      decodeMonth("2026-11-01", "W12345", encodeMonthChunk([strange])),
    ).toEqual([strange]);
  });

  it("lets a run appended again replace the earlier copy", () => {
    const updated = {
      ...late,
      rid: onTime.rid,
      serviceDate: onTime.serviceDate,
    };
    const text = [encodeMonthChunk([onTime]), encodeMonthChunk([updated])].join(
      "\n",
    );

    expect(decodeMonth("2026-11-01", "W12345", text)).toEqual([updated]);
  });

  it("writes the calling pattern once for runs that share it", () => {
    const text = encodeMonthChunk([onTime, late]);

    expect(
      text.split("\n").filter((line) => line.startsWith("P")),
    ).toHaveLength(1);
  });

  it("names the month a date falls in", () => {
    expect(monthOf("2026-11-03")).toBe("2026-11-01");
  });
});
