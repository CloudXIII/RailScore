/**
 * Every environment variable the app reads.
 * A lookup (`process.env[name]`) rather than `process.env.NAME`, so Next does not
 * bake the value into the build. Empty and blank values count as unset.
 */

export class MissingEnvironmentError extends Error {
  constructor(variables: string) {
    super(`Missing required environment variable: ${variables}`);
    this.name = "MissingEnvironmentError";
  }
}

function read(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

export function requireEnv(name: string): string {
  const value = read(name);
  if (value === undefined) {
    throw new MissingEnvironmentError(name);
  }
  return value;
}

/** Undefined when `DATABASE_URL` is not set, so the app still runs without a database. */
export function databaseUrl(): string | undefined {
  return read("DATABASE_URL");
}

/** `RAILSCORE_DATA=mock` serves made-up trains so the screens can be tried before HSP is connected. */
export function usesMockData(): boolean {
  return read("RAILSCORE_DATA") === "mock";
}

/** `RAILSCORE_LOG_HSP=1` logs each HSP call. Off unless set, so a host log stays quiet. */
export function logHspCalls(): boolean {
  return read("RAILSCORE_LOG_HSP") === "1";
}

/** HSP requests per second. An unset or unusable value stays at 3. */
export function hspMaxRequestsPerSecond(): number {
  return positiveNumber("HSP_MAX_REQUESTS_PER_SECOND", 3);
}

/**
 * List calls one search keeps in flight. An unset or unusable value stays at 2.
 * The list slots still cap the total across every search.
 */
export function hspListWorkers(): number {
  return positiveInteger("HSP_LIST_WORKERS", 2);
}

/**
 * List calls in flight at once, across every server instance.
 * An unset or unusable value stays at 2. The database needs a row per slot.
 */
export function hspListSlotCount(): number {
  return positiveInteger("HSP_LIST_SLOT_COUNT", 2);
}

/**
 * Minimum gap between list-call starts, in milliseconds.
 * An unset or unusable value stays at 1500. Zero lets them start together.
 */
export function hspListStartGapMs(): number {
  return nonNegativeInteger("HSP_LIST_START_GAP_MS", 1_500);
}

/**
 * Detail calls one calculation keeps in flight.
 * An unset or unusable value stays at 1.
 */
export function hspDetailConcurrency(): number {
  return positiveInteger("HSP_DETAIL_CONCURRENCY", 1);
}

/**
 * After HSP refuses a list call that ran beside another, this process keeps to one
 * list call for this many milliseconds. Zero keeps the worker count. An unset or
 * unusable value stays at 3 minutes.
 */
export function hspSerialAfterRefusalMs(): number {
  return nonNegativeInteger("HSP_SERIAL_AFTER_REFUSAL_MS", 3 * 60 * 1000);
}

/** Connections in the Postgres pool. An unset or unusable value stays at 3. */
export function databasePoolMax(): number {
  return positiveInteger("DATABASE_POOL_MAX", 3);
}

function positiveNumber(name: string, fallback: number): number {
  const value = numericEnv(name);
  return value !== undefined && value > 0 ? value : fallback;
}

function positiveInteger(name: string, fallback: number): number {
  const value = numericEnv(name);
  return value !== undefined && Number.isInteger(value) && value > 0
    ? value
    : fallback;
}

function nonNegativeInteger(name: string, fallback: number): number {
  const value = numericEnv(name);
  return value !== undefined && Number.isInteger(value) && value >= 0
    ? value
    : fallback;
}

function numericEnv(name: string): number | undefined {
  const raw = read(name);
  if (raw === undefined) {
    return undefined;
  }
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

/**
 * HSP calls per London day when a database is configured.
 * An unset or unusable value stays at 5000. Without a database there is no cap.
 */
export function hspDailyCallLimit(): number {
  const raw = read("HSP_DAILY_CALL_LIMIT");
  if (raw === undefined) {
    return 5000;
  }
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : 5000;
}

export function stationsFeed(): { baseUrl: string; apiKey: string } {
  const baseUrl = read("STATIONS_BASE_URL");
  const apiKey = read("STATIONS_API_KEY");
  const absent = [
    baseUrl ? undefined : "STATIONS_BASE_URL",
    apiKey ? undefined : "STATIONS_API_KEY",
  ].filter((name): name is string => name !== undefined);
  if (!baseUrl || !apiKey) {
    throw new MissingEnvironmentError(absent.join(", "));
  }
  return { baseUrl: baseUrl.replace(/\/$/, ""), apiKey };
}

export type DarwinKafka = {
  brokers: string[];
  mechanism: "plain";
  username: string;
  password: string;
  groupId: string;
  topic: string;
};

/** Darwin Push Port on the Rail Data Marketplace, from the product's Pub/Sub tab. The XML topic. */
export function darwinKafka(): DarwinKafka {
  const values = {
    DARWIN_KAFKA_BOOTSTRAP: read("DARWIN_KAFKA_BOOTSTRAP"),
    DARWIN_KAFKA_USERNAME: read("DARWIN_KAFKA_USERNAME"),
    DARWIN_KAFKA_PASSWORD: read("DARWIN_KAFKA_PASSWORD"),
    DARWIN_KAFKA_GROUP: read("DARWIN_KAFKA_GROUP"),
    DARWIN_KAFKA_TOPIC: read("DARWIN_KAFKA_TOPIC"),
  };
  const absent = Object.entries(values)
    .filter(([, value]) => value === undefined)
    .map(([name]) => name);
  const mechanism = read("DARWIN_KAFKA_SASL_MECHANISM") ?? "PLAIN";
  if (mechanism.toUpperCase() !== "PLAIN") {
    throw new Error(`Unsupported DARWIN_KAFKA_SASL_MECHANISM: ${mechanism}`);
  }
  if (absent.length > 0) {
    throw new MissingEnvironmentError(absent.join(", "));
  }
  return {
    brokers: values
      .DARWIN_KAFKA_BOOTSTRAP!.split(",")
      .map((broker) => broker.trim()),
    mechanism: "plain",
    username: values.DARWIN_KAFKA_USERNAME!,
    password: values.DARWIN_KAFKA_PASSWORD!,
    groupId: values.DARWIN_KAFKA_GROUP!,
    topic: values.DARWIN_KAFKA_TOPIC!,
  };
}

/** Hourly Darwin snapshot files, for hours Kafka dropped before an import read them. */
export function darwinSnapshot(): { url: string; apiKey: string } {
  const url = read("DARWIN_SNAPSHOT_URL");
  const apiKey = read("DARWIN_SNAPSHOT_CONSUMER_KEY");
  const absent = [
    url ? undefined : "DARWIN_SNAPSHOT_URL",
    apiKey ? undefined : "DARWIN_SNAPSHOT_CONSUMER_KEY",
  ].filter((name): name is string => name !== undefined);
  if (!url || !apiKey) {
    throw new MissingEnvironmentError(absent.join(", "));
  }
  return { url, apiKey };
}

/** Days of Darwin runs kept. An unset or unusable value stays at 30, the default search period. A day of the whole network is about 10 MB. */
export function darwinKeepDays(): number {
  return positiveInteger("DARWIN_KEEP_DAYS", 30);
}

/** Secret a scheduler sends as `Authorization: Bearer …` to start an import. Undefined turns the route off. */
export function importSecret(): string | undefined {
  return read("CRON_SECRET");
}

export type HspConnection = {
  baseUrl: string;
  apiKey: string;
  apiKeyHeader: string;
};

/** Live HSP endpoint. The API key is sent in the header named by `HSP_API_KEY_HEADER`. */
export function hspConnection(): HspConnection {
  const baseUrl = read("HSP_BASE_URL")?.replace(/\/$/, "");
  const apiKey = read("HSP_API_KEY");
  const apiKeyHeader = read("HSP_API_KEY_HEADER");
  const absent = [
    baseUrl ? undefined : "HSP_BASE_URL",
    apiKey ? undefined : "HSP_API_KEY",
    apiKeyHeader ? undefined : "HSP_API_KEY_HEADER",
  ].filter((name): name is string => name !== undefined);
  if (!baseUrl || !apiKey || !apiKeyHeader) {
    throw new MissingEnvironmentError(absent.join(", "));
  }
  return { baseUrl, apiKey, apiKeyHeader };
}
