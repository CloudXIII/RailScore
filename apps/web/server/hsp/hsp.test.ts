import { describe, expect, it } from "vitest";
import {
  decodeHspCalls,
  encodeHspCalls,
  historicalRunFromHsp,
  runFromDetails,
} from "./details";
import type { EarlierDaysTrain } from "@/shared/contracts";
import { matchEarlierDays, quarterOf, quartersOf } from "./match";
import { listTasks, tasksOf } from "./lists";
import { parseServiceMetrics, type HspService } from "./metrics";
import { darwinStationCode, hspStationCode } from "./stations";

function metric(tolerance: string, within: number, outside: number) {
  return {
    tolerance_value: tolerance,
    num_tolerance: String(within),
    num_not_tolerance: String(outside),
  };
}

function hspRow(
  departure: string,
  options: {
    origin?: string;
    destination?: string;
    arrival?: string;
    toc?: string;
    rids?: string[];
  } = {},
) {
  return {
    serviceAttributesMetrics: {
      origin_location: options.origin ?? "LIV",
      destination_location: options.destination ?? "MAN",
      gbtt_ptd: departure,
      gbtt_pta: options.arrival ?? "1100",
      toc_code: options.toc ?? "NT",
      matched_services: "3",
      rids: options.rids ?? ["202610200000001", "202610210000001"],
    },
    Metrics: [
      metric("5", 6, 4),
      metric("14", 8, 2),
      metric("29", 9, 1),
      metric("999", 9, 1),
    ],
  };
}

describe("parseServiceMetrics", () => {
  it("reads each train's runs and counts by tolerance", () => {
    const [service] = parseServiceMetrics({ Services: [hspRow("1015")] });
    expect(service).toEqual({
      originCrs: "LIV",
      destinationCrs: "MAN",
      publicDeparture: "1015",
      publicArrival: "1100",
      operatorCode: "NT",
      rids: ["202610200000001", "202610210000001"],
      counts: { runs: 10, within5: 6, within14: 8, within29: 9, arrived: 9 },
    });
  });

  it("keeps a train without counts when a tolerance is missing", () => {
    const row = { ...hspRow("1015"), Metrics: [metric("5", 1, 1)] };
    const [service] = parseServiceMetrics({ Services: [row] });
    expect(service?.counts).toBeUndefined();
  });

  it("gives Elizabeth line platforms Darwin's station codes", () => {
    const [service] = parseServiceMetrics({
      Services: [
        hspRow("0814", { origin: "ABX", destination: "PAA", toc: "XR" }),
      ],
    });
    expect(service).toMatchObject({ originCrs: "ABW", destinationCrs: "PAD" });
  });

  it("rejects an answer with no service list", () => {
    expect(() => parseServiceMetrics({})).toThrow();
  });
});

describe("quarters", () => {
  it("cuts departures into shared quarter-hours", () => {
    expect(quarterOf("0707")).toEqual({ fromTime: "0700", toTime: "0714" });
    expect(quarterOf("2359")).toEqual({ fromTime: "2345", toTime: "2359" });
    const trains: EarlierDaysTrain[] = [
      {
        key: "a",
        operatorCode: "NT",
        legs: [
          { originCrs: "LIV", destinationCrs: "MAN", publicDeparture: "1016" },
          { originCrs: "LIV", destinationCrs: "MAN", publicDeparture: "0959" },
        ],
      },
      {
        key: "b",
        operatorCode: "NT",
        legs: [
          { originCrs: "LIV", destinationCrs: "MAN", publicDeparture: "1029" },
        ],
      },
    ];
    expect(quartersOf(trains).map((quarter) => quarter.fromTime)).toEqual([
      "0945",
      "1015",
    ]);
  });
});

