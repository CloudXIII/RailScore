import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./db", () => ({ database: () => undefined }));
vi.mock("./hsp/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./hsp/client")>()),
  postHsp: vi.fn(),
}));
vi.mock("./hsp/list-slots", () => ({
  withListSlot: (_deadline: number, run: () => Promise<unknown>) => run(),
}));
vi.mock("./after-response", () => ({ afterResponse: vi.fn() }));

const NOW = new Date("2026-10-08T12:00:00Z");

type HspBody = {
  days: string;
  from_time: string;
  to_time: string;
  from_date: string;
  to_date: string;
  tolerance: string[];
};

let findServices: typeof import("./find-services").findServices;
let postHsp: typeof import("./hsp/client").postHsp;
let HspRequestError: typeof import("./hsp/client").HspRequestError;
let afterResponse: typeof import("./after-response").afterResponse;

describe("findServices", () => {
  beforeEach(async () => {
    delete process.env.RAILSCORE_DATA;
    vi.useRealTimers();
    vi.resetModules();
    ({ findServices } = await import("./find-services"));
    ({ postHsp, HspRequestError } = await import("./hsp/client"));
    ({ afterResponse } = await import("./after-response"));
    vi.mocked(postHsp).mockReset();
    vi.mocked(afterResponse).mockClear();
  });

  it("returns an empty list when HSP lists no services", async () => {
    vi.mocked(postHsp).mockResolvedValue({ Services: [] });

    const found = await findServices(search("0700", "weekdays"));

    expect(found.services).toEqual([]);
    expect(found.period).toEqual({ from: "2026-09-08", to: "2026-10-07" });
  });

  it("asks HSP for the whole period with the tolerances of the bands", async () => {
    vi.mocked(postHsp).mockResolvedValue({ Services: [] });

    await findServices(search("0700", "weekdays"));

    for (const body of bodies()) {
      expect(body.from_date).toBe("2026-09-08");
      expect(body.to_date).toBe("2026-10-07");
      expect(body.tolerance).toEqual(["5", "14", "29"]);
    }
  });

  it("starts two quarter-hours at once, then asks for the rest of a quiet route's hour in one call", async () => {
    vi.mocked(postHsp).mockResolvedValue({ Services: [] });

    await findServices(search("0710", "weekdays"));

    expect(windows()).toEqual(["0710-0714", "0715-0729", "0730-0809"]);
  });

  it("keeps a busy route to one quarter-hour per call", async () => {
    let clock = Date.parse("2026-10-08T12:00:00Z");
    vi.spyOn(Date, "now").mockImplementation(() => clock);
    vi.mocked(postHsp).mockImplementation(async (_path, raw) => {
      clock += minutesOf(raw as HspBody) * 1000;
      return { Services: [] };
    });

    await findServices(search("0710", "weekdays"));
    vi.mocked(Date.now).mockRestore();

    expect(windows().sort()).toEqual([
      "0710-0714",
      "0715-0729",
      "0730-0744",
      "0745-0759",
      "0800-0809",
    ]);
  });

  it("halves a call that timed out and carries on", async () => {
    vi.mocked(postHsp).mockImplementation(async (_path, raw) => {
      const body = raw as HspBody;
      if (body.from_time === "0730" && body.to_time === "0809") {
        throw new HspRequestError("busy");
      }
      return {
        Services:
          body.from_time <= "0750" && body.to_time >= "0750"
            ? [metrics("0750", "0835", ["202610054100001"])]
            : [],
      };
    });

    const found = await findServices(search("0710", "weekdays"));

    expect(windows()).toEqual([
      "0710-0714",
      "0715-0729",
      "0730-0809",
      "0730-0744",
      "0745-0809",
    ]);
    expect(found.services.map((service) => service.publicDeparture)).toEqual([
      "0750",
    ]);
  });

  it("carries on one call at a time when HSP refuses a second alongside the first", async () => {
    let inFlight = 0;
    vi.mocked(postHsp).mockImplementation(async () => {
      if (inFlight > 0) {
        throw new HspRequestError("busy");
      }
      inFlight += 1;
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
      return { Services: [] };
    });

    await findServices(search("0710", "weekdays"));

    expect(windows()).toEqual(["0710-0714", "0715-0729", "0715-0809"]);

    vi.mocked(postHsp).mockClear();
    await findServices(search("0810", "weekdays"));
    expect(windows()).toEqual(["0810-0814", "0815-0909"]);
  });

  it("asks again after a short pause when its only call is refused", async () => {
    vi.useFakeTimers();
    try {
      const refused = new Set<string>();
      vi.mocked(postHsp).mockImplementation(async (_path, raw) => {
        const body = raw as HspBody;
        if (!refused.has(body.from_time)) {
          refused.add(body.from_time);
          throw new HspRequestError("busy");
        }
        return { Services: [] };
      });

      const pending = findServices(search("0700", "weekdays"));
      await vi.runAllTimersAsync();
      await pending;

      expect(windows().filter((window) => window === "0700-0714")).toHaveLength(
        2,
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("tries two calls again next time when HSP refused every call", async () => {
    let clock = Date.parse("2026-10-08T12:00:00Z");
    vi.spyOn(Date, "now").mockImplementation(() => clock);
    vi.mocked(postHsp).mockImplementation(async () => {
      clock += 130_000;
      throw new HspRequestError("busy");
    });
    await expect(
      findServices(search("0710", "weekdays")),
    ).rejects.toBeInstanceOf(HspRequestError);
    vi.mocked(Date.now).mockRestore();

    vi.mocked(postHsp).mockReset();
    vi.mocked(postHsp).mockResolvedValue({ Services: [] });
    await findServices(search("0710", "weekdays"));

    expect(windows()).toEqual(["0710-0714", "0715-0729", "0730-0809"]);
  });

  it("saves each quarter-hour of a joined call, so a search from another minute reuses it", async () => {
    vi.mocked(postHsp).mockResolvedValue({ Services: [] });

    await findServices(search("0700", "weekdays"));
    vi.mocked(postHsp).mockClear();
    await findServices(search("0730", "weekdays"));

    expect(windows()).toEqual(["0800-0814", "0815-0829"]);
  });

  it("keeps HSP's count on each listed train", async () => {
    vi.mocked(postHsp).mockImplementation(async (_path, raw) => {
      const body = raw as HspBody;
      return {
        Services:
          body.from_time <= "0705" && body.to_time >= "0705"
            ? [
                {
                  ...metrics("0705", "0750", ["202610054100001"]),
                  Metrics: [
                    metric("5", 18, 2),
                    metric("14", 19, 1),
                    metric("29", 19, 1),
                  ],
                },
              ]
            : [],
      };
    });

    const found = await findServices(search("0700", "weekdays"));

    expect(found.services[0]?.punctuality).toEqual({
      runs: 20,
      within5: 18,
      within14: 19,
      within29: 19,
    });
  });

  it("fails the search when the list JSON is not the expected shape", async () => {
    vi.mocked(postHsp).mockResolvedValue({ header: {} });

    await expect(findServices(search("0800", "weekdays"))).rejects.toThrow(
      /service list/,
    );
  });

  it("does not return a weekday-only list when a later day type fails", async () => {
    vi.mocked(postHsp).mockImplementation(async (_path, body) => {
      if ((body as HspBody).days === "SATURDAY") {
        throw new Error("Historical data could not be loaded.");
      }
      return { Services: [] };
    });

    await expect(findServices(search("0900", "all"))).rejects.toThrow(
      /could not be loaded/,
    );
    expect(bodies().map((body) => body.days)).toContain("SATURDAY");
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
    vi.mocked(postHsp).mockImplementation(async (_path, raw) => {
      const body = raw as HspBody;
      const service = byDay[body.days];
      const inSlice =
        service &&
        service.departure >= body.from_time &&
        service.departure <= body.to_time;
      return {
        Services: inSlice
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

  it("shows yesterday's list at once, then fetches it again after the response", async () => {
    vi.mocked(postHsp).mockResolvedValue({ Services: [] });
    const tomorrow = new Date("2026-10-09T12:00:00Z");

    await findServices({ ...search("1300", "weekdays"), now: NOW });
    vi.mocked(postHsp).mockClear();
    const next = await findServices({
      ...search("1300", "weekdays"),
      now: tomorrow,
    });

    expect(postHsp).not.toHaveBeenCalled();
    expect(next.period).toEqual({ from: "2026-09-08", to: "2026-10-07" });
    expect(afterResponse).toHaveBeenCalledTimes(1);

    await vi.mocked(afterResponse).mock.calls[0]?.[0]();
    const ranges = [
      ...new Set(bodies().map((body) => `${body.from_date}..${body.to_date}`)),
    ];
    expect(ranges).toEqual(["2026-09-09..2026-10-08"]);

    vi.mocked(postHsp).mockClear();
    const refreshed = await findServices({
      ...search("1300", "weekdays"),
      now: tomorrow,
    });
    expect(postHsp).not.toHaveBeenCalled();
    expect(refreshed.period).toEqual({ from: "2026-09-09", to: "2026-10-08" });
  });

  it("leaves a list a few days old alone while a train is calculated", async () => {
    vi.mocked(postHsp).mockResolvedValue({ Services: [] });

    await findServices({ ...search("1300", "weekdays"), now: NOW });
    await findServices({
      ...search("1300", "weekdays"),
      now: new Date("2026-10-09T12:00:00Z"),
      refreshStale: false,
    });

    expect(afterResponse).not.toHaveBeenCalled();
  });

  it("waits for a new list when the stored one ends more than a week early", async () => {
    vi.mocked(postHsp).mockResolvedValue({ Services: [] });

    await findServices({ ...search("1300", "weekdays"), now: NOW });
    vi.mocked(postHsp).mockClear();
    const later = await findServices({
      ...search("1300", "weekdays"),
      now: new Date("2026-10-17T12:00:00Z"),
    });

    expect(postHsp).toHaveBeenCalled();
    expect(later.period).toEqual({ from: "2026-09-17", to: "2026-10-16" });
  });

  it("stops calling HSP when the time budget runs out, and the next try carries on", async () => {
    let clock = Date.parse("2026-10-08T12:00:00Z");
    vi.spyOn(Date, "now").mockImplementation(() => clock);
    vi.mocked(postHsp).mockImplementation(async () => {
      clock += 50_000;
      return { Services: [] };
    });

    await expect(
      findServices(search("1500", "weekdays")),
    ).rejects.toBeInstanceOf(HspRequestError);
    const firstTry = bodies().map((body) => body.from_time);
    expect(firstTry).toEqual(["1500", "1515", "1530"]);

    vi.mocked(postHsp).mockClear();
    vi.mocked(postHsp).mockResolvedValue({ Services: [] });
    vi.mocked(Date.now).mockRestore();
    await findServices(search("1500", "weekdays"));

    expect(windows()).toEqual(["1545-1559"]);
  });
});

function bodies(): HspBody[] {
  return vi.mocked(postHsp).mock.calls.map((call) => call[1] as HspBody);
}

function windows(): string[] {
  return bodies().map((body) => `${body.from_time}-${body.to_time}`);
}

function minutesOf(body: HspBody): number {
  const clock = (hhmm: string) =>
    Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(2, 4));
  return clock(body.to_time) - clock(body.from_time) + 1;
}

function metrics(departure: string, arrival: string, rids: string[]) {
  return {
    serviceAttributesMetrics: {
      origin_location: "QQQ",
      destination_location: "RRR",
      gbtt_ptd: departure,
      gbtt_pta: arrival,
      toc_code: "VT",
      rids,
    },
  };
}

function metric(tolerance: string, within: number, outside: number) {
  return {
    tolerance_value: tolerance,
    num_tolerance: String(within),
    num_not_tolerance: String(outside),
  };
}

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
