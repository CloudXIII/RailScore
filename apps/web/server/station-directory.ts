import "server-only";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { MissingEnvironmentError, stationsFeed } from "./env";
import { parseStationFeed } from "@/server/station-feed";
import { type Station } from "@/shared/stations";

const MAX_AGE_MS = 24 * 60 * 60 * 1000;
const cachePath = path.join(process.cwd(), ".data", "stations.json");

type CacheFile = { fetchedAt: number; stations: Station[] };

let memory: CacheFile | undefined;

export class StationDirectoryError extends Error {
  constructor(message = "The station list could not be loaded.") {
    super(message);
  }
}

/** Name and CRS for every station, refreshed at most once a day. The full feed is not kept. */
export async function loadStationDirectory(
  now = Date.now(),
): Promise<readonly Station[]> {
  if (memory && now - memory.fetchedAt < MAX_AGE_MS) {
    return memory.stations;
  }
  const cached = await readCache();
  if (cached && now - cached.fetchedAt < MAX_AGE_MS) {
    memory = cached;
    return cached.stations;
  }
  try {
    const stations = await fetchStations();
    memory = { fetchedAt: now, stations };
    await writeCache(memory);
    return stations;
  } catch (error) {
    if (cached) {
      memory = cached;
      return cached.stations;
    }
    if (memory) {
      return memory.stations;
    }
    throw error instanceof StationDirectoryError
      ? error
      : new StationDirectoryError();
  }
}

async function fetchStations(): Promise<Station[]> {
  const feed = stationFeedOrError();
  const response = await fetch(`${feed.baseUrl}/stations`, {
    headers: { Accept: "application/json", "x-apikey": feed.apiKey },
    cache: "no-store",
    signal: AbortSignal.timeout(60_000),
  }).catch(() => undefined);
  if (!response || response.status >= 300) {
    await response?.body?.cancel();
    throw new StationDirectoryError();
  }
  let payload: unknown;
  try {
    payload = JSON.parse(await response.text()) as unknown;
  } catch {
    throw new StationDirectoryError();
  }
  const stations = parseStationFeed(payload);
  if (stations.length === 0) {
    throw new StationDirectoryError();
  }
  return stations;
}

function stationFeedOrError(): { baseUrl: string; apiKey: string } {
  try {
    return stationsFeed();
  } catch (error) {
    if (error instanceof MissingEnvironmentError) {
      throw new StationDirectoryError(error.message);
    }
    throw error;
  }
}

async function readCache(): Promise<CacheFile | undefined> {
  try {
    const parsed = JSON.parse(
      await readFile(cachePath, "utf8"),
    ) as Partial<CacheFile>;
    if (
      typeof parsed.fetchedAt !== "number" ||
      !Array.isArray(parsed.stations)
    ) {
      return undefined;
    }
    return { fetchedAt: parsed.fetchedAt, stations: parsed.stations };
  } catch {
    // An unreadable file only means this process fetches the list.
    return undefined;
  }
}

async function writeCache(cache: CacheFile): Promise<void> {
  try {
    await mkdir(path.dirname(cachePath), { recursive: true });
    await writeFile(cachePath, JSON.stringify(cache));
  } catch {
    // A failed write only means the next process fetches again.
  }
}
