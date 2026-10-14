import { describe, expect, it } from "vitest";
import { resolveStation, searchStations, type Station } from "./stations";

const STATIONS: readonly Station[] = [
  { crs: "BHM", name: "Birmingham New Street" },
  { crs: "BMO", name: "Birmingham Moor Street" },
  { crs: "EUS", name: "London Euston" },
  { crs: "FST", name: "London Fenchurch Street" },
  { crs: "GLC", name: "Glasgow Central" },
  { crs: "GLQ", name: "Glasgow Queen Street" },
  { crs: "IRL", name: "Irlam" },
  { crs: "KGX", name: "London King's Cross" },
  { crs: "LIV", name: "Liverpool Lime Street" },
  { crs: "LPY", name: "Liverpool South Parkway" },
  { crs: "LST", name: "London Liverpool Street" },
  { crs: "MAN", name: "Manchester Piccadilly" },
  { crs: "MCO", name: "Manchester Oxford Road" },
  { crs: "MCV", name: "Manchester Victoria" },
  { crs: "MIA", name: "Manchester Airport" },
  { crs: "MYB", name: "London Marylebone" },
  { crs: "PAD", name: "London Paddington" },
  { crs: "STP", name: "London St Pancras International" },
  { crs: "VIC", name: "London Victoria" },
  { crs: "WAT", name: "London Waterloo" },
  { crs: "YRK", name: "York" },
];

describe("searchStations", () => {
  it("matches a word inside the station name", () => {
    expect(
      searchStations("euston", STATIONS).map((station) => station.crs),
    ).toEqual(["EUS"]);
    expect(
      searchStations("piccadilly", STATIONS).map((station) => station.crs),
    ).toEqual(["MAN"]);
  });

  it("puts the station whose code matches the typed prefix first", () => {
    expect(
      searchStations("manchester", STATIONS).map((station) => station.crs)[0],
    ).toBe("MAN");
    expect(
      searchStations("liverpool", STATIONS).map((station) => station.crs)[0],
    ).toBe("LIV");
    expect(
      searchStations("glasgow", STATIONS).map((station) => station.crs)[0],
    ).toBe("GLC");
  });

  it("matches a CRS code and a short prefix of that code", () => {
    expect(
      searchStations("kgx", STATIONS).map((station) => station.crs),
    ).toEqual(["KGX"]);
    expect(
      searchStations("bh", STATIONS).map((station) => station.crs),
    ).toContain("BHM");
  });

  it("ignores apostrophes and the code already shown in the field", () => {
    expect(
      searchStations("kings cross", STATIONS).map((station) => station.crs),
    ).toEqual(["KGX"]);
    expect(
      searchStations("London Euston (EUS)", STATIONS).map(
        (station) => station.crs,
      ),
    ).toEqual(["EUS"]);
  });

  it("returns every London terminal for a broad name", () => {
    const codes = searchStations("london", STATIONS, 20).map(
      (station) => station.crs,
    );
    expect(codes).toEqual(
      expect.arrayContaining([
        "EUS",
        "KGX",
        "PAD",
        "WAT",
        "VIC",
        "STP",
        "LST",
        "MYB",
        "FST",
      ]),
    );
  });

  it("returns nothing for a blank or unknown query", () => {
    expect(searchStations("", STATIONS)).toEqual([]);
    expect(searchStations("zzzz", STATIONS)).toEqual([]);
  });
});

describe("resolveStation", () => {
  it("accepts a unique partial name", () => {
    expect(resolveStation("euston", STATIONS)?.crs).toBe("EUS");
    expect(resolveStation("piccadilly", STATIONS)?.crs).toBe("MAN");
    expect(resolveStation("irlam", STATIONS)?.crs).toBe("IRL");
  });

  it("refuses an ambiguous name", () => {
    expect(resolveStation("manchester", STATIONS)).toBeUndefined();
    expect(resolveStation("london", STATIONS)).toBeUndefined();
  });

  it("still accepts a full label or exact code", () => {
    expect(resolveStation("York (YRK)", STATIONS)?.crs).toBe("YRK");
    expect(resolveStation("man", STATIONS)?.crs).toBe("MAN");
  });
});
