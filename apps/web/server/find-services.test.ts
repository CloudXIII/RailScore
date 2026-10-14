import { beforeEach, describe, expect, it, vi } from "vitest";
import { findServices } from "./find-services";
import { postHsp } from "./hsp/client";

vi.mock("./hsp/client", () => ({
  postHsp: vi.fn(),
}));

const NOW = new Date("2026-10-08T12:00:00Z");

describe("findServices", () => {
  beforeEach(() => {
    delete process.env.RAILSCORE_DATA;
    vi.mocked(postHsp).mockReset();
  });

  it("returns an empty list when HSP lists no services", async () => {
    vi.mocked(postHsp).mockResolvedValue({ Services: [] });

    const found = await findServices(search("0700", "weekdays"));

    expect(found.services).toEqual([]);
    expect(found.period).toEqual({ from: "2026-09-08", to: "2026-10-07" });
  });

  it("fails the search when the list JSON is not the expected shape", async () => {
    vi.mocked(postHsp).mockResolvedValue({ header: {} });

    await expect(findServices(search("0800", "weekdays"))).rejects.toThrow(
      /service list/,
    );
  });

  it("does not return a weekday-only list when a later day type fails", async () => {
    vi.mocked(postHsp).mockImplementation(async (_path, body) => {
      const days =
        typeof body === "object" && body !== null && "days" in body
          ? body.days
          : undefined;
      if (days === "SATURDAY") {
        throw new Error("Historical data could not be loaded.");
      }
      return { Services: [] };
    });

    await expect(findServices(search("0900", "all"))).rejects.toThrow(
      /could not be loaded/,
    );
    const requestedDays = vi.mocked(postHsp).mock.calls.map((call) => {
      const body = call[1];
      return typeof body === "object" && body !== null && "days" in body
        ? body.days
        : undefined;
    });
    expect(requestedDays).toEqual(["WEEKDAY", "SATURDAY"]);
  });

  it("lists one departure once when it runs a minute apart on different day types", async () => {
    const byDay: Record<
      string,
      { departure: string; arrival: string; rids: string[] }
    > = {
      WEEKDAY: {
        departure: "1052",
        arrival: "1640",
        rids: ["202610054100001", "202610064100002"],
      },
      SATURDAY: {
        departure: "1052",
        arrival: "1654",
        rids: ["202610034100003"],
      },
      SUNDAY: { departure: "1051", arrival: "1639", rids: ["202610044100004"] },
    };
    vi.mocked(postHsp).mockImplementation(async (_path, body) => {
      const days =
        typeof body === "object" && body !== null && "days" in body
          ? String(body.days)
          : "";
      const service = byDay[days];
      return {
        Services: service
          ? [
              {
                serviceAttributesMetrics: {
                  origin_location: "QQQ",
                  destination_location: "RRR",
                  gbtt_ptd: service.departure,
                  gbtt_pta: service.arrival,
                  toc_code: "VT",
                  rids: service.rids,
                },
              },
            ]
          : [],
      };
    });

    const found = await findServices(search("1030", "all"));

    expect(found.services).toHaveLength(1);
    expect(found.services[0]?.publicDeparture).toBe("1052");
    expect(found.services[0]?.days).toEqual(["weekdays", "saturday", "sunday"]);
    expect(found.services[0]?.rids).toHaveLength(4);
  });

  it("asks HSP only for the latest week when the same search runs the next day", async () => {
    vi.mocked(postHsp).mockResolvedValue({ Services: [] });

    await findServices({ ...search("1300", "weekdays"), now: NOW });
    await findServices({
      ...search("1300", "weekdays"),
      now: new Date("2026-10-09T12:00:00Z"),
    });

    const ranges = vi.mocked(postHsp).mock.calls.map((call) => {
      const body = call[1] as { from_date: string; to_date: string };
      return [body.from_date, body.to_date];
    });
    expect(ranges).toEqual([
      ["2026-09-07", "2026-10-07"],
      ["2026-10-05", "2026-10-08"],
    ]);
  });
});

function search(timeHhmm: string, days: "weekdays" | "all") {
  return {
    fromCrs: "QQQ",
    toCrs: "RRR",
    timeHhmm,
    days,
    periodDays: 30,
    now: NOW,
  };
}
