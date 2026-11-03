import { beforeEach, describe, expect, it, vi } from "vitest";
import { calculateService } from "./calculate-reliability";
import { HspRequestError, postHsp } from "./hsp/client";
import { DailyLimitError } from "./hsp/daily-limit";
import type { ScheduledService } from "./services/map";

vi.mock("./db", () => ({ database: () => undefined }));
vi.mock("./hsp/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./hsp/client")>()),
  postHsp: vi.fn(),
}));

const details = {
  serviceAttributesDetails: {
    locations: [
      {
        location: "LIV",
        gbtt_ptd: "0630",
        gbtt_pta: "",
        actual_td: "0630",
        actual_ta: "",
      },
      {
        location: "MIA",
        gbtt_ptd: "",
        gbtt_pta: "0721",
        actual_td: "",
        actual_ta: "0722",
      },
    ],
  },
};

const service: ScheduledService = {
  originCrs: "LIV",
  destinationCrs: "MIA",
  publicDeparture: "0630",
  publicArrival: "0721",
  operatorCode: "NT",
  rids: ["nodate"],
  days: ["weekdays"],
};

describe("calculateService", () => {
  beforeEach(() => {
    delete process.env.RAILSCORE_DATA;
    vi.mocked(postHsp).mockReset();
    vi.mocked(postHsp).mockResolvedValue(details);
  });

  it("finishes a readable run that has no calendar date", async () => {
    const first = await calculateService({
      service,
      boardingCrs: "LIV",
      destinationCrs: "MIA",
    });
    const second = await calculateService({
      service,
      boardingCrs: "LIV",
      destinationCrs: "MIA",
    });

    expect(first.status).toBe("complete");
    expect(second.status).toBe("complete");
    if (first.status === "complete") {
      expect(first.result.withinFiveMinutes).toEqual({
        count: 1,
        total: 1,
        percentage: 100,
      });
      expect(first.result.calendar).toEqual([]);
    }
    expect(postHsp).toHaveBeenCalledTimes(1);
  });

  it("tells the visitor when the daily limit is reached", async () => {
    vi.mocked(postHsp).mockRejectedValue(new DailyLimitError());
    const limited: ScheduledService = {
      ...service,
      publicDeparture: "1000",
      rids: ["202607180000088"],
    };

    await expect(
      calculateService({
        service: limited,
        boardingCrs: "LIV",
        destinationCrs: "MIA",
      }),
    ).rejects.toThrow(
      "The daily limit for this demo has been reached. Try again tomorrow.",
    );
  });

  it("keeps working instead of failing when HSP is busy", async () => {
    vi.mocked(postHsp).mockRejectedValue(new HspRequestError("busy"));
    const busyService: ScheduledService = {
      ...service,
      publicDeparture: "0900",
      rids: ["202607170000077"],
    };

    const calculation = await calculateService({
      service: busyService,
      boardingCrs: "LIV",
      destinationCrs: "MIA",
    });

    expect(calculation).toEqual({ status: "working", saved: 0, total: 1 });
  });

  it("lets one calculation call HSP while a second one waits", async () => {
    let releaseFetch!: () => void;
    const fetchGate = new Promise<void>((resolve) => {
      releaseFetch = resolve;
    });
    let markFetchStarted!: () => void;
    const fetchStarted = new Promise<void>((resolve) => {
      markFetchStarted = resolve;
    });
    vi.mocked(postHsp).mockImplementation(async () => {
      markFetchStarted();
      await fetchGate;
      return details;
    });
    const pendingService: ScheduledService = {
      ...service,
      publicDeparture: "0800",
      rids: ["202607170000099"],
    };

    const pending = calculateService({
      service: pendingService,
      boardingCrs: "LIV",
      destinationCrs: "MIA",
    });
    await fetchStarted;
    const waiting = await calculateService({
      service: pendingService,
      boardingCrs: "LIV",
      destinationCrs: "MIA",
    });

    expect(waiting.status).toBe("working");
    expect(postHsp).toHaveBeenCalledTimes(1);
    releaseFetch();
    await expect(pending).resolves.toMatchObject({ status: "complete" });
    expect(postHsp).toHaveBeenCalledTimes(1);
  });
});
