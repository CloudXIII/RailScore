import { describe, expect, it } from "vitest";
import { searchPeriods } from "./periods";

const at = (iso: string) => new Date(`${iso}T12:00:00Z`);

describe("searchPeriods", () => {
  it("gives HSP the days before Darwin's first whole day", () => {
    expect(searchPeriods(30, at("2026-11-10"), "2026-11-04", true)).toEqual({
      period: { from: "2026-10-11", to: "2026-11-09" },
      darwinFrom: "2026-11-04",
      hsp: { from: "2026-10-11", to: "2026-11-03" },
    });
  });

  it("starts at the first Darwin day without HSP", () => {
    expect(
      searchPeriods(30, at("2026-11-10"), "2026-11-04", false).period,
    ).toEqual({ from: "2026-11-04", to: "2026-11-09" });
  });

  it("stops asking HSP once Darwin covers the period", () => {
    // 30 days ending 3 December start on 4 November.
    expect(searchPeriods(30, at("2026-12-04"), "2026-11-04", true)).toEqual({
      period: { from: "2026-11-04", to: "2026-12-03" },
      darwinFrom: "2026-11-04",
    });
    expect(searchPeriods(90, at("2026-12-04"), "2026-11-04", true).hsp).toEqual(
      { from: "2026-09-05", to: "2026-11-03" },
    );
    expect(
      searchPeriods(90, at("2027-02-02"), "2026-11-04", true).hsp,
    ).toBeUndefined();
  });

  it("covers the whole period from HSP on Darwin's first day", () => {
    expect(searchPeriods(7, at("2026-11-04"), "2026-11-04", true)).toEqual({
      period: { from: "2026-10-28", to: "2026-11-03" },
      darwinFrom: "2026-11-04",
      hsp: { from: "2026-10-28", to: "2026-11-03" },
    });
  });
});
