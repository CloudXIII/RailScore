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
  const raw = read("HSP_MAX_REQUESTS_PER_SECOND");
  if (raw === undefined) {
    return 3;
  }
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : 3;
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
