import { beforeEach, describe, expect, it, vi } from "vitest";
import { calculateService } from "./calculate-reliability";
import { loadSettledDarwinRuns } from "./darwin/store";
import { database } from "./db";
import type { ScheduledService } from "./services/map";

vi.mock("./db", () => ({ database: vi.fn() }));
vi.mock("./darwin/store", () => ({ loadSettledDarwinRuns: vi.fn() }));

const details = {
  serviceAttributesDetails: {
    date_of_service: "2026-07-17",
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
  rids: ["202607170000001", "202607180000002"],
  days: ["weekdays"],
};

const stations = { boardingCrs: "LIV", destinationCrs: "MIA" };

describe("calculateService", () => {
  beforeEach(() => {
    delete process.env.RAILSCORE_DATA;
    vi.mocked(database).mockReset();
    vi.mocked(loadSettledDarwinRuns).mockReset();
  });

  it("classifies stored Darwin runs and counts a run with none as no data", async () => {
    vi.mocked(database).mockReturnValue({} as ReturnType<typeof database>);
    vi.mocked(loadSettledDarwinRuns).mockResolvedValue(
      new Map([["202607170000001", details]]),
    );

    const { result } = await calculateService({ service, ...stations });

    expect(loadSettledDarwinRuns).toHaveBeenCalledWith(
      expect.anything(),
      service.rids,
      expect.any(Date),
    );
    expect(result.withinFiveMinutes).toEqual({
      count: 1,
      total: 1,
      percentage: 100,
    });
    expect(result.calendar.map((mark) => mark.kind)).toEqual([
      "on_time",
      "no_data",
    ]);
  });

  it("finishes with no known runs when there is no database", async () => {
    vi.mocked(database).mockReturnValue(undefined);

    const { result } = await calculateService({ service, ...stations });

    expect(loadSettledDarwinRuns).not.toHaveBeenCalled();
    expect(result.withinFiveMinutes.total).toBe(0);
  });
});
