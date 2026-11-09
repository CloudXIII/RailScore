import { describe, expect, it } from "vitest";
import {
  formatServiceFacts,
  formatSevereJourneys,
  listIntro,
  listScore,
  olderJourneysNote,
  olderJourneysRowNote,
  scoreTier,
  serviceDayNote,
  throughServiceLabel,
  departureWindowHint,
  timeSearchLabel,
  trainListHeading,
  emptyTrains,
  inEarlyHours,
  nightNote,
} from "./format";

describe("train list copy", () => {
  it("names the listed departures in the heading and explains on time briefly", () => {
    expect(trainListHeading("07:00", ["0712", "0742", "0905"])).toBe(
      "Trains from 07:12 to 09:05",
    );
    expect(trainListHeading("07:00", ["0712"])).toBe("Train at 07:12");
    expect(trainListHeading("23:30", [])).toBe("Trains from 23:30");
    expect(trainListHeading("23:00", ["2325", "0002", "0108"])).toBe(
      "Trains from 23:25 to 01:08",
    );
    expect(
      listIntro({
        periodDays: 30,
        listed: { from: "2026-09-19", to: "2026-10-18" },
      }),
    ).toBe("On time means no more than 5 minutes late.");
    expect(
      listIntro({
        periodDays: 30,
        listed: { from: "2026-10-12", to: "2026-10-18" },
      }),
    ).toBe(
      "Arrivals since 12/10/2026, the first day recorded. On time means no more than 5 minutes late.",
    );
    expect(listIntro({ periodDays: 30 })).toBe(
      "On time means no more than 5 minutes late.",
    );
  });
});

describe("older journeys that did not load", () => {
  it("says nothing when every train has its older journeys", () => {
    expect(olderJourneysNote({ missing: 0, listed: 6 })).toBe("");
  });

  it("names the first day when every listed train is missing them", () => {
    expect(
      olderJourneysNote({ missing: 6, listed: 6, since: "2026-11-04" }),
    ).toBe(
      "Older journeys could not be loaded because the data provider is busy, so these figures count only journeys since 04/11/2026. Reload later to try again.",
    );
  });

  it("counts the trains when only some are missing them", () => {
    expect(
      olderJourneysNote({ missing: 2, listed: 6, since: "2026-11-04" }),
    ).toBe(
      "Older journeys could not be loaded for 2 of these 6 trains because the data provider is busy. Their figures count only journeys since 04/11/2026. Reload later to try again.",
    );
  });

  it("falls back to recent journeys without a first day", () => {
    expect(olderJourneysNote({ missing: 1, listed: 1 })).toBe(
      "Older journeys could not be loaded because the data provider is busy, so these figures count only recent journeys. Reload later to try again.",
    );
    expect(olderJourneysRowNote()).toBe("Older journeys not loaded");
    expect(olderJourneysRowNote("2026-11-04")).toBe(
      "Only journeys since 04/11/2026",
    );
  });
});

describe("departure time copy", () => {
  it("names the start time in the collapsed summary and the field hint", () => {
    expect(timeSearchLabel("07:30")).toBe("07:30 onwards");
    expect(departureWindowHint()).toBe(
      "Direct trains only, leaving from this time.",
    );
  });
});

describe("scoreTier", () => {
  it("reads 90 and above as good, 75 and above as fair", () => {
    expect(scoreTier(100, 20)).toBe("good");
    expect(scoreTier(90, 20)).toBe("good");
    expect(scoreTier(89, 20)).toBe("fair");
    expect(scoreTier(75, 20)).toBe("fair");
    expect(scoreTier(74, 20)).toBe("poor");
    expect(scoreTier(0, 20)).toBe("poor");
  });

  it("gives no verdict to fewer than five journeys", () => {
    expect(scoreTier(100, 1)).toBe("few");
    expect(scoreTier(0, 4)).toBe("few");
    expect(scoreTier(100, 5)).toBe("good");
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
        arrived: 20,
      }),
    ).toEqual({ onTimePercent: 95, severe: 1, runs: 20 });
    // 1 in 20 is under one in ten: no warning on the row.
    expect(formatSevereJourneys(1, 20)).toBe("");
    expect(formatSevereJourneys(3, 20)).toBe(
      "3 of 20 journeys cancelled or over 30 minutes late",
    );
  });

  it("does not round a late journey up to 100%", () => {
    expect(
      listScore({
        runs: 300,
        within5: 299,
        within14: 300,
        within29: 300,
        arrived: 300,
      }),
    ).toEqual({ onTimePercent: 99, severe: 0, runs: 300 });
    expect(formatSevereJourneys(0, 300)).toBe("");
  });

  it("says nothing about fewer than five journeys", () => {
    expect(formatSevereJourneys(1, 1)).toBe("");
    expect(formatSevereJourneys(4, 4)).toBe("");
    expect(formatSevereJourneys(5, 5)).toBe(
      "5 of 5 journeys cancelled or over 30 minutes late",
    );
  });

  it("is empty without a count or without journeys", () => {
    expect(listScore(undefined)).toBeUndefined();
    expect(
      listScore({ runs: 0, within5: 0, within14: 0, within29: 0, arrived: 0 }),
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

describe("trains in the small hours", () => {
  it("names the night a train after midnight belongs to", () => {
    expect(nightNote("overnight", "saturday")).toBe(
      "Saturday night, after midnight",
    );
    expect(nightNote("early", "saturday")).toBe("Friday night, after midnight");
    expect(nightNote("overnight", "sunday")).toBe(
      "Sunday night, after midnight",
    );
    expect(nightNote("early", "weekdays")).toBe(
      "The night before, after midnight",
    );
    expect(nightNote("overnight", "all")).toBe("Late night, after midnight");
    expect(inEarlyHours("0002")).toBe(true);
    expect(inEarlyHours("0400")).toBe(false);
  });

  it("says there are no more trains only after looking past midnight", () => {
    const route = {
      from: "London Victoria",
      to: "Brighton",
      time: "23:30",
      earlier: true,
    };
    expect(emptyTrains({ ...route, overnight: true })).toBe(
      "No more direct trains from London Victoria to Brighton after 23:30, nor after midnight before 04:00. Journeys with a change are not included.",
    );
    expect(emptyTrains({ ...route, overnight: false })).toBe(
      "No more direct trains from London Victoria to Brighton after 23:30. Journeys with a change are not included.",
    );
    expect(emptyTrains({ ...route, earlier: false, overnight: true })).toBe(
      "No direct trains from London Victoria to Brighton in the recorded timetable. Journeys with a change are not included.",
    );
  });
});
