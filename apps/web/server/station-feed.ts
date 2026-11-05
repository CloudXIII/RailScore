import { record, text } from "./payload";
import type { Station } from "@/shared/stations";

/** Keeps name and CRS from a Knowledgebase stations payload. Anything else is dropped. */
export function parseStationFeed(payload: unknown): Station[] {
  const root = record(payload);
  const rows = root && Array.isArray(root.stations) ? root.stations : [];
  const stations: Station[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const station = record(row);
    const crs = text(station?.crsCode).toUpperCase();
    const name = text(station?.name);
    if (!/^[A-Z]{3}$/.test(crs) || !name || seen.has(crs)) {
      continue;
    }
    seen.add(crs);
    stations.push({ crs, name });
  }
  stations.sort(
    (left, right) =>
      left.name.localeCompare(right.name, "en") ||
      left.crs.localeCompare(right.crs),
  );
  return stations;
}
