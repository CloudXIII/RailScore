import { describe, expect, it } from "vitest";
import {
  lastRunDate,
  listServices,
  matchesServiceKey,
  serviceKey,
  type ScheduledService,
} from "./fold";
import type { ServiceDay } from "../day-type";

/** The list's folding alone: a period end so early that no train is set apart as retired. */
function mergeServices(groups: ScheduledService[][]): ScheduledService[] {
  return listServices(groups, "2000-01-01").services;
}

describe("mergeServices", () => {
  it("unions run identifiers and day types for the same public service", () => {
    const first: ScheduledService = {
      originCrs: "LIV",
      destinationCrs: "MIA",
      publicDeparture: "0630",
      publicArrival: "0721",
      operatorCode: "NT",
      rids: ["run-1", "run-2"],
      days: [],
    };
    const weekday = { ...first, days: ["weekdays"] as const };
    const saturday = {
      ...first,
      rids: ["run-2", "run-3"],
      days: ["saturday"] as const,
    };
    expect(mergeServices([[weekday], [saturday]])).toEqual([
      {
        ...first,
        rids: ["run-1", "run-2", "run-3"],
        days: ["weekdays", "saturday"],
      },
    ]);
  });

  it("counts a repeated run identifier once", () => {
    const service: ScheduledService = {
      originCrs: "LIV",
      destinationCrs: "MIA",
      publicDeparture: "0630",
      publicArrival: "0721",
      operatorCode: "NT",
      rids: ["202607120000001", "202607120000001", "202607190000002"],
      days: ["weekdays"],
    };
    const [merged] = mergeServices([[service]]);

    expect(merged?.rids).toEqual(["202607120000001", "202607190000002"]);
  });

  it("adds up the counts across day types and folded schedules", () => {
    const base = {
      originCrs: "LIV",
      destinationCrs: "CLE",
      publicArrival: "1113",
      operatorCode: "TP",
    };
    const weekday: ScheduledService = {
      ...base,
      publicDeparture: "1020",
      rids: ["202610051020001", "202610061020002"],
      days: ["weekdays"],
      punctuality: { runs: 2, within5: 1, within14: 2, within29: 2 },
    };
    const saturday: ScheduledService = {
      ...base,
      publicDeparture: "1020",
      rids: ["202610031020003"],
      days: ["saturday"],
      punctuality: { runs: 1, within5: 0, within14: 0, within29: 1 },
    };
    const once: ScheduledService = {
      ...base,
      publicDeparture: "1021",
      rids: ["202610071021004"],
      days: ["weekdays"],
      punctuality: { runs: 1, within5: 1, within14: 1, within29: 1 },
    };
    const [merged] = mergeServices([[weekday, once], [saturday]]);
    expect(merged?.rids).toHaveLength(4);
    expect(merged?.punctuality).toEqual({
      runs: 4,
      within5: 2,
      within14: 3,
      within29: 4,
    });
  });

  it("drops the count when a joined part has none", () => {
    const counted: ScheduledService = {
      originCrs: "LIV",
      destinationCrs: "CLE",
      publicDeparture: "1020",
      publicArrival: "1113",
      operatorCode: "TP",
      rids: ["202610051020001"],
      days: ["weekdays"],
      punctuality: { runs: 1, within5: 1, within14: 1, within29: 1 },
    };
    const uncounted: ScheduledService = {
      ...counted,
      rids: ["202610031020003"],
      days: ["saturday"],
      punctuality: undefined,
    };
    const [merged] = mergeServices([[counted], [uncounted]]);
    expect(merged?.punctuality).toBeUndefined();
  });
});

function isSunday(rid: string): boolean {
  return (
    new Date(
      `${rid.slice(0, 4)}-${rid.slice(4, 6)}-${rid.slice(6, 8)}T00:00:00Z`,
    ).getUTCDay() === 0
  );
}

