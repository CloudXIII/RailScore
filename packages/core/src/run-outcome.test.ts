import { describe, expect, it } from "vitest";
import { classifyRun, passengerLeg, type Call } from "./run-outcome";

const leedsToManchester = { boardingCrs: "LDS", destinationCrs: "MAN" };

/** A call timetabled at 06:00 both ways. `actual` is both actual times, "" for none. */
function stop(crs: string, actual: string, reason?: string): Call {
  return {
    crs,
    pta: "0600",
    ptd: "0600",
    ...(actual ? { ata: actual, atd: actual } : {}),
    ...(reason === undefined ? {} : { reason }),
  };
}

function run(id: string, calls: Call[], serviceDate = "2026-08-28") {
  return { id, serviceDate, calls };
}

describe("classifyRun", () => {
  it("measures lateness from the passenger destination", () => {
    expect(
      classifyRun(
        {
          id: "run-1",
          calls: [
            { crs: "LIV", ptd: "0630", atd: "0631" },
            { crs: "MIA", pta: "0721", ata: "0728" },
          ],
        },
        { boardingCrs: "LIV", destinationCrs: "MIA" },
      ),
    ).toEqual({ id: "run-1", outcome: "arrived", latenessMinutes: 7 });
  });

  it("keeps an arrival that has a reason code as an arrival", () => {
    const calls = [
      stop("LDS", "0600"),
      { ...stop("MAN", "", "832"), ata: "0628" },
    ];
    expect(classifyRun(run("late", calls), leedsToManchester)).toEqual({
      id: "late",
      serviceDate: "2026-08-28",
      outcome: "arrived",
      latenessMinutes: 28,
    });
  });

  it("reads no actual time anywhere and a reason code as a cancellation", () => {
    const calls = [
      stop("HUL", "", "832"),
      stop("LDS", "", "832"),
      stop("MAN", "", "832"),
    ];
    expect(
      classifyRun(run("cancelled", calls), leedsToManchester).outcome,
    ).toBe("cancelled");
  });

  it("reads a cancellation with no public arrival as cancelled", () => {
    const calls: Call[] = [
      { crs: "KGX", ptd: "1030", reason: "540" },
      { crs: "YRK", ptd: "1219", reason: "540" },
      { crs: "EDB", pta: "1439", reason: "540" },
    ];
    expect(
      classifyRun(run("202609041030001", calls, "2026-09-04"), {
        boardingCrs: "KGX",
        destinationCrs: "YRK",
      }),
    ).toEqual({
      id: "202609041030001",
      serviceDate: "2026-09-04",
      outcome: "cancelled",
    });
  });

  it("reads a train that stopped short of the destination as did not call", () => {
    const calls = [
      stop("LDS", "0608"),
      stop("HUD", "0711"),
      stop("MAN", "", "777"),
    ];
    expect(classifyRun(run("short", calls), leedsToManchester).outcome).toBe(
      "did_not_call",
    );
  });

  it("reads a call Darwin cancelled like a call with a reason code", () => {
    const calls = [
      stop("LDS", "0608"),
      stop("HUD", "0711"),
      { ...stop("MAN", ""), cancelled: true },
    ];
    expect(classifyRun(run("short", calls), leedsToManchester).outcome).toBe(
      "did_not_call",
    );
  });

  it("reads a train that turned back before the boarding station as did not call", () => {
    const calls = [
      stop("HUL", "0503"),
      stop("SBY", "0539"),
      stop("LDS", "", "574"),
      stop("MAN", "", "574"),
    ];
    expect(
      classifyRun(run("turned-back", calls), leedsToManchester).outcome,
    ).toBe("did_not_call");
  });

  it("reads a train that skipped the boarding station but reached the destination as did not call", () => {
    const calls = [
      stop("HUL", "0503"),
      stop("LDS", "", "895"),
      stop("MAN", "0715"),
    ];
    expect(classifyRun(run("skipped", calls), leedsToManchester).outcome).toBe(
      "did_not_call",
    );
  });

  it("reads a train that ran through the boarding station as did not call", () => {
    const calls = [
      stop("HUL", "0503", "655"),
      { ...stop("LDS", "", "655"), ata: "0627" },
      stop("MAN", "0715", "655"),
    ];
    expect(
      classifyRun(run("ran-through", calls), leedsToManchester).outcome,
    ).toBe("did_not_call");
  });

  it("reads a passing time at boarding with no actual departure as did not call", () => {
    const calls: Call[] = [
      { crs: "BSK", pta: "1733", ptd: "1738", ata: "1805", reason: "655" },
      {
        crs: "GRT",
        pta: "1809",
        ptd: "1809",
        ata: "1829",
        atd: "1835",
        reason: "655",
      },
    ];
    expect(
      classifyRun(run("202610237679424", calls, "2026-10-23"), {
        boardingCrs: "BSK",
        destinationCrs: "GRT",
      }),
    ).toEqual({
      id: "202610237679424",
      serviceDate: "2026-10-23",
      outcome: "did_not_call",
    });
  });

  it("reads a boarding stop with no record at all as unknown, not a missed call", () => {
    // Merseyrail 06:25 Liverpool Central to West Kirby on 2026-08-25: HSP has no times from
    // the start to Birkenhead North and no reason code, then the train arrives early.
    const calls: Call[] = [
      { crs: "WKI", ptd: "0551" },
      { crs: "BKN", pta: "0608", ptd: "0609" },
      { crs: "LVC", pta: "0625", ptd: "0625" },
      { crs: "BKN", pta: "0637", ptd: "0637" },
      { crs: "BID", pta: "0640", ptd: "0640", atd: "0640" },
      { crs: "HYK", pta: "0653", ptd: "0653", ata: "0651", atd: "0651" },
      { crs: "WKI", pta: "0657", ata: "0655" },
    ];
    expect(
      classifyRun(run("202608256762814", calls, "2026-08-25"), {
        boardingCrs: "LVC",
        destinationCrs: "WKI",
      }),
    ).toEqual({
      id: "202608256762814",
      serviceDate: "2026-08-25",
      outcome: "missing_actual",
    });
  });

  it("reads a boarding stop that has an actual departure as an arrival", () => {
    const calls: Call[] = [
      {
        crs: "BSK",
        pta: "1706",
        ptd: "1707",
        ata: "1731",
        atd: "1735",
        reason: "655",
      },
      {
        crs: "GRT",
        pta: "1738",
        ptd: "1738",
        ata: "1803",
        atd: "1810",
        reason: "655",
      },
    ];
    expect(
      classifyRun(run("202610237679417", calls, "2026-10-23"), {
        boardingCrs: "BSK",
        destinationCrs: "GRT",
      }),
    ).toEqual({
      id: "202610237679417",
      serviceDate: "2026-10-23",
      outcome: "arrived",
      latenessMinutes: 25,
    });
  });

  it("reads no actual time anywhere and no reason code as a cancellation", () => {
    const calls = [stop("HUL", ""), stop("LDS", ""), stop("MAN", "")];
    expect(classifyRun(run("silent", calls), leedsToManchester).outcome).toBe(
      "cancelled",
    );
  });

  it("does not treat a missing actual arrival without a reason code as a cancellation", () => {
    const calls = [stop("LDS", "0608"), stop("MAN", "")];
    expect(classifyRun(run("gap", calls), leedsToManchester)).toEqual({
      id: "gap",
      serviceDate: "2026-08-28",
      outcome: "missing_actual",
    });
  });

  it("treats an actual time that is not HHMM as no data", () => {
    for (const ata of ["7:28", "07280"]) {
      const calls: Call[] = [
        { crs: "LDS", pta: "0600", ata: "0600" },
        { crs: "MAN", pta: "0721", ata },
      ];
      expect(
        classifyRun(run("202608280000001", calls), leedsToManchester).outcome,
      ).toBe("missing_actual");
    }
  });

  it("has no outcome for a run that never reaches the destination", () => {
    const calls = [stop("LDS", "0600"), stop("HUD", "0640")];
    expect(
      classifyRun(run("elsewhere", calls), leedsToManchester).outcome,
    ).toBe("missing_actual");
  });
});

describe("passengerLeg", () => {
  it("prefers a destination call with a public arrival", () => {
    const calls: Call[] = [
      { crs: "LDS", ptd: "0600" },
      { crs: "MAN", ptd: "0640" },
      { crs: "MAN", pta: "0700" },
    ];
    expect(passengerLeg(calls, leedsToManchester)).toEqual({
      boarding: 0,
      destination: 2,
    });
  });

  it("boards at the last departure from the boarding station before the destination", () => {
    const calls: Call[] = [
      { crs: "CLJ", ptd: "0540" },
      { crs: "KNG", pta: "0616", ptd: "0618" },
      { crs: "CLJ", pta: "0639", ptd: "0640" },
      { crs: "WAT", pta: "0649" },
    ];
    expect(
      passengerLeg(calls, { boardingCrs: "CLJ", destinationCrs: "WAT" }),
    ).toEqual({ boarding: 2, destination: 3 });
  });

  it("names the boarding call alone when the destination never follows", () => {
    expect(
      passengerLeg([{ crs: "LDS", ptd: "0600" }], leedsToManchester),
    ).toEqual({ boarding: 0 });
    expect(passengerLeg([], leedsToManchester)).toEqual({});
  });
});
