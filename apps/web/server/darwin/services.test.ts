import { searchClockRange } from "@railscore/core";
import { describe, expect, it } from "vitest";
import type { DarwinRun, StoredCall } from "./run";
import {
  servicesFromRuns,
  trainPage,
  uidsLeaving,
  type DarwinSearch,
} from "./services";
import type { ScheduledService } from "../services/map";
import { searchPeriods } from "../hsp/period";

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

/** The list for the hour from the searched time, as a page of that hour would ask for. */
function listOf(
  runs: readonly DarwinRun[],
  search: DarwinSearch,
  input: { today: string; todayTimetable: boolean; oldest: string },
) {
  return servicesFromRuns(
    runs,
    search,
    {
      today: input.today,
      todayTimetable: input.todayTimetable,
      countedFrom: input.oldest,
      period: searchPeriods(
        search.periodDays,
        new Date(`${input.today}T12:00:00Z`),
        input.oldest,
        false,
      ).period,
    },
    searchClockRange(search.timeHhmm),
  );
}

describe("servicesFromRuns", () => {
  it("lists today's trains with their past runs, leaving today's run uncounted", () => {
    const list = listOf(
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

  it("lets a run before the first whole Darwin day pick the train without counting it", () => {
    const list = listOf(
      [
        run("2026-11-02", "0000001", { actualArrival: "0823" }),
        run("2026-11-03", "0000001", { actualArrival: "0840" }),
        run(today, "0000001"),
      ],
      search,
      { today, todayTimetable: true, oldest: "2026-11-03" },
    );
    expect(list?.services[0]).toMatchObject({
      rids: ["202611030000001"],
      punctuality: { runs: 1, within5: 0, within14: 0, within29: 1 },
    });
    expect(list?.period).toEqual({ from: "2026-11-03", to: "2026-11-03" });
  });

  it("counts a cancelled run as outside every tolerance", () => {
    const list = listOf(
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
    const list = listOf(
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
    const list = listOf(
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
    const list = listOf(
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
    const list = listOf(
      [loop, run("2026-11-03", "0000001", { actualArrival: "0823" })],
      search,
      { today, todayTimetable: false, oldest: "2026-11-01" },
    );
    expect(list?.services.map((service) => service.publicDeparture)).toEqual([
      "0812",
    ]);
  });

  it("keeps a Wirral line train that called at the destination on its way in", () => {
    // Merseyrail C08015 of 3 November 2026, cut to the calls that matter.
    const wirral: DarwinRun = {
      rid: "202611030000006",
      serviceDate: "2026-11-03",
      uid: "C08015",
      toc: "ME",
      calls: [
        { crs: "CTR", ptd: "1842" },
        { crs: "PSL", pta: "1908", ptd: "1908" },
        { crs: "LVJ", pta: "1924", ptd: "1924" },
        { crs: "LVC", pta: "1929", ptd: "1929", atd: "1929" },
        { crs: "LVJ", pta: "1931", ptd: "1931" },
        { crs: "PSL", pta: "1946", ptd: "1947", ata: "1946" },
        { crs: "CTR", pta: "2015" },
      ],
    };
    const list = listOf(
      [wirral],
      { ...search, fromCrs: "LVC", toCrs: "PSL", timeHhmm: "1900" },
      { today, todayTimetable: false, oldest: "2026-11-01" },
    );
    expect(list?.services).toHaveLength(1);
    expect(list?.services[0]).toMatchObject({
      publicDeparture: "1929",
      publicArrival: "1946",
      operatorCode: "ME",
    });
  });

  it("lists a train that passes the boarding station twice at its later call", () => {
    // SW 202611047683639 of 4 November 2026: Waterloo round the Kingston loop and back.
    const kingston: DarwinRun = {
      rid: "202611030000007",
      serviceDate: "2026-11-03",
      uid: "W77777",
      toc: "SW",
      calls: [
        { crs: "WAT", ptd: "0730" },
        { crs: "CLJ", pta: "0740", ptd: "0740", atd: "0741" },
        { crs: "KNG", pta: "0816", ptd: "0818" },
        { crs: "CLJ", pta: "0839", ptd: "0840", atd: "0839" },
        { crs: "WAT", pta: "0849", ata: "0848" },
      ],
    };
    const list = listOf(
      [kingston, run("2026-11-03", "0000001", { actualArrival: "0823" })],
      search,
      { today, todayTimetable: false, oldest: "2026-11-01" },
    );
    expect(
      list?.services.map((service) => [
        service.publicDeparture,
        service.publicArrival,
        service.punctuality,
      ]),
    ).toEqual([
      ["0812", "0823", { runs: 1, within5: 1, within14: 1, within29: 1 }],
      ["0840", "0849", { runs: 1, within5: 1, within14: 1, within29: 1 }],
    ]);
  });

  it("returns nothing when no stored run fits the search", () => {
    expect(
      listOf([], search, {
        today,
        todayTimetable: true,
        oldest: today,
      }),
    ).toBeUndefined();
  });
});

describe("trainPage", () => {
  const train = (departure: string): ScheduledService => ({
    originCrs: "CLJ",
    destinationCrs: "WAT",
    publicDeparture: departure,
    publicArrival: departure,
    operatorCode: "SW",
    rids: [],
    days: ["weekdays"],
  });
  const departures = (page: ReturnType<typeof trainPage>) =>
    page.services.map((service) => service.publicDeparture);

  it("lists the next trains on a busy route and links to the trains either side", () => {
    const busy = Array.from({ length: 30 }, (_, index) =>
      train(`08${String(index * 2).padStart(2, "0")}`),
    );
    const page = trainPage(busy, "0820", 4);
    expect(departures(page)).toEqual(["0820", "0822", "0824", "0826"]);
    expect(page.window).toEqual({ from: "0820", to: "0826" });
    expect(page.earlier).toBe("0812");
    expect(page.later).toBe("0828");
  });

  it("reaches past the hour on a quiet route", () => {
    const quiet = ["0615", "0930", "1345", "1810"].map(train);
    const page = trainPage(quiet, "0700", 2);
    expect(departures(page)).toEqual(["0930", "1345"]);
    expect(page.earlier).toBe("0615");
    expect(page.later).toBe("1810");
  });

  it("keeps trains that leave at the same minute together", () => {
    const page = trainPage(
      ["0800", "0805", "0805", "0810"].map(train),
      "0800",
      2,
    );
    expect(departures(page)).toEqual(["0800", "0805", "0805"]);
    expect(page.later).toBe("0810");
  });

  it("offers no earlier trains at the start of the day and none later at the end", () => {
    const page = trainPage(["0600", "0700"].map(train), "0500", 8);
    expect(departures(page)).toEqual(["0600", "0700"]);
    expect(page.earlier).toBeUndefined();
    expect(page.later).toBeUndefined();
  });

  it("lists nothing after the last train, but links back to it", () => {
    const page = trainPage(["0600", "0700"].map(train), "2300", 8);
    expect(page.services).toEqual([]);
    expect(page.window).toBeUndefined();
    expect(page.earlier).toBe("0600");
  });
});

describe("uidsLeaving", () => {
  it("names only the trains that board in the window", () => {
    const runs = [
      run(today, "0000001", { uid: "W00001", departure: "0812" }),
      run(today, "0000002", { uid: "W00002", departure: "0912" }),
      run("2026-11-03", "0000003", { uid: "W00001", departure: "0812" }),
    ];
    expect(uidsLeaving(runs, search, { from: "0800", to: "0830" })).toEqual([
      "W00001",
    ]);
  });
});
