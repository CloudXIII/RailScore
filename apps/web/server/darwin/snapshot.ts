import "server-only";
import { gunzipSync } from "node:zlib";
import { darwinSnapshot } from "../env";
import { parsePushPort, type DarwinUpdate } from "./push-port";

/** The API allows ten requests a second with no burst, so a refused request waits and tries again. */
const REFUSED_RETRIES = 4;
const REFUSED_WAIT_MS = 1_500;

/** Thrown when the hour's file does not exist yet, or has expired (they are kept 2 to 3 days). */
export class SnapshotMissingError extends Error {}

/**
 * The schedules and train statuses Darwin held at the start of a UTC hour.
 * A run stays in a snapshot until about 30 minutes after it reaches its destination.
 */
export async function snapshotUpdates(
  hourStart: Date,
): Promise<DarwinUpdate[]> {
  const { url, apiKey } = darwinSnapshot();
  const iso = hourStart.toISOString();
  const body = JSON.stringify({
    date: iso.slice(0, 10),
    hour: iso.slice(11, 13),
  });
  let signed: string | undefined;
  for (let attempt = 0; attempt <= REFUSED_RETRIES && !signed; attempt++) {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "x-apikey": apiKey,
        "Content-Type": "application/json",
        "User-Agent": "RailScore",
      },
      body,
      signal: AbortSignal.timeout(30_000),
    });
    if (response.status === 429) {
      await new Promise((resolve) => setTimeout(resolve, REFUSED_WAIT_MS));
      continue;
    }
    if (!response.ok) {
      throw new Error(
        `Snapshot request for ${iso} failed with ${response.status}.`,
      );
    }
    signed = signedUrl(await response.json());
    if (!signed) {
      throw new Error(`Snapshot request for ${iso} returned no download URL.`);
    }
  }
  if (!signed) {
    throw new Error(
      `Snapshot request for ${iso} was refused ${REFUSED_RETRIES + 1} times.`,
    );
  }
  const file = await fetch(signed, { signal: AbortSignal.timeout(120_000) });
  if (file.status === 404) {
    throw new SnapshotMissingError(`No snapshot file for ${iso}.`);
  }
  if (!file.ok) {
    throw new Error(`Snapshot download for ${iso} failed with ${file.status}.`);
  }
  const xml = gunzipSync(Buffer.from(await file.arrayBuffer())).toString(
    "utf8",
  );
  return parsePushPort(xml);
}

/** The response is a JSON array holding one signed URL. */
function signedUrl(payload: unknown): string | undefined {
  const first = Array.isArray(payload) ? payload[0] : payload;
  return typeof first === "string" && first.startsWith("https://")
    ? first
    : undefined;
}

/** Whole UTC hours after `from` up to the first hour at or after `to`. */
export function snapshotHours(from: Date, to: Date): Date[] {
  const hour = 3_600_000;
  const hours: Date[] = [];
  for (
    let start = Math.floor(from.getTime() / hour) * hour + hour;
    start < to.getTime() + hour;
    start += hour
  ) {
    hours.push(new Date(start));
  }
  return hours;
}