describe("listServices", () => {
  function service(
    departure: string,
    runs: string[],
    days: ServiceDay[],
  ): ScheduledService {
    return {
      originCrs: "CTR",
      destinationCrs: "CTR",
      publicDeparture: departure,
      publicArrival: "1212",
      operatorCode: "ME",
      rids: runs,
      days,
    };
  }

  it("sets apart a train that stopped running after a timetable change", () => {
    const old = service(
      "1131",
      ["202609144100001", "202609184100002"],
      ["weekdays"],
    );
    const current = service(
      "1142",
      ["202609214100003", "202610124100004"],
      ["weekdays"],
    );
    const listed = listServices([[old, current]], "2026-10-12");
    expect(listed.services.map((entry) => entry.publicDeparture)).toEqual([
      "1142",
    ]);
    expect(listed.retired.map((entry) => entry.publicDeparture)).toEqual([
      "1131",
    ]);
    expect(lastRunDate(listed.retired[0]!)).toBe("2026-09-18");
  });

  it("keeps a train that last ran within two weeks of the period end", () => {
    const sunday = service(
      "1149",
      ["202609274100001", "202609284100002"],
      ["sunday"],
    );
    expect(listServices([[sunday]], "2026-10-12").retired).toEqual([]);
  });

  it("joins a run with no public arrival onto the one matching departure", () => {
    const usual = service(
      "1030",
      ["202610011030001", "202610021030002"],
      ["weekdays"],
    );
    const cancelled = {
      ...service("1030", ["202609041030003"], ["weekdays"]),
      publicArrival: "",
    };
    const other = service("1045", ["202610031045001"], ["weekdays"]);
    const listed = listServices([[usual, cancelled, other]], "2026-10-12");
    expect(listed.services.map((entry) => entry.publicDeparture)).toEqual([
      "1030",
      "1045",
    ]);
    expect(listed.services[0]?.rids).toContain("202609041030003");
    expect(listed.services[0]?.variants).toBeUndefined();
    expect(listed.services.every((entry) => entry.publicArrival)).toBe(true);
  });

  it("leaves a run with no public arrival out when two departures could take it", () => {
    const first = service("1000", ["202610011000001"], ["weekdays"]);
    const second = service("1003", ["202610021003001"], ["weekdays"]);
    const cancelled = {
      ...service("1002", ["202609041002003"], ["weekdays"]),
      publicArrival: "",
    };
    const listed = listServices([[first, second, cancelled]], "2026-10-12");
    expect(listed.services.flatMap((entry) => entry.rids)).not.toContain(
      "202609041002003",
    );
  });
});

