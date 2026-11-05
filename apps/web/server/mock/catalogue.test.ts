import { calculateReliability, clockMinutes } from "@railscore/core";
import { describe, expect, it } from "vitest";
import { usesMockData } from "@/server/env";
import { mockRuns, mockServices } from "@/server/mock/catalogue";

describe("mockServices", () => {
  it("keeps weekday departures inside the following hour", () => {
    const services = mockServices({
      fromCrs: "LDS",
      toCrs: "MAN",
      timeHhmm: "0630",
      days: "weekdays",
    });
    expect(services).toHaveLength(5);
    for (const service of services) {
      expect(insideWindow(service.publicDeparture, "0630")).toBe(true);
    }
    expect(
      services.filter((service) => service.rids.length === 0),
    ).toHaveLength(1);
    expect(
      services.some(
        (service) =>
          service.originCrs !== "LDS" && service.destinationCrs !== "MAN",
      ),
    ).toBe(true);
  });

  it("keeps a departure that wraps past midnight inside the split window", () => {
    const services = mockServices({
      fromCrs: "EUS",
      toCrs: "MAN",
      timeHhmm: "2330",
      days: "weekdays",
    });
    expect(services.some((service) => service.publicDeparture < "0200")).toBe(
      true,
    );
    for (const service of services) {
      expect(insideWindow(service.publicDeparture, "2330")).toBe(true);
    }
  });

  it("returns fewer services on Sunday", () => {
    expect(
      mockServices({
        fromCrs: "LDS",
        toCrs: "YRK",
        timeHhmm: "0900",
        days: "sunday",
      }),
    ).toHaveLength(2);
  });
});

describe("mockRuns", () => {
  const services = mockServices({
    fromCrs: "LDS",
    toCrs: "MAN",
    timeHhmm: "0630",
    days: "weekdays",
  });

  it("builds a full on-time sample, a poor sample, a short sample and a partial sample", () => {
    const results = services
      .filter((service) => service.rids.length > 0)
      .map((service) => calculateReliability(mockRuns(service)));

    expect(results.map((result) => result.status)).toEqual([
      "ok",
      "ok",
      "ok",
      "partial",
    ]);
    expect(
      results.map((result) => result.withinFiveMinutes.total < 20),
    ).toEqual([false, false, true, false]);
    expect(results[0]?.withinFiveMinutes.percentage).toBeGreaterThan(80);
    expect(results[1]?.withinFiveMinutes.percentage).toBeLessThan(50);
    expect(results[1]?.distribution.cancelled).toBeGreaterThan(0);
    expect(results[3]?.excludedCount).toBeGreaterThan(0);
  });
});

describe("usesMockData", () => {
  it("is on only when RAILSCORE_DATA is mock", () => {
    const previous = process.env.RAILSCORE_DATA;
    try {
      process.env.RAILSCORE_DATA = "mock";
      expect(usesMockData()).toBe(true);
      process.env.RAILSCORE_DATA = "live";
      expect(usesMockData()).toBe(false);
      delete process.env.RAILSCORE_DATA;
      expect(usesMockData()).toBe(false);
    } finally {
      if (previous === undefined) {
        delete process.env.RAILSCORE_DATA;
      } else {
        process.env.RAILSCORE_DATA = previous;
      }
    }
  });
});

function insideWindow(hhmm: string, timeHhmm: string): boolean {
  const minutesAfter =
    (clockMinutes(hhmm) - clockMinutes(timeHhmm) + 24 * 60) % (24 * 60);
  return minutesAfter < 60;
}
