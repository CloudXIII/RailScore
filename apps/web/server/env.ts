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

/** Port for `npm run dev`. Defaults to 3000. */
export function devPort(): string {
  return read("PORT") ?? "3000";
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
 * An unset or unusable value stays at 150. Without a database there is no cap.
 */
export function hspDailyCallLimit(): number {
  const raw = read("HSP_DAILY_CALL_LIMIT");
  if (raw === undefined) {
    return 150;
  }
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : 150;
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

export type HspConnection =
  | { baseUrl: string; username: string; password: string }
  | { baseUrl: string; apiKey: string; apiKeyHeader: string };

/**
 * Live HSP endpoint. Basic auth is used when both username and password are set.
 * Otherwise the API key and its header are required.
 */
export function hspConnection(): HspConnection {
  const baseUrl = read("HSP_BASE_URL")?.replace(/\/$/, "");
  const username = read("HSP_USERNAME");
  const password = read("HSP_PASSWORD");
  const apiKey = read("HSP_API_KEY");
  const apiKeyHeader = read("HSP_API_KEY_HEADER");
  const absent: string[] = [];
  if (!baseUrl) {
    absent.push("HSP_BASE_URL");
  }
  const basic = Boolean(username && password);
  const key = Boolean(apiKey && apiKeyHeader);
  if (!basic && !key) {
    if (!apiKey) {
      absent.push("HSP_API_KEY");
    }
    if (!apiKeyHeader) {
      absent.push("HSP_API_KEY_HEADER");
    }
    if (username || password) {
      if (!username) {
        absent.push("HSP_USERNAME");
      }
      if (!password) {
        absent.push("HSP_PASSWORD");
      }
    }
  }
  if (absent.length > 0 || !baseUrl) {
    throw new MissingEnvironmentError(absent.join(", "));
  }
  if (username && password) {
    return { baseUrl, username, password };
  }
  if (apiKey && apiKeyHeader) {
    return { baseUrl, apiKey, apiKeyHeader };
  }
  throw new MissingEnvironmentError("HSP_API_KEY, HSP_API_KEY_HEADER");
}
