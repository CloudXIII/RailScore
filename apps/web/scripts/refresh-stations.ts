/**
 * Rewrites `server/stations.json`, the station names and CRS codes the app ships with, from the
 * Knowledgebase stations feed. The feed is about 55 MB for some 2,600 stations, so the app does
 * not download it: run this when stations open, close or are renamed, and commit the file.
 *
 *   npm run stations:refresh -w @railscore/web
 *
 * It reads `STATIONS_BASE_URL` and `STATIONS_API_KEY` (from `.env.local` unless the shell sets
 * them) and prints the stations added and removed.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { stationsFeed } from "../server/env";
import { parseStationFeed } from "../server/station-feed";
import type { Station } from "../shared/stations";

const file = new URL("../server/stations.json", import.meta.url);

if (existsSync(".env.local")) {
  process.loadEnvFile(".env.local");
}
const feed = stationsFeed();
const response = await fetch(`${feed.baseUrl}/stations`, {
  headers: { Accept: "application/json", "x-apikey": feed.apiKey },
  signal: AbortSignal.timeout(120_000),
});
if (!response.ok) {
  throw new Error(`The stations feed answered ${response.status}.`);
}
const stations = parseStationFeed(await response.json());
if (stations.length === 0) {
  throw new Error("The stations feed listed no station.");
}

const before = JSON.parse(readFileSync(file, "utf8")) as Station[];
const label = (station: Station) => `${station.crs} ${station.name}`;
const old = new Set(before.map(label));
const now = new Set(stations.map(label));
for (const station of stations.filter((station) => !old.has(label(station)))) {
  console.log(`+ ${label(station)}`);
}
for (const station of before.filter((station) => !now.has(label(station)))) {
  console.log(`- ${label(station)}`);
}

// One station per line, as Prettier lays it out, so a refresh diffs station by station.
const rows = stations.map(
  (station) =>
    `  { "crs": ${JSON.stringify(station.crs)}, "name": ${JSON.stringify(station.name)} }`,
);
writeFileSync(file, `[\n${rows.join(",\n")}\n]\n`);
console.log(`Wrote ${stations.length} stations.`);