describe("matchEarlierDays", () => {
  const train = (
    key: string,
    departure: string,
    extra: EarlierDaysTrain["legs"] = [],
  ): EarlierDaysTrain => ({
    key,
    operatorCode: "NT",
    legs: [
      { originCrs: "LIV", destinationCrs: "MAN", publicDeparture: departure },
      ...extra,
    ],
  });
  const services = (rows: object[]): HspService[] =>
    parseServiceMetrics({ Services: rows });

  it("joins by operator, origin, departure and destination, and adds folded schedules", () => {
    const trains = [
      train("1015", "1015", [
        { originCrs: "LIV", destinationCrs: "MAN", publicDeparture: "1017" },
      ]),
      train("1045", "1045"),
    ];
    const joined = matchEarlierDays(
      trains,
      services([
        hspRow("1015", { rids: ["r1"] }),
        hspRow("1017", { rids: ["r2"] }),
        hspRow("1045", { toc: "TP" }),
        hspRow("1030"),
      ]),
    );
    expect([...joined.keys()]).toEqual(["1015"]);
    expect(joined.get("1015")).toEqual({
      counts: {
        runs: 20,
        within5: 12,
        within14: 16,
        within29: 18,
        arrived: 18,
      },
      rids: ["r1", "r2"],
    });
  });

  it("takes the one train with another origin, and none when two could fit", () => {
    const one = matchEarlierDays(
      [train("1015", "1015")],
      services([hspRow("1015", { origin: "LVC" })]),
    );
    expect(one.get("1015")?.counts.runs).toBe(10);
    const two = matchEarlierDays(
      [
        train("x", "1015"),
        {
          key: "y",
          operatorCode: "NT",
          legs: [
            {
              originCrs: "SOP",
              destinationCrs: "MAN",
              publicDeparture: "1015",
            },
          ],
        },
      ],
      services([hspRow("1015", { origin: "LVC" })]),
    );
    expect(two.size).toBe(0);
  });

  /** Paddington 07:50 to Great Malvern, which ran to Worcester Shrub Hill for a week of works. */
  const paddington: EarlierDaysTrain = {
    key: "0750-0816-GW-PAD-GMV",
    operatorCode: "GW",
    legs: [
      {
        originCrs: "PAD",
        destinationCrs: "GMV",
        publicDeparture: "0750",
        publicArrival: "0816",
      },
    ],
  };
  const weekdays = (dates: string[]) => dates.map((date) => `${date}8915414`);
  const toMalvern = (rids: string[]) =>
    hspRow("0750", {
      origin: "PAD",
      destination: "GMV",
      arrival: "0816",
      toc: "GW",
      rids,
    });
  const toWorcester = (rids: string[]) =>
    hspRow("0750", {
      origin: "PAD",
      destination: "WOS",
      arrival: "0816",
      toc: "GW",
      rids,
    });

  it("joins the days a train ran to another destination at the same times", () => {
    const joined = matchEarlierDays(
      [paddington],
      services([
        toMalvern(weekdays(["20261020", "20261021"])),
        toWorcester(weekdays(["20261026", "20261027"])),
      ]),
    );
    expect(joined.get(paddington.key)?.rids).toEqual(
      weekdays(["20261020", "20261021", "20261026", "20261027"]),
    );
    expect(joined.get(paddington.key)?.counts.runs).toBe(20);
  });

  it("keeps apart a train on the same days, as another portion", () => {
    const joined = matchEarlierDays(
      [paddington],
      services([
        toMalvern(weekdays(["20261020", "20261021"])),
        toWorcester(weekdays(["20261021", "20261022"])),
      ]),
    );
    expect(joined.get(paddington.key)?.rids).toEqual(
      weekdays(["20261020", "20261021"]),
    );
  });

  it("joins another destination only at the same arrival, and not without one", () => {
    const later = matchEarlierDays(
      [paddington],
      services([
        hspRow("0750", {
          origin: "PAD",
          destination: "WOS",
          arrival: "0818",
          toc: "GW",
          rids: weekdays(["20261026"]),
        }),
      ]),
    );
    expect(later.size).toBe(0);
    const { publicArrival: _, ...withoutArrival } = paddington.legs[0]!;
    const older = matchEarlierDays(
      [{ ...paddington, legs: [withoutArrival] }],
      services([toWorcester(weekdays(["20261026"]))]),
    );
    expect(older.size).toBe(0);
  });
});

describe("reason codes", () => {
  it("stores nothing for a run without codes and reads it back without any", () => {
    const calls = [
      { crs: "LIV", ptd: "1015" },
      { crs: "MAN", pta: "1100" },
    ];
    const stored = encodeHspCalls(calls);
    expect(stored.reasons).toBe("");
    expect(decodeHspCalls(stored)).toEqual(calls);
  });
});

