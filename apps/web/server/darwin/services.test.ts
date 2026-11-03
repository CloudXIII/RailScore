import { describe, expect, it } from "vitest";
import type { DarwinRun, StoredCall } from "./run";
import { servicesFromRuns, type DarwinSearch } from "./services";

const search: DarwinSearch = {
  fromCrs: "CLJ",
  toCrs: "WAT",
  timeHhmm: "0800",
  days: "weekdays",
  periodDays: 30,
};

/** Wednesday 4 November 2026. Monday 2 and Tuesday 3 are past weekdays, Saturday 31 October is not. */
const today = "2026-11-04";

function run(
  date: string,
  id: string,
  options: {
    uid?: string;
    departure?: string;
    arrival?: string;
    actualArrival?: string;
    cancelled?: boolean;
  } = {},
): DarwinRun {
  const departure = options.departure ?? "0812";
  const arrival = options.arrival ?? "0823";
  const calls: StoredCall[] = [
    { crs: "WOK", ptd: "0750", ...(options.cancelled ? {} : { atd: "0750" }) },
    {
      crs: "CLJ",
      pta: departure,
      ptd: departure,
      ...(options.cancelled ? { cancelled: true } : { atd: departure }),
    },
    {
      crs: "WAT",
      pta: arrival,
      ...(options.cancelled
        ? { cancelled: true }
        : options.actualArrival
          ? { ata: options.actualArrival }
          : {}),
    },
  ];
  return {
    rid: `${date.replaceAll("-", "")}${id}`,
    serviceDate: date,
    uid: options.uid ?? "W12345",
    toc: "SW",
    calls,
  };
}

describe("servicesFromRuns", () => {
  it("lists today's trains with their past runs, leaving today's run uncounted", () => {
    const list = servicesFromRuns(
      [
        run("2026-11-02", "0000001", { actualArrival: "0823" }),
        run("2026-11-03", "0000001", { actualArrival: "0840" }),
        run(today, "0000001"),
      ],
      search,
      { today, todayTimetable: true, oldest: "2026-11-02" },
    );
    expect(list?.timetableDate).toBe(today);
    expect(list?.services).toHaveLength(1);
    expect(list?.services[0]).toMatchObject({
      originCrs: "WOK",
      destinationCrs: "WAT",
      publicDeparture: "0812",
      publicArrival: "0823",
      operatorCode: "SW",
      rids: ["202611020000001", "202611030000001"],
      days: ["weekdays"],
      punctuality: { runs: 2, within5: 1, within14: 1, within29: 2 },
    });
    expect(list?.period).toEqual({ from: "2026-11-02", to: "2026-11-03" });
  });

  it("counts a cancelled run as outside every tolerance", () => {
    const list = servicesFromRuns(
      [
        run("2026-11-03", "0000001", { cancelled: true }),
        run(today, "0000001"),
      ],
      search,
      { today, todayTimetable: true, oldest: "2026-11-01" },
    );
    expect(list?.services[0]?.punctuality).toEqual({
      runs: 1,
      within5: 0,
      within14: 0,
      within29: 0,
    });
  });

  it("sets apart a train that ran in the period but is not in today's timetable", () => {
    const list = servicesFromRuns(
      [
        run("2026-11-03", "0000001", { actualArrival: "0823" }),
        run("2026-11-03", "0000002", {
          uid: "W99999",
          departure: "0842",
          arrival: "0853",
          actualArrival: "0853",
        }),
        run(today, "0000001"),
      ],
      search,
      { today, todayTimetable: true, oldest: "2026-11-01" },
    );
    expect(list?.services.map((service) => service.publicDeparture)).toEqual([
      "0812",
    ]);
    expect(list?.retired.map((service) => service.publicDeparture)).toEqual([
      "0842",
    ]);
  });

  it("keeps to the departure window and the chosen day type", () => {
    const list = servicesFromRuns(
      [
        run("2026-11-03", "0000001", { actualArrival: "0823" }),
        run("2026-11-03", "0000002", { departure: "0905", arrival: "0916" }),
        run("2026-10-31", "0000003", { actualArrival: "0823" }),
      ],
      search,
      { today, todayTimetable: false, oldest: "2026-10-30" },
    );
    expect(list?.services).toHaveLength(1);
    expect(list?.services[0]?.rids).toEqual(["202611030000001"]);
  });

  it("starts from the latest past day of the type while today's timetable is not loaded", () => {
    const list = servicesFromRuns(
      [
        run("2026-11-03", "0000001", { actualArrival: "0823" }),
        run(today, "0000009", { departure: "0830", arrival: "0841" }),
      ],
      search,
      { today, todayTimetable: false, oldest: "2026-11-01" },
    );
    expect(list?.timetableDate).toBe("2026-11-03");
    expect(list?.services.map((service) => service.publicDeparture)).toEqual([
      "0812",
    ]);
  });

  it("leaves out a loop that starts at the destination and comes back to it", () => {
    const loop: DarwinRun = {
      rid: "202611030000005",
      serviceDate: "2026-11-03",
      uid: "W55555",
      toc: "SW",
      calls: [
        { crs: "WAT", ptd: "0750" },
        { crs: "CLJ", pta: "0805", ptd: "0806" },
        { crs: "HOU", pta: "0830", ptd: "0831" },
        { crs: "WAT", pta: "0919" },
      ],
    };
    const list = servicesFromRuns(
      [loop, run("2026-11-03", "0000001", { actualArrival: "0823" })],
      search,
      { today, todayTimetable: false, oldest: "2026-11-01" },
    );
    expect(list?.services.map((service) => service.publicDeparture)).toEqual([
      "0812",
    ]);
  });

  it("returns nothing when no stored run fits the search", () => {
    expect(
      servicesFromRuns([], search, {
        today,
        todayTimetable: true,
        oldest: today,
      }),
    ).toBeUndefined();
  });
});
