import { describe, expect, it } from "vitest";
import {
  formatServiceFacts,
  formatSevereJourneys,
  listIntro,
  listScore,
  serviceDayNote,
  throughServiceLabel,
  departureWindowHint,
  timeSearchLabel,
  timeWindowLabel,
  trainListHeading,
} from "./format";

describe("train list copy", () => {
  it("names the hour in the heading and explains on time once", () => {
    expect(trainListHeading("07:00")).toBe("Trains from 07:00 to 07:59");
    expect(trainListHeading("23:30")).toBe("Trains from 23:30 to 00:29");
    expect(
      listIntro({ periodDays: 90, listedTo: "2026-10-18", sample: false }),
    ).toBe(
      "How often each direct train arrived on time in the last 90 days, up to 18/10/2026. On time means it arrived early or less than 5 minutes late.",
    );
    expect(listIntro({ periodDays: 30, sample: false })).toBe(
      "How often each direct train arrived on time in the last 30 days. On time means it arrived early or less than 5 minutes late.",
    );
    expect(listIntro({ periodDays: 90, sample: true })).toBe(
      "Sample trains for trying the screens. On time means it arrived early or less than 5 minutes late.",
    );
  });
});

describe("timeWindowLabel", () => {
  it("shows 07:00–07:59 when departing from 07:00", () => {
    expect(timeWindowLabel("07:00")).toBe("07:00–07:59");
  });

  it("wraps a departure that crosses midnight", () => {
    expect(timeWindowLabel("23:30")).toBe("23:30–00:29");
  });
});

describe("departure window copy", () => {
  it("names the hour in the collapsed summary and the field hint", () => {
    expect(timeSearchLabel("07:30")).toBe("Departing 07:30–08:29");
    expect(departureWindowHint("07:30")).toBe(
      "Shows direct trains leaving 07:30–08:29.",
    );
  });

  it("keeps a general hint until the clock is complete", () => {
    expect(departureWindowHint("")).toBe(
      "Shows direct trains leaving in the hour from this time.",
    );
    expect(departureWindowHint("07:99")).toBe(
      "Shows direct trains leaving in the hour from this time.",
    );
  });
});

describe("listScore", () => {
  it("names the on-time share and the journeys far off", () => {
    expect(
      listScore({
        runs: 20,
        within5: 19,
        within14: 19,
        within29: 19,
      }),
    ).toEqual({ onTimePercent: 95, severe: 1 });
    expect(formatSevereJourneys(1)).toBe(
      "1 journey cancelled or over 30 minutes late",
    );
  });

  it("does not round a late journey up to 100%", () => {
    expect(
      listScore({
        runs: 300,
        within5: 299,
        within14: 300,
        within29: 300,
      }),
    ).toEqual({ onTimePercent: 99, severe: 0 });
    expect(formatSevereJourneys(0)).toBe("");
  });

  it("is empty without a count or without journeys", () => {
    expect(listScore(undefined)).toBeUndefined();
    expect(
      listScore({ runs: 0, within5: 0, within14: 0, within29: 0 }),
    ).toBeUndefined();
  });
});

describe("formatServiceFacts", () => {
  it("names the journey count and one day type", () => {
    expect(formatServiceFacts(1, ["saturday"])).toBe("Saturdays · 1 journey");
    expect(formatServiceFacts(48, ["weekdays"])).toBe("Weekdays · 48 journeys");
  });

  it("lists day types in weekday, Saturday, Sunday order", () => {
    expect(formatServiceFacts(12, ["sunday", "weekdays"])).toBe(
      "Weekdays and Sundays · 12 journeys",
    );
    expect(formatServiceFacts(20, ["sunday", "saturday", "weekdays"])).toBe(
      "Weekdays, Saturdays and Sundays · 20 journeys",
    );
  });

  it("omits the day label when the service has none", () => {
    expect(formatServiceFacts(0, [])).toBe("0 journeys");
  });

  it("omits the day label when it repeats the search", () => {
    expect(formatServiceFacts(22, ["weekdays"], "weekdays")).toBe(
      "22 journeys",
    );
    expect(
      formatServiceFacts(26, ["weekdays", "saturday", "sunday"], "all"),
    ).toBe("26 journeys");
  });

  it("keeps the day label when the train runs on fewer days than the search", () => {
    expect(formatServiceFacts(26, ["weekdays", "saturday"], "all")).toBe(
      "Weekdays and Saturdays · 26 journeys",
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
    ).toBe("From Llandudno to Manchester Piccadilly");
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