describe("mergeServices folding the same train", () => {
  /** Synthetic RIDs that start with the run date, like the live ones. */
  function rids(firstDate: string, count: number, step = 7): string[] {
    const start = Date.parse(`${firstDate}T00:00:00Z`);
    return Array.from({ length: count }, (_, index) => {
      const date = new Date(start + index * step * 86_400_000)
        .toISOString()
        .slice(0, 10)
        .replaceAll("-", "");
      return `${date}${String(1000000 + index)}`;
    });
  }

  function train(
    departure: string,
    arrival: string,
    runs: string[],
    days: ServiceDay[],
    overrides: Partial<ScheduledService> = {},
  ): ScheduledService {
    return {
      originCrs: "LIV",
      destinationCrs: "CLE",
      publicDeparture: departure,
      publicArrival: arrival,
      operatorCode: "TP",
      rids: runs,
      days,
      ...overrides,
    };
  }

  it("folds a one-off minute change into the usual schedule on the same day type", () => {
    const usual = train("1020", "1113", rids("2026-07-12", 12), ["sunday"]);
    const once = train("1021", "1113", rids("2026-10-04", 1), ["sunday"]);
    const [merged, ...rest] = mergeServices([[once, usual]]);
    expect(rest).toEqual([]);
    expect(merged?.publicDeparture).toBe("1020");
    expect(merged?.rids).toHaveLength(13);
    expect(merged?.variants).toEqual([
      {
        originCrs: "LIV",
        destinationCrs: "CLE",
        publicDeparture: "1021",
        publicArrival: "1113",
        runCount: 1,
        rids: once.rids,
      },
    ]);
  });

  it("folds weekend schedules of one departure when the journey stays about as long", () => {
    const weekday = train(
      "1052",
      "1640",
      rids("2026-09-14", 21, 1),
      ["weekdays"],
      { operatorCode: "VT" },
    );
    const saturdays = [
      train("1052", "1638", rids("2026-08-01", 1), ["saturday"], {
        operatorCode: "VT",
      }),
      train("1052", "1654", rids("2026-08-08", 1), ["saturday"], {
        operatorCode: "VT",
      }),
    ];
    const sundays = [
      train("1051", "1639", rids("2026-08-02", 1), ["sunday"], {
        operatorCode: "VT",
      }),
      train("1051", "1645", rids("2026-08-09", 1), ["sunday"], {
        operatorCode: "VT",
      }),
      train("1051", "1656", rids("2026-08-16", 1), ["sunday"], {
        operatorCode: "VT",
      }),
    ];
    const merged = mergeServices([[weekday], saturdays, sundays]);
    const main = merged.find((service) => service.publicArrival === "1640");
    const longer = merged.find((service) => service.publicArrival === "1656");
    expect(main?.days).toEqual(["weekdays", "saturday", "sunday"]);
    expect(main?.variants).toHaveLength(4);
    expect(main?.rids).toHaveLength(25);
    expect(longer?.rids).toHaveLength(1);
  });

  it("keeps a same departure apart when the journey is an hour longer", () => {
    const usual = train("0814", "1027", rids("2026-09-14", 12), ["saturday"]);
    const retimed = train("0814", "1137", ["202610104100099"], ["saturday"]);
    const merged = mergeServices([[usual, retimed]]);
    expect(merged).toHaveLength(2);
    expect(merged.map((service) => service.publicArrival)).toEqual([
      "1027",
      "1137",
    ]);
    expect(merged.every((service) => service.variants === undefined)).toBe(
      true,
    );
  });

  it("keeps a retimed run with its own departure rather than a nearby train", () => {
    const fast = train(
      "0814",
      "1027",
      rids("2026-09-14", 20, 1),
      ["weekdays", "saturday"],
      { operatorCode: "VT" },
    );
    const retimed = train("0814", "1137", ["202610104100099"], ["saturday"], {
      operatorCode: "VT",
    });
    const sunday = train("0820", "1110", rids("2026-09-13", 5), ["sunday"], {
      operatorCode: "VT",
    });
    const merged = mergeServices([[fast, retimed], [sunday]]);
    expect(merged.map((service) => service.publicDeparture)).toEqual([
      "0814",
      "0814",
      "0820",
    ]);
    expect(merged.map((service) => service.publicArrival)).toEqual([
      "1027",
      "1137",
      "1110",
    ]);
    expect(
      merged.every((service) => (service.variants ?? []).length === 0),
    ).toBe(true);
  });

  it("does not fold a much longer journey into a nearby departure on other days", () => {
    const sunday = train("0820", "1110", rids("2026-09-13", 5), ["sunday"], {
      operatorCode: "VT",
    });
    const saturday = train("0814", "1137", ["202610104100099"], ["saturday"], {
      operatorCode: "VT",
    });
    expect(mergeServices([[sunday], [saturday]])).toHaveLength(2);
  });

  it("folds a run that finished at another station when the passenger's times match", () => {
    const norwich = train(
      "1051",
      "1141",
      rids("2026-07-11", 12),
      ["weekdays", "saturday"],
      {
        operatorCode: "EM",
        destinationCrs: "NRW",
      },
    );
    const nottingham = train(
      "1051",
      "1141",
      rids("2026-10-03", 1),
      ["saturday"],
      {
        operatorCode: "EM",
        destinationCrs: "NOT",
      },
    );
    const merged = mergeServices([[norwich], [nottingham]]);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.destinationCrs).toBe("NRW");
    expect(merged[0]?.variants?.[0]?.destinationCrs).toBe("NOT");
  });

  it("folds one departure across day types and keeps every day type", () => {
    const weekday = train("1019", "1111", rids("2026-07-13", 20), [
      "weekdays",
      "saturday",
    ]);
    const sunday = train("1020", "1113", rids("2026-07-12", 12), ["sunday"]);
    const merged = mergeServices([[weekday], [sunday]]);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.days).toEqual(["weekdays", "saturday", "sunday"]);
  });

  it("folds the Sunday train into the Monday-to-Saturday one it replaces", () => {
    const weekly = train(
      "1143",
      "1234",
      rids("2026-09-14", 20, 1).filter((rid) => !isSunday(rid)),
      ["weekdays", "saturday"],
      {
        operatorCode: "AW",
      },
    );
    const sunday = train("1149", "1235", rids("2026-09-13", 5), ["sunday"], {
      operatorCode: "AW",
    });
    const merged = mergeServices([[weekly], [sunday]]);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.publicDeparture).toBe("1143");
    expect(merged[0]?.days).toEqual(["weekdays", "saturday", "sunday"]);
    expect(
      merged[0]?.variants?.map((variant) => [
        variant.publicDeparture,
        variant.runCount,
      ]),
    ).toEqual([["1149", 5]]);
  });

  it("keeps a train for other days apart when two trains could have been the one it replaces", () => {
    const first = train(
      "1142",
      "1227",
      rids("2026-09-14", 5, 1),
      ["weekdays"],
      { operatorCode: "ME" },
    );
    const second = train(
      "1150",
      "1235",
      rids("2026-09-21", 5, 1),
      ["weekdays"],
      { operatorCode: "ME" },
    );
    const sunday = train("1146", "1231", rids("2026-09-13", 3), ["sunday"], {
      operatorCode: "ME",
    });
    expect(mergeServices([[first, second], [sunday]])).toHaveLength(3);
  });

  it("does not stretch to other days when the trains share a day type", () => {
    const weekday = train(
      "1143",
      "1234",
      rids("2026-09-14", 5, 1),
      ["weekdays"],
      { operatorCode: "AW" },
    );
    const both = train(
      "1149",
      "1235",
      rids("2026-08-01", 3),
      ["weekdays", "sunday"],
      { operatorCode: "AW" },
    );
    expect(mergeServices([[weekday, both]])).toHaveLength(2);
  });

  it("keeps two schedules apart when both ran on the same date", () => {
    const first = train("1020", "1113", rids("2026-07-12", 12), ["sunday"]);
    const second = train("1021", "1114", rids("2026-07-19", 1), ["sunday"]);
    expect(mergeServices([[first, second]])).toHaveLength(2);
  });

  it("compares each schedule with the usual one, so small steps do not chain", () => {
    const usual = train("1019", "1111", rids("2026-07-13", 10, 1), [
      "weekdays",
    ]);
    const nearer = train("1021", "1113", rids("2026-08-13", 5, 1), [
      "weekdays",
    ]);
    const further = train("1023", "1113", rids("2026-09-13", 3, 1), [
      "weekdays",
    ]);
    const merged = mergeServices([[usual, nearer, further]]);
    expect(
      merged.map((service) => [service.publicDeparture, service.rids.length]),
    ).toEqual([
      ["1019", 15],
      ["1023", 3],
    ]);
  });

  it("keeps different operators apart", () => {
    const transPennine = train("1020", "1113", rids("2026-07-12", 12), [
      "sunday",
    ]);
    const northern = train("1021", "1113", rids("2026-10-04", 1), ["sunday"], {
      operatorCode: "NT",
    });
    expect(mergeServices([[transPennine, northern]])).toHaveLength(2);
  });

  it("does not fold a schedule whose runs have no readable date", () => {
    const usual = train("1020", "1113", rids("2026-07-12", 12), ["sunday"]);
    const undated = train("1021", "1113", ["run-x"], ["sunday"]);
    expect(mergeServices([[usual, undated]])).toHaveLength(2);
  });

  it("finds the train from the key of a folded schedule", () => {
    const usual = train("1020", "1113", rids("2026-07-12", 12), ["sunday"]);
    const once = train("1021", "1113", rids("2026-10-04", 1), ["sunday"]);
    const [merged] = mergeServices([[usual, once]]);
    if (!merged) {
      throw new Error("expected a service");
    }
    expect(matchesServiceKey(merged, serviceKey(usual))).toBe(true);
    expect(matchesServiceKey(merged, serviceKey(once))).toBe(true);
    expect(
      matchesServiceKey(
        merged,
        serviceKey({ ...once, publicDeparture: "1022" }),
      ),
    ).toBe(false);
  });
});
