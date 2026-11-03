// Writes server/darwin/tiploc-crs.json from a Darwin reference file (PPTimetable_*_ref_v*.xml.gz),
// so Push Port locations, which name TIPLOCs, can be matched to the CRS codes searches use.
// Usage: node scripts/tiploc-crs.mjs <reference file>
import { readFileSync, writeFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";

const file = process.argv[2];
if (!file) {
  console.error(
    "Usage: node scripts/tiploc-crs.mjs <PPTimetable_*_ref_v*.xml[.gz]>",
  );
  process.exit(1);
}
const raw = readFileSync(file);
const xml = (file.endsWith(".gz") ? gunzipSync(raw) : raw).toString("utf8");

const map = {};
for (const [tag] of xml.matchAll(/<LocationRef\b[^>]*>/g)) {
  const tpl = /\btpl="([^"]+)"/.exec(tag)?.[1];
  const crs = /\bcrs="([A-Z]{3})"/.exec(tag)?.[1];
  if (tpl && crs) {
    map[tpl] = crs;
  }
}
const sorted = Object.fromEntries(
  Object.entries(map).sort(([left], [right]) => left.localeCompare(right)),
);
writeFileSync(
  new URL("../server/darwin/tiploc-crs.json", import.meta.url),
  `${JSON.stringify(sorted, null, 0)}\n`,
);
console.log(`Wrote ${Object.keys(sorted).length} TIPLOCs.`);
