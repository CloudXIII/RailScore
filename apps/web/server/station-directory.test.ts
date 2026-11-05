import { afterEach, describe, expect, it, vi } from "vitest";
import { parseStationFeed } from "@/server/station-feed";

const fsMock = vi.hoisted(() => ({
  mkdir: vi.fn(async () => undefined),
  readFile: vi.fn(async () => {
    throw new Error("missing");
  }),
  writeFile: vi.fn(async () => undefined),
}));

vi.mock("node:fs/promises", () => fsMock);

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

describe("loadStationDirectory", () => {
  const previous = {
    STATIONS_BASE_URL: process.env.STATIONS_BASE_URL,
    STATIONS_API_KEY: process.env.STATIONS_API_KEY,
  };

  afterEach(() => {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    }
    fsMock.mkdir.mockReset();
    fsMock.mkdir.mockResolvedValue(undefined);
    fsMock.readFile.mockReset();
    fsMock.readFile.mockRejectedValue(new Error("missing"));
    fsMock.writeFile.mockReset();
    fsMock.writeFile.mockResolvedValue(undefined);
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  function stubFeed(): void {
    process.env.STATIONS_BASE_URL = "https://stations.test";
    process.env.STATIONS_API_KEY = "stations-key";
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              stations: [{ name: "Euston", crsCode: "EUS" }],
            }),
            { status: 200 },
          ),
      ),
    );
  }

  it("keeps the list in memory when the disk write fails", async () => {
    stubFeed();
    fsMock.writeFile.mockRejectedValue(new Error("read-only file system"));
    const { loadStationDirectory } = await import("./station-directory");

    const first = await loadStationDirectory(1_000);
    const second = await loadStationDirectory(2_000);

    expect(first).toEqual([{ crs: "EUS", name: "Euston" }]);
    expect(second).toEqual(first);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fsMock.writeFile).toHaveBeenCalledTimes(1);
  });

  it("writes the list when the disk accepts it", async () => {
    stubFeed();
    const { loadStationDirectory } = await import("./station-directory");

    await loadStationDirectory(1_000);

    expect(fsMock.writeFile).toHaveBeenCalledTimes(1);
  });
});
