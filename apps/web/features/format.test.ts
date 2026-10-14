import { describe, expect, it } from "vitest";
import {
  formatServiceFacts,
  hasTimeVariants,
  serviceDayNote,
  throughServiceLabel,
  timeWindowLabel,
} from "./format";
import type { ScheduledService } from "@/server/hsp/map";

describe("timeWindowLabel", () => {
  it("shows 07:00–07:59 when departing after 07:00", () => {
    expect(timeWindowLabel("07:00")).toBe("07:00–07:59");
  });

  it("wraps a departure that crosses midnight", () => {
    expect(timeWindowLabel("23:30")).toBe("23:30–00:29");
  });
});

describe("formatServiceFacts", () => {
  it("names the run count and one day type", () => {
    expect(formatServiceFacts(1, ["saturday"])).toBe("1 run · Saturdays");
    expect(formatServiceFacts(48, ["weekdays"])).toBe("48 runs · Weekdays");
  });

  it("lists day types in weekday, Saturday, Sunday order", () => {
    expect(formatServiceFacts(12, ["sunday", "weekdays"])).toBe(
      "12 runs · Weekdays and Sundays",
    );
    expect(formatServiceFacts(20, ["sunday", "saturday", "weekdays"])).toBe(
      "20 runs · Weekdays, Saturdays and Sundays",
    );
  });

  it("omits the day label when the service has none", () => {
    expect(formatServiceFacts(0, [])).toBe("0 runs");
  });

  it("omits the day label when it repeats the search", () => {
    expect(formatServiceFacts(22, ["weekdays"], "weekdays")).toBe("22 runs");
    expect(
      formatServiceFacts(26, ["weekdays", "saturday", "sunday"], "all"),
    ).toBe("26 runs");
  });

  it("keeps the day label when the train runs on fewer days than the search", () => {
    expect(formatServiceFacts(26, ["weekdays", "saturday"], "all")).toBe(
      "26 runs · Weekdays and Saturdays",
    );
  });
});

describe("serviceDayNote", () => {
  it("is empty when the train matches the search", () => {
    expect(serviceDayNote(["weekdays"], "weekdays")).toBe("");
  });

  it("names the days when the train runs on fewer of them", () => {
    expect(serviceDayNote(["weekdays", "saturday"], "all")).toBe(
      "Weekdays and Saturdays",
    );
  });
});

describe("hasTimeVariants", () => {
  const service: ScheduledService = {
    originCrs: "LIV",
    destinationCrs: "NRW",
    publicDeparture: "1051",
    publicArrival: "1141",
    operatorCode: "EM",
    rids: [],
    days: ["saturday"],
  };

  it("is false when nothing was folded in", () => {
    expect(hasTimeVariants(service)).toBe(false);
  });

  it("is false when the folded runs only finished at another station", () => {
    const variants = [
      {
        originCrs: "LIV",
        destinationCrs: "NOT",
        publicDeparture: "1051",
        publicArrival: "1141",
        runCount: 1,
        rids: ["a"],
      },
    ];
    expect(hasTimeVariants({ ...service, variants })).toBe(false);
  });

  it("is true when a folded run kept other times", () => {
    const variants = [
      {
        originCrs: "LIV",
        destinationCrs: "NRW",
        publicDeparture: "1051",
        publicArrival: "1156",
        runCount: 1,
        rids: ["a"],
      },
    ];
    expect(hasTimeVariants({ ...service, variants })).toBe(true);
  });
});

describe("throughServiceLabel", () => {
  const names: Record<string, string> = {
    CTR: "Chester",
    LIV: "Liverpool Lime Street",
    LLA: "Llandudno",
    MAN: "Manchester Piccadilly",
  };
  const nameOf = (crs: string) => names[crs] ?? crs;

  it("is empty when the train runs between the searched stations", () => {
    expect(
      throughServiceLabel(
        { originCrs: "CTR", destinationCrs: "LIV" },
        "CTR",
        "LIV",
        nameOf,
      ),
    ).toBe("");
  });

  it("says where a train starts when it finishes at the station you leave", () => {
    expect(
      throughServiceLabel(
        { originCrs: "LLA", destinationCrs: "LIV" },
        "CTR",
        "LIV",
        nameOf,
      ),
    ).toBe("Starts at Llandudno");
  });

  it("says where a train continues when you board at its origin", () => {
    expect(
      throughServiceLabel(
        { originCrs: "CTR", destinationCrs: "MAN" },
        "CTR",
        "LIV",
        nameOf,
      ),
    ).toBe("Continues to Manchester Piccadilly");
  });

  it("names both ends when the searched stations sit in the middle", () => {
    expect(
      throughServiceLabel(
        { originCrs: "LLA", destinationCrs: "MAN" },
        "CTR",
        "LIV",
        nameOf,
      ),
    ).toBe("Llandudno to Manchester Piccadilly");
  });

  it("is empty for a circular service", () => {
    expect(
      throughServiceLabel(
        { originCrs: "CTR", destinationCrs: "CTR" },
        "CTR",
        "LIV",
        nameOf,
      ),
    ).toBe("");
  });
});
