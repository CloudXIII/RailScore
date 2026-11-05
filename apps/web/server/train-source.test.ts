import { afterEach, describe, expect, it, vi } from "vitest";
import { database } from "./db";
import { trainSource } from "./train-source";

vi.mock("./db", () => ({ database: vi.fn() }));

describe("trainSource", () => {
  afterEach(() => {
    delete process.env.RAILSCORE_DATA;
  });

  it("serves sample trains in mock mode without the database", async () => {
    process.env.RAILSCORE_DATA = "mock";
    const source = trainSource();

    const found = await source.findServices({
      fromCrs: "CLJ",
      toCrs: "WAT",
      timeHhmm: "0800",
      days: "weekdays",
      periodDays: 30,
    });

    expect(source.sample).toBe(true);
    expect(found.services.length).toBeGreaterThan(0);
    expect(found.hsp).toBeUndefined();
    expect(found.calculate(found.services[0]!).runs.length).toBeGreaterThan(0);
    expect(database).not.toHaveBeenCalled();
  });

  it("reads Darwin otherwise", () => {
    expect(trainSource().sample).toBe(false);
  });
});
