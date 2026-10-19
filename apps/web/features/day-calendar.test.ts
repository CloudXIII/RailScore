import { describe, expect, it } from "vitest";
import {
  calendarMonths,
  timetableChangeLabel,
  timetableMarks,
} from "./day-grid";

describe("calendarMonths", () => {
  it("splits a period across months and leaves days with no run empty", () => {
    const months = calendarMonths({ from: "2026-09-08", to: "2026-10-07" }, [
      { serviceDate: "2026-09-08", kind: "on_time", latenessMinutes: 2 },
    ]);
    expect(months.map((month) => month.label)).toEqual(["Sept", "Oct"]);
    expect(months[0]?.weekdays).toEqual([
      "Mon",
      "Tue",
      "Wed",
      "Thu",
      "Fri",
      "Sat",
      "Sun",
    ]);
    const weekdays = calendarMonths(
      { from: "2026-09-08", to: "2026-10-07" },
      [],
      "weekdays",
    );
    expect(weekdays[0]?.weekdays).toEqual(["Mon", "Tue", "Wed", "Thu", "Fri"]);
    const firstWeek = months[0]?.weeks[0];
    expect(firstWeek?.[1]).toEqual({
      kind: "run",
      date: "2026-09-08",
      mark: { serviceDate: "2026-09-08", kind: "on_time", latenessMinutes: 2 },
    });
    expect(firstWeek?.[2]).toEqual({ kind: "empty", date: "2026-09-09" });
  });
});

describe("timetableMarks", () => {
  it("gives each distinct timetable one number, in the order it first runs", () => {
    const { marks, byDate } = timetableMarks([
      {
        serviceDate: "2026-09-20",
        publicDeparture: "1149",
        publicArrival: "1235",
      },
      {
        serviceDate: "2026-09-13",
        publicDeparture: "1149",
        publicArrival: "1235",
      },
      {
        serviceDate: "2026-09-14",
        publicDeparture: "1205",
        publicArrival: "1255",
      },
    ]);
    expect(marks).toEqual([
      { number: 1, publicDeparture: "1149", publicArrival: "1235" },
      { number: 2, publicDeparture: "1205", publicArrival: "1255" },
    ]);
    expect(byDate.get("2026-09-13")).toBe(1);
    expect(byDate.get("2026-09-20")).toBe(1);
    expect(byDate.get("2026-09-14")).toBe(2);
  });
});

describe("timetableChangeLabel", () => {
  it("reads out the times the train kept that day", () => {
    expect(
      timetableChangeLabel({ publicDeparture: "1051", publicArrival: "1656" }),
    ).toBe(", different timetable: 10:51–16:56");
  });
});
