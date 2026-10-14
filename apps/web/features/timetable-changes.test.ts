import { describe, expect, it } from "vitest";
import {
  includedTimes,
  includedTimesText,
  scheduleNotes,
  timetableChanges,
  usualDays,
} from "./timetable-changes";
import type { ScheduledService } from "@/server/hsp/map";

const usual: ScheduledService = {
  originCrs: "EDB",
  destinationCrs: "EUS",
  publicDeparture: "1052",
  publicArrival: "1640",
  operatorCode: "VT",
  rids: ["202609144100001"],
  days: ["weekdays", "sunday"],
};

describe("timetableChanges", () => {
  it("is empty when nothing was folded in", () => {
    expect(timetableChanges(usual)).toEqual([]);
  });

  it("lists dated runs with other times and their extra journey minutes, in date order", () => {
    const service: ScheduledService = {
      ...usual,
      variants: [
        {
          originCrs: "EDB",
          destinationCrs: "EUS",
          publicDeparture: "1051",
          publicArrival: "1656",
          runCount: 2,
          rids: ["202609274100003", "202609134100002"],
        },
        {
          originCrs: "EDB",
          destinationCrs: "EUS",
          publicDeparture: "1052",
          publicArrival: "1640",
          runCount: 1,
          rids: ["202609204100004"],
        },
        {
          originCrs: "EDB",
          destinationCrs: "EUS",
          publicDeparture: "1052",
          publicArrival: "1638",
          runCount: 1,
          rids: ["run-x"],
        },
      ],
    };
    expect(timetableChanges(service)).toEqual([
      {
        serviceDate: "2026-09-13",
        publicDeparture: "1051",
        publicArrival: "1656",
        extraMinutes: 17,
      },
      {
        serviceDate: "2026-09-27",
        publicDeparture: "1051",
        publicArrival: "1656",
        extraMinutes: 17,
      },
    ]);
  });
});

describe("includedTimes", () => {
  it("names each other timetable by the days it ran", () => {
    const service: ScheduledService = {
      ...usual,
      variants: [
        {
          originCrs: "EDB",
          destinationCrs: "EUS",
          publicDeparture: "1149",
          publicArrival: "1235",
          runCount: 1,
          rids: ["202609134100002"],
        },
        {
          originCrs: "EDB",
          destinationCrs: "EUS",
          publicDeparture: "1052",
          publicArrival: "1640",
          runCount: 1,
          rids: ["202609124100003"],
        },
      ],
    };
    const included = includedTimes(service);
    expect(included).toHaveLength(1);
    expect(includedTimesText(included[0]!)).toBe("Sundays 11:49–12:35");
  });

  it("falls back to a run count when a run has no date", () => {
    const service: ScheduledService = {
      ...usual,
      variants: [
        {
          originCrs: "EDB",
          destinationCrs: "EUS",
          publicDeparture: "1051",
          publicArrival: "1656",
          runCount: 2,
          rids: ["run-x", "run-y"],
        },
      ],
    };
    expect(includedTimesText(includedTimes(service)[0]!)).toBe(
      "2 runs 10:51–16:56",
    );
  });
});

describe("scheduleNotes", () => {
  it("leaves out arrivals a few minutes either side of the usual one", () => {
    const service: ScheduledService = {
      ...usual,
      variants: [
        {
          originCrs: "MAN",
          destinationCrs: "EUS",
          publicDeparture: "0805",
          publicArrival: "1054",
          runCount: 1,
          rids: ["202608304100001"],
        },
        {
          originCrs: "MAN",
          destinationCrs: "EUS",
          publicDeparture: "0805",
          publicArrival: "1103",
          runCount: 1,
          rids: ["202608094100002"],
        },
      ],
    };
    expect(
      scheduleNotes({
        ...service,
        publicDeparture: "0805",
        publicArrival: "1059",
      }),
    ).toEqual([]);
  });

  it("names a departure that belongs to other days", () => {
    const service: ScheduledService = {
      ...usual,
      publicDeparture: "1143",
      publicArrival: "1234",
      variants: [
        {
          originCrs: "CTR",
          destinationCrs: "LIV",
          publicDeparture: "1149",
          publicArrival: "1235",
          runCount: 1,
          rids: ["202609134100001"],
        },
      ],
    };
    expect(scheduleNotes(service)).toEqual([
      "On Sundays it leaves at 11:49 and arrives at 12:35",
    ]);
  });

  it("names an undated departure by how many runs it covers", () => {
    const service: ScheduledService = {
      ...usual,
      variants: [
        {
          originCrs: "EDB",
          destinationCrs: "EUS",
          publicDeparture: "1149",
          publicArrival: "1740",
          runCount: 2,
          rids: ["run-x", "run-y"],
        },
      ],
    };
    expect(scheduleNotes(service)).toEqual([
      "2 runs were booked to leave at 11:49 and arrive at 17:40",
    ]);
  });

  it("names a same departure that was booked to arrive much later", () => {
    const service: ScheduledService = {
      ...usual,
      publicDeparture: "0814",
      publicArrival: "1027",
      variants: [
        {
          originCrs: "MAN",
          destinationCrs: "EUS",
          publicDeparture: "0814",
          publicArrival: "1137",
          runCount: 1,
          rids: ["202610104100099"],
        },
      ],
    };
    expect(scheduleNotes(service)).toEqual([
      "1 Saturday was booked to arrive at 11:37",
    ]);
  });
});

describe("usualDays", () => {
  it("leaves out a day type that has a single run", () => {
    expect(
      usualDays({
        ...usual,
        rids: ["202609144100001", "202609154100002", "202610104100099"],
        days: ["weekdays", "saturday"],
      }),
    ).toEqual(["weekdays"]);
  });
});
