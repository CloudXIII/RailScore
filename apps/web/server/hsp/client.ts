import "server-only";
import { hspConnection, logHspCalls, MissingEnvironmentError } from "../env";
import { HspResponseError } from "./map";
import {
  busyPauseMs,
  isRetryableStatus,
  MAX_ATTEMPTS,
  retryDelayMs,
} from "./policy";
import { takeDailyCall } from "./daily-limit";
import { waitForHspSlot } from "./rate-limit";

const REQUEST_TIMEOUT_MS = 30_000;

export class HspRequestError extends Error {
  constructor(
    readonly kind: "not_configured" | "source_unavailable" | "busy",
    message?: string,
  ) {
    super(
      message ??
        (kind === "not_configured"
          ? "Historic Service Performance credentials are not configured."
          : kind === "busy"
            ? "The historical data source is busy right now. Try again in a minute."
            : "Historical data could not be loaded."),
    );
  }
}

/** `deadline` is a `Date.now()` timestamp. Waiting for a slot and retries stop there. */
export async function postHsp(
  path: string,
  body: unknown,
  options: { deadline?: number } = {},
): Promise<unknown> {
  const deadline = options.deadline ?? Date.now() + REQUEST_TIMEOUT_MS;
  const connection = hspAuth();
  const timing = { started: Date.now(), waitMs: 0, fetchMs: 0 };
  let status: number | string = "none";
  let attempts = 0;
  try {
    return await sendHsp(
      path,
      body,
      deadline,
      connection.baseUrl,
      connection.headers,
      timing,
      (value) => {
        status = value;
        attempts += 1;
      },
    );
  } finally {
    if (logHspCalls()) {
      console.info(
        `[hsp] ${path} status=${status} attempts=${attempts} waitMs=${timing.waitMs} fetchMs=${timing.fetchMs} totalMs=${Date.now() - timing.started}`,
      );
    }
  }
}

async function sendHsp(
  path: string,
  body: unknown,
  deadline: number,
  baseUrl: string,
  headers: Headers,
  timing: { waitMs: number; fetchMs: number },
  noteAttempt: (status: number | string) => void,
): Promise<unknown> {
  for (let attempt = 0; ; attempt += 1) {
    const waitStarted = Date.now();
    const slot = await waitForHspSlot(deadline);
    timing.waitMs += Date.now() - waitStarted;
    if (!slot) {
      noteAttempt("no_slot");
      throw new HspRequestError("busy");
    }
    await takeDailyCall();
    const fetchStarted = Date.now();
    const response = await fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      redirect: "manual",
      cache: "no-store",
      signal: AbortSignal.timeout(
        Math.max(1, Math.min(REQUEST_TIMEOUT_MS, deadline - Date.now())),
      ),
    }).catch(() => undefined);
    noteAttempt(response?.status ?? "network_error");

    if (response && response.status < 300) {
      const text = await response.text();
      timing.fetchMs += Date.now() - fetchStarted;
      try {
        return JSON.parse(text) as unknown;
      } catch {
        throw new HspResponseError(
          "The data source returned something unexpected.",
        );
      }
    }

    await response?.body?.cancel();
    timing.fetchMs += Date.now() - fetchStarted;
    if (response && !isRetryableStatus(response.status)) {
      throw new HspRequestError("source_unavailable");
    }
    const retryAfter = response?.headers.get("retry-after") ?? null;
    const overloaded = response?.status === 429 || response?.status === 503;
    const delay = overloaded
      ? busyPauseMs(retryAfter)
      : retryDelayMs(attempt, retryAfter);
    const attemptsAllowed = overloaded ? 2 : MAX_ATTEMPTS;
    const outOfTime = Date.now() + delay > deadline;
    if (attempt + 1 >= attemptsAllowed || outOfTime) {
      throw new HspRequestError(
        overloaded || outOfTime ? "busy" : "source_unavailable",
      );
    }
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
}

function hspAuth(): { baseUrl: string; headers: Headers } {
  let connection: ReturnType<typeof hspConnection>;
  try {
    connection = hspConnection();
  } catch (error) {
    if (error instanceof MissingEnvironmentError) {
      throw new HspRequestError("not_configured", error.message);
    }
    throw error;
  }
  const headers = new Headers({
    "Content-Type": "application/json",
    Accept: "application/json",
  });
  if ("username" in connection) {
    headers.set(
      "Authorization",
      `Basic ${Buffer.from(`${connection.username}:${connection.password}`).toString("base64")}`,
    );
    return { baseUrl: connection.baseUrl, headers };
  }
  headers.set(connection.apiKeyHeader, connection.apiKey);
  return { baseUrl: connection.baseUrl, headers };
}
