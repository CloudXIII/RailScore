import { describe, expect, it } from "vitest";
import { databaseBudgetMs, isDatabaseTimeout } from "./db";

describe("databaseBudgetMs", () => {
  it("uses the time left, and never more than the 50 second page budget", () => {
    expect(databaseBudgetMs(10_000, 0)).toBe(10_000);
    expect(databaseBudgetMs(90_000, 0)).toBe(50_000);
    expect(databaseBudgetMs(0, 5)).toBe(1);
  });
});

describe("isDatabaseTimeout", () => {
  it("recognises a lock timeout and a statement timeout", () => {
    expect(isDatabaseTimeout({ code: "55P03" })).toBe(true);
    expect(isDatabaseTimeout({ code: "57014" })).toBe(true);
    expect(isDatabaseTimeout({ code: "42P01" })).toBe(false);
  });
});