describe("HSP runs", () => {
  const stations = { boardingCrs: "LIV", destinationCrs: "MAN" };
  const details = (locations: object[]) => ({
    serviceAttributesDetails: {
      date_of_service: "2026-10-20",
      toc_code: "NT",
      rid: "202610200000001",
      locations,
    },
  });
  const stop = (
    location: string,
    times: { ptd?: string; pta?: string; atd?: string; ata?: string },
    reason = "",
  ) => ({
    location,
    gbtt_ptd: times.ptd ?? "",
    gbtt_pta: times.pta ?? "",
    actual_td: times.atd ?? "",
    actual_ta: times.ata ?? "",
    late_canc_reason: reason,
  });

  it("reads each call with its reason code and measures lateness", () => {
    const run = runFromDetails(
      details([
        stop("LIV", { ptd: "1015", atd: "1016" }),
        stop("MAN", { pta: "1100", ata: "1108" }, "IB"),
      ]),
      "202610200000001",
    );
    expect(run).toEqual({
      rid: "202610200000001",
      serviceDate: "2026-10-20",
      toc: "NT",
      calls: [
        { crs: "LIV", ptd: "1015", atd: "1016" },
        { crs: "MAN", pta: "1100", ata: "1108", reason: "IB" },
      ],
    });
    expect(historicalRunFromHsp(run, stations)).toMatchObject({
      outcome: "arrived",
      latenessMinutes: 8,
    });
  });

  it("counts a run with no actual time anywhere as cancelled, unlike Darwin", () => {
    const run = runFromDetails(
      details([stop("LIV", { ptd: "1015" }), stop("MAN", { pta: "1100" })]),
      "202610200000001",
    );
    expect(historicalRunFromHsp(run, stations).outcome).toBe("cancelled");
  });

  it("takes the date from the RID when HSP gives none", () => {
    const run = runFromDetails(
      { serviceAttributesDetails: { locations: [] } },
      "202607174100001",
    );
    expect(run.serviceDate).toBe("2026-07-17");
  });

  it("rejects an answer that is not in the serviceDetails shape", () => {
    expect(() => runFromDetails({ Services: [] }, "202608289999999")).toThrow(
      /expected shape/,
    );
  });

  it("stores the reason codes beside the calls and reads them back", () => {
    const calls = [
      { crs: "LIV", ptd: "1015", atd: "1016" },
      { crs: "MAN", pta: "1100", ata: "1108", reason: "IB" },
    ];
    const stored = encodeHspCalls(calls);
    expect(stored).toEqual({
      calls: "LIV,,1015,,1016,,;MAN,1100,,1108,,c,",
      reasons: ";IB",
    });
    expect(decodeHspCalls(stored)).toEqual(calls);
  });

  it("keeps a flagged call stored without its code as flagged", () => {
    expect(decodeHspCalls({ calls: "MAN,1100,,,,c,", reasons: "" })).toEqual([
      { crs: "MAN", pta: "1100", reason: "" },
    ]);
  });

  it("reads an Elizabeth line run at Paddington under Darwin's code", () => {
    // Calls as HSP gave them for the 07:44 Abbey Wood to Reading on 2026-10-21.
    const run = runFromDetails(
      details([
        stop("ABX", { ptd: "0744", atd: "0744" }),
        stop("BSZ", { pta: "0809", ptd: "0809", ata: "0810", atd: "0811" }),
        stop("PAA", { pta: "0813", ptd: "0813", ata: "0813", atd: "0815" }),
        stop("RDG", { pta: "0911", ata: "0917" }, "586"),
      ]),
      "202610216737246",
    );
    expect(run.calls.map((call) => call.crs)).toEqual([
      "ABW",
      "BDS",
      "PAD",
      "RDG",
    ]);
    expect(
      historicalRunFromHsp(run, { boardingCrs: "PAD", destinationCrs: "RDG" }),
    ).toMatchObject({ outcome: "arrived", latenessMinutes: 6 });
  });

  it("counts a run that never left the boarding station as not calling", () => {
    const run = runFromDetails(
      details([
        stop("SOP", { ptd: "1000", atd: "1001" }),
        stop("LIV", { ptd: "1015" }, "TG"),
        stop("MAN", { pta: "1100", ata: "1101" }),
      ]),
      "202610200000001",
    );
    expect(historicalRunFromHsp(run, stations).outcome).toBe("did_not_call");
  });
});

describe("Elizabeth line station codes", () => {
  it("asks HSP for an Elizabeth line train under its own codes", () => {
    expect(hspStationCode("PAD", "XR")).toBe("PAA");
    expect(hspStationCode("ABW", "XR")).toBe("ABX");
    expect(hspStationCode("RDG", "XR")).toBe("RDG");
    expect(hspStationCode("PAD", "GW")).toBe("PAD");
  });

  it("reads HSP's codes back as Darwin's and leaves the rest", () => {
    expect(darwinStationCode("PAA")).toBe("PAD");
    expect(darwinStationCode("LIX")).toBe("LST");
    expect(darwinStationCode("RDG")).toBe("RDG");
  });
});

describe("listTasks", () => {
  const span = { from: "2026-10-06", to: "2026-11-03" };
  const train = (key: string, operatorCode: string, departure: string) => ({
    key,
    operatorCode,
    legs: [
      { originCrs: "PAD", destinationCrs: "RDG", publicDeparture: departure },
    ],
  });
  const greatWestern = train("gw", "GW", "0738");
  const elizabeth = train("xr", "XR", "0731");

  it("gives an Elizabeth line train its own list at the stations HSP names", () => {
    const route = { fromCrs: "PAD", toCrs: "RDG" };
    const tasks = listTasks(
      route,
      [greatWestern, elizabeth],
      ["weekdays"],
      span,
    );
    expect(tasks.map((task) => task.key)).toEqual([
      "PAD|RDG|weekdays|0730|2026-10-06|2026-11-03",
      "PAA|RDG|weekdays|0730|2026-10-06|2026-11-03",
    ]);
    expect(tasksOf(route, elizabeth, tasks).map((task) => task.key)).toEqual([
      "PAA|RDG|weekdays|0730|2026-10-06|2026-11-03",
    ]);
    expect(tasksOf(route, greatWestern, tasks)).toHaveLength(1);
  });

  it("shares one list where both operators use the same codes", () => {
    const route = { fromCrs: "RDG", toCrs: "TWY" };
    const tasks = listTasks(
      route,
      [greatWestern, elizabeth],
      ["weekdays", "saturday"],
      span,
    );
    expect(tasks.map((task) => task.key)).toEqual([
      "RDG|TWY|weekdays|0730|2026-10-06|2026-11-03",
      "RDG|TWY|saturday|0730|2026-10-06|2026-11-03",
    ]);
    expect(tasksOf(route, elizabeth, tasks)).toEqual(tasks);
  });
});
