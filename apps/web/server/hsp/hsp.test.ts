import { describe, expect, it } from "vitest";
import { historicalRunFromDarwin } from "../darwin/run";
import {
  decodeReasons,
  encodeReasons,
  historicalRunFromHsp,
  runFromDetails,
} from "./details";
import {
  matchBacklog,
  quarterOf,
  quartersOf,
  type BacklogTrain,
} from "./match";
import { addCounts, parseServiceMetrics, type HspService } from "./metrics";

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

  it("rejects an answer with no service list", () => {
    expect(() => parseServiceMetrics({})).toThrow();
  });
});

describe("addCounts", () => {
  it("adds every field", () => {
    const one = { runs: 3, within5: 1, within14: 2, within29: 2, arrived: 3 };
    expect(addCounts(one, one)).toEqual({
      runs: 6,
      within5: 2,
      within14: 4,
      within29: 4,
      arrived: 6,
    });
  });
});

describe("quarters", () => {
  it("cuts departures into shared quarter-hours", () => {
    expect(quarterOf("0707")).toEqual({ fromTime: "0700", toTime: "0714" });
    expect(quarterOf("2359")).toEqual({ fromTime: "2345", toTime: "2359" });
    const trains: BacklogTrain[] = [
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

describe("matchBacklog", () => {
  const train = (
    key: string,
    departure: string,
    extra: BacklogTrain["legs"] = [],
  ): BacklogTrain => ({
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
    const joined = matchBacklog(
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
    const one = matchBacklog(
      [train("1015", "1015")],
      services([hspRow("1015", { origin: "LVC" })]),
    );
    expect(one.get("1015")?.counts.runs).toBe(10);
    const two = matchBacklog(
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
  const paddington: BacklogTrain = {
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
    const joined = matchBacklog(
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
    const joined = matchBacklog(
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
    const later = matchBacklog(
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
    const older = matchBacklog(
      [{ ...paddington, legs: [withoutArrival] }],
      services([toWorcester(weekdays(["20261026"]))]),
    );
    expect(older.size).toBe(0);
  });
});

describe("reason codes", () => {
  it("stores nothing for a run without codes and reads it back as empty", () => {
    expect(encodeReasons(["", ""])).toBe("");
    expect(decodeReasons("", 3)).toEqual(["", "", ""]);
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

  it("stores the calls in the Darwin shape and measures lateness", () => {
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
      uid: "",
      toc: "NT",
      calls: [
        { crs: "LIV", ptd: "1015", atd: "1016" },
        { crs: "MAN", pta: "1100", ata: "1108", cancelled: true },
      ],
      reasons: ["", "IB"],
    });
    expect(encodeReasons(run.reasons)).toBe(";IB");
    expect(decodeReasons(";IB", 2)).toEqual(["", "IB"]);
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
    expect(historicalRunFromDarwin(run, stations).outcome).toBe(
      "missing_actual",
    );
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
