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

/** `RAILSCORE_DATA=mock` serves made-up trains so the screens can be tried without a database. */
export function usesMockData(): boolean {
  return read("RAILSCORE_DATA") === "mock";
}

/** Connections in the Postgres pool. An unset or unusable value stays at 3. */
export function databasePoolMax(): number {
  return positiveInteger("DATABASE_POOL_MAX", 3);
}

function positiveInteger(name: string, fallback: number): number {
  const value = numericEnv(name);
  return value !== undefined && Number.isInteger(value) && value > 0
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
  username: string;
  password: string;
  groupId: string;
  topic: string;
};

/**
 * Darwin Push Port on the Rail Data Marketplace, from the product's Pub/Sub tab. The XML topic.
 * The tab gives SASL PLAIN over SSL, so the import sets both itself.
 */
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
  if (absent.length > 0) {
    throw new MissingEnvironmentError(absent.join(", "));
  }
  return {
    brokers: values
      .DARWIN_KAFKA_BOOTSTRAP!.split(",")
      .map((broker) => broker.trim()),
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

/** A rolling year, leap years included. */
const YEAR_DAYS = 365;

/**
 * Days of Darwin runs kept. An unset or unusable value stays at a year, longer than any search
 * period, so longer periods can be offered later with their days already stored.
 * Packed into month rows, a day of the whole network is under 1 MB; the last 15 open days are
 * about 12 MB each. Darwin's history cannot be fetched again, so a day deleted is lost.
 */
export function darwinKeepDays(): number {
  return positiveInteger("DARWIN_KEEP_DAYS", YEAR_DAYS);
}

/** Secret a scheduler sends as `Authorization: Bearer …` to start an import. Undefined turns the route off. */
export function importSecret(): string | undefined {
  return read("CRON_SECRET");
}

/**
 * First day the Darwin import saw from start to end. Earlier stored days are partial: the import
 * began on the evening of 2026-11-03, so most of that day's runs have no actual times.
 * `DARWIN_FIRST_DAY` (YYYY-MM-DD) moves it for a database whose import began later.
 */
export function darwinFirstDay(): string {
  const value = read("DARWIN_FIRST_DAY");
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : "2026-11-04";
}

export type HspConnection = {
  baseUrl: string;
  apiKey: string;
  apiKeyHeader: string;
};

/**
 * Historic Service Performance, for the days before Darwin. Undefined when not configured,
 * and the app then counts Darwin days only. The key goes in the header `HSP_API_KEY_HEADER` names.
 */
export function hspConnection(): HspConnection | undefined {
  const baseUrl = read("HSP_BASE_URL")?.replace(/\/$/, "");
  const apiKey = read("HSP_API_KEY");
  const apiKeyHeader = read("HSP_API_KEY_HEADER");
  return baseUrl && apiKey && apiKeyHeader
    ? { baseUrl, apiKey, apiKeyHeader }
    : undefined;
}

/** HSP calls a day across every visitor. An unset or unusable value stays at 5,000. */
export function hspDailyCallLimit(): number {
  return positiveInteger("HSP_DAILY_CALL_LIMIT", 5000);
}
