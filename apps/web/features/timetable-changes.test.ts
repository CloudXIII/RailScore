import { describe, expect, it } from "vitest";
import {
  scheduleNotes,
  timetableChanges,
  usualDays,
} from "./timetable-changes";
import type { ScheduledService } from "@/server/services/fold";

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

  it("gives one note to the same times from different origins", () => {
    const service: ScheduledService = {
      ...usual,
      publicDeparture: "0855",
      publicArrival: "0932",
      variants: [
        {
          originCrs: "LIT",
          destinationCrs: "VIC",
          publicDeparture: "0859",
          publicArrival: "0933",
          runCount: 1,
          rids: ["202609134100001"],
        },
        {
          originCrs: "BOG",
          destinationCrs: "VIC",
          publicDeparture: "0859",
          publicArrival: "0933",
          runCount: 1,
          rids: ["202609204100002"],
        },
      ],
    };
    expect(scheduleNotes(service)).toEqual([
      "On Sundays it leaves at 08:59 and arrives at 09:33",
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
      "2 journeys were booked to leave at 11:49 and arrive at 17:40",
    ]);
  });

  it("joins two Sunday arrivals at the same time into one line", () => {
    const sunday = (publicDeparture: string, rid: string) => ({
      originCrs: "CLJ",
      destinationCrs: "WAT",
      publicDeparture,
      publicArrival: "1120",
      runCount: 1,
      rids: [rid],
    });
    const service: ScheduledService = {
      ...usual,
      publicDeparture: "1206",
      publicArrival: "1316",
      variants: [
        sunday("1205", "202609137126391"),
        sunday("1206", "202609207126391"),
      ],
    };
    expect(scheduleNotes(service)).toEqual([
      "On 2 Sundays it was scheduled to arrive at 11:20 instead",
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
      "On 1 Saturday it was scheduled to arrive at 11:37 instead",
    ]);
  });

  it("joins close Sunday times into one line with a range", () => {
    const sunday = (
      publicDeparture: string,
      publicArrival: string,
      rid: string,
    ) => ({
      originCrs: "LIT",
      destinationCrs: "VIC",
      publicDeparture,
      publicArrival,
      runCount: 1,
      rids: [rid],
    });
    const service: ScheduledService = {
      ...usual,
      publicDeparture: "0926",
      publicArrival: "0958",
      variants: [
        sunday("0929", "1003", "202609137126391"),
        sunday("0929", "1005", "202610047126391"),
        sunday("0929", "1006", "202610117126391"),
      ],
    };
    expect(scheduleNotes(service)).toEqual([
      "On Sundays it leaves at 09:29 and arrives between 10:03 and 10:06",
    ]);
  });

  it("keeps Sunday times far apart on their own lines", () => {
    const service: ScheduledService = {
      ...usual,
      publicDeparture: "0840",
      publicArrival: "0911",
      variants: [
        {
          originCrs: "BTN",
          destinationCrs: "VIC",
          publicDeparture: "0843",
          publicArrival: "0915",
          runCount: 1,
          rids: ["202609134100001"],
        },
        {
          originCrs: "BTN",
          destinationCrs: "VIC",
          publicDeparture: "0852",
          publicArrival: "0925",
          runCount: 1,
          rids: ["202609204100002"],
        },
      ],
    };
    expect(scheduleNotes(service)).toEqual([
      "On Sundays it leaves at 08:43 and arrives at 09:15",
      "On Sundays it leaves at 08:52 and arrives at 09:25",
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
