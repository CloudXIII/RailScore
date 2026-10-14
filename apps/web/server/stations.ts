export type Station = {
  readonly crs: string;
  readonly name: string;
};

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

function record(value: unknown): Record<string, unknown> | undefined {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return undefined;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function stationName(crs: string, stations: readonly Station[]): string {
  return stations.find((station) => station.crs === crs)?.name ?? crs;
}

export function resolveStation(
  input: string,
  stations: readonly Station[],
): Station | undefined {
  const trimmed = input.trim();
  if (!trimmed) {
    return undefined;
  }
  const fromLabel = /\(([A-Z]{3})\)$/.exec(trimmed.toUpperCase());
  if (fromLabel) {
    return stations.find((station) => station.crs === fromLabel[1]);
  }
  if (/^[A-Za-z]{3}$/.test(trimmed)) {
    const byCode = stations.find(
      (station) => station.crs === trimmed.toUpperCase(),
    );
    if (byCode) {
      return byCode;
    }
  }
  const folded = fold(stripCode(trimmed));
  const exact = stations.filter((station) => fold(station.name) === folded);
  if (exact.length === 1) {
    return exact[0];
  }
  const found = searchStations(trimmed, stations, stations.length);
  if (found.length === 1 && folded.replace(/ /g, "").length >= 2) {
    return found[0];
  }
  return undefined;
}

/**
 * Stations matching a typed name or CRS code.
 * Matches are ranked: exact code, then name prefix, then word prefix, then substring.
 */
export function searchStations(
  query: string,
  stations: readonly Station[],
  limit = 12,
): Station[] {
  const needle = fold(stripCode(query));
  if (!needle) {
    return [];
  }
  const codePrefix = needle.replace(/ /g, "").slice(0, 3);
  return stations
    .map((station) => ({ station, score: scoreStation(station, needle) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }
      const aCode = a.station.crs.toLowerCase().startsWith(codePrefix) ? 1 : 0;
      const bCode = b.station.crs.toLowerCase().startsWith(codePrefix) ? 1 : 0;
      if (aCode !== bCode) {
        return bCode - aCode;
      }
      return (
        a.station.name.localeCompare(b.station.name, "en") ||
        a.station.crs.localeCompare(b.station.crs)
      );
    })
    .slice(0, limit)
    .map((item) => item.station);
}

function stripCode(value: string): string {
  return value.replace(/\s*\([a-zA-Z]{3}\)\s*$/, "");
}

function fold(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function scoreStation(station: Station, needle: string): number {
  const name = fold(station.name);
  const code = station.crs.toLowerCase();
  const compact = needle.replace(/ /g, "");
  if (name === needle || code === compact) {
    return 1000;
  }
  if (
    !needle.includes(" ") &&
    compact.length >= 2 &&
    compact.length <= 3 &&
    code.startsWith(compact)
  ) {
    return 860;
  }
  if (name.startsWith(needle)) {
    return 800;
  }
  const words = name.split(" ");
  if (words.some((word) => word.startsWith(needle))) {
    return 700;
  }
  if (wordsMatch(words, needle.split(" "))) {
    return 600;
  }
  if (name.includes(needle)) {
    return 500;
  }
  return 0;
}

function wordsMatch(words: string[], parts: string[]): boolean {
  let from = 0;
  for (const part of parts) {
    const found = words.findIndex(
      (word, index) => index >= from && word.startsWith(part),
    );
    if (found < 0) {
      return false;
    }
    from = found + 1;
  }
  return true;
}

export function stationLabel(station: Station): string {
  return `${station.name} (${station.crs})`;
}
