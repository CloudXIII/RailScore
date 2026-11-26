// Writes server/trust/stanox-crs.json from Network Rail's location reference file (CORPUS,
// NLC*.xml.gz on the Rail Data Marketplace), so TRUST movements, which name STANOX codes, can be
// matched to the CRS codes Darwin runs keep.
// Usage: node scripts/stanox-crs.mjs <NLC*.xml[.gz]>
//
// A STANOX's CRS is the one Darwin gives its TIPLOC (server/darwin/tiploc-crs.json), or else the
// file's own CRS. Where a STANOX gives two codes, the one in the app's station list
// (server/stations.json) wins; a STANOX still left with two is left out, and a movement there
// is matched by its public time alone.
import { readFileSync, writeFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";

const file = process.argv[2];
if (!file) {
  console.error("Usage: node scripts/stanox-crs.mjs <NLC*.xml[.gz]>");
  process.exit(1);
}
const raw = readFileSync(file);
const xml = (file.endsWith(".gz") ? gunzipSync(raw) : raw).toString("utf8");
const tiplocCrs = JSON.parse(
  readFileSync(
    new URL("../server/darwin/tiploc-crs.json", import.meta.url),
    "utf8",
  ),
);

const field = (item, name) =>
  new RegExp(`<(?:\\w+:)?${name}>([^<]*)<`).exec(item)?.[1]?.trim() ?? "";

/** STANOX → the CRS codes its locations give. */
const codes = new Map();
for (const [item] of xml.matchAll(
  /<(?:\w+:)?TSDBDataItem>[\s\S]*?<\/(?:\w+:)?TSDBDataItem>/g,
)) {
  const stanox = field(item, "NLCStanoxCode");
  if (!/^\d{5}$/.test(stanox)) {
    continue;
  }
  const ownCrs = field(item, "NLCCrsCode");
  const crs =
    tiplocCrs[field(item, "NLCTiplocCode")] ??
    (/^[A-Z]{3}$/.test(ownCrs) ? ownCrs : undefined);
  if (crs) {
    codes.set(stanox, new Set([...(codes.get(stanox) ?? []), crs]));
  }
}
const map = {};
const stations = new Set(
  JSON.parse(
    readFileSync(new URL("../server/stations.json", import.meta.url), "utf8"),
  ).map((station) => station.crs),
);
const ambiguous = [];
for (const [stanox, all] of [...codes].sort(([a], [b]) => a.localeCompare(b))) {
  // Big stations share their STANOX with a non-rail code (VIC and XVR): keep the station.
  const listed = [...all].filter((crs) => stations.has(crs));
  const crs = all.size === 1 ? [...all] : listed;
  if (crs.length === 1) {
    map[stanox] = crs[0];
  } else {
    ambiguous.push(`${stanox} ${[...all].join("/")}`);
  }
}
writeFileSync(
  new URL("../server/trust/stanox-crs.json", import.meta.url),
  `${JSON.stringify(map, null, 0)}\n`,
);
console.log(
  `Wrote ${Object.keys(map).length} STANOX codes; left out with two CRS codes: ${ambiguous.join(", ") || "none"}.`,
);
