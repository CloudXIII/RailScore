import { describe, expect, it } from "vitest";
import { parseStationFeed } from "@/server/station-feed";
import { STATIONS } from "@/server/station-directory";

describe("parseStationFeed", () => {
  it("keeps name and CRS and drops facilities", () => {
    const stations = parseStationFeed({
      stations: [
        { name: "Irlam", crsCode: "irl", carParks: { numberOfSpaces: 10 } },
        { name: "Abbey Wood", crsCode: "ABW" },
        { name: "No code" },
        { name: "Irlam duplicate", crsCode: "IRL" },
      ],
    });

    expect(stations).toEqual([
      { crs: "ABW", name: "Abbey Wood" },
      { crs: "IRL", name: "Irlam" },
    ]);
  });

  it("returns nothing for a payload without a station list", () => {
    expect(parseStationFeed({ header: {} })).toEqual([]);
  });
});

describe("STATIONS", () => {
  it("holds each CRS once, in the order the feed parser sorts them", () => {
    const codes = STATIONS.map((station) => station.crs);
    expect(STATIONS.length).toBeGreaterThan(2_500);
    expect(new Set(codes).size).toBe(codes.length);
    expect(codes.every((crs) => /^[A-Z]{3}$/.test(crs))).toBe(true);
    expect(STATIONS.every((station) => station.name.length > 0)).toBe(true);
    expect(
      parseStationFeed({
        stations: STATIONS.map((station) => ({
          crsCode: station.crs,
          name: station.name,
        })),
      }),
    ).toEqual(STATIONS);
  });

  it("names the stations searches use", () => {
    expect(STATIONS).toContainEqual({
      crs: "LIV",
      name: "Liverpool Lime Street",
    });
    expect(STATIONS).toContainEqual({ crs: "EUS", name: "London Euston" });
  });
});
