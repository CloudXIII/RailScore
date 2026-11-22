import "server-only";
import type { Station } from "@/shared/stations";
import stations from "./stations.json";

/**
 * Name and CRS for every station, shipped with the app in `stations.json`. The Knowledgebase
 * feed it comes from is about 55 MB, too much to download on a page view:
 * `npm run stations:refresh` rewrites the file from it.
 */
export const STATIONS: readonly Station[] = stations;
