import { describe, expect, it } from "vitest";
import { applyProgressUpdate } from "./progress-update";

describe("applyProgressUpdate", () => {
  it("ignores a late response that would move the count backwards", () => {
    const current = { saved: 20, total: 40 };
    const next = applyProgressUpdate(
      current,
      { saved: 10, total: 40, ageMs: 50 },
      2_000,
    );

    expect(next).toEqual(current);
  });

  it("accepts a newer count for the same calculation", () => {
    const next = applyProgressUpdate(
      { saved: 20, total: 40 },
      { saved: 25, total: 40, ageMs: 20 },
      2_000,
    );

    expect(next).toEqual({ saved: 25, total: 40 });
  });

  it("ignores a count that was published before this wait", () => {
    const next = applyProgressUpdate(
      undefined,
      { saved: 40, total: 40, ageMs: 5_000 },
      100,
    );

    expect(next).toBeUndefined();
  });

  it("accepts a new calculation whose total changed", () => {
    const next = applyProgressUpdate(
      { saved: 20, total: 40 },
      { saved: 1, total: 12, ageMs: 10 },
      500,
    );

    expect(next).toEqual({ saved: 1, total: 12 });
  });
});
