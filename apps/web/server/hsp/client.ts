import "server-only";
import { hspConnection, logHspCalls, MissingEnvironmentError } from "../env";
import { HspResponseError } from "../services/map";
import {
  busyPauseMs,
  isRetryableStatus,
  MAX_ATTEMPTS,
  retryDelayMs,
} from "./policy";
import { hspCircuitOpen, recordHspStatus } from "./circuit";
import { takeDailyCall } from "./daily-limit";
import { waitForHspSlot } from "./rate-limit";

const REQUEST_TIMEOUT_MS = 30_000;

export class HspRequestError extends Error {
  constructor(
    readonly kind: "not_configured" | "source_unavailable" | "busy",
    message?: string,
    /** HTTP status when the failure was a response. Absent on a timeout. */
    readonly status?: number,
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

/**
 * `deadline` is a `Date.now()` timestamp. Waiting for a slot and retries stop there.
 * `timeoutMs` caps one request, and sets the deadline when none is given.
 * `retryOverloaded: false` gives up on the first 429 or 503 instead of pausing for another try.
 */
export async function postHsp(
  path: string,
  body: unknown,
  options: {
    deadline?: number;
    timeoutMs?: number;
    retryOverloaded?: boolean;
  } = {},
): Promise<unknown> {
  const timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;
  const overloadedAttempts = options.retryOverloaded === false ? 1 : 2;
  const deadline = options.deadline ?? Date.now() + timeoutMs;
  const connection = hspAuth();
  const timing = { started: Date.now(), waitMs: 0, fetchMs: 0, errorDetail: "" };
  let status: number | string = "none";
  let attempts = 0;
  try {
    return await sendHsp(
      path,
      body,
      deadline,
      timeoutMs,
      overloadedAttempts,
      connection.baseUrl,
      connection.headers,
      timing,
      (value) => {
        status = value;
        attempts += 1;
      },
    );
  } finally {
    const failed = typeof status !== "number" || status >= 300;
    if (logHspCalls() || (attempts > 0 && failed)) {
      const detail = timing.errorDetail
        ? ` error=${redactSecret(timing.errorDetail, connection.apiKey)}`
        : "";
      console.info(
        `[hsp] ${path} status=${status} attempts=${attempts} waitMs=${timing.waitMs} fetchMs=${timing.fetchMs} totalMs=${Date.now() - timing.started}${detail}`,
      );
    }
  }
}

async function sendHsp(
  path: string,
  body: unknown,
  deadline: number,
  timeoutMs: number,
  overloadedAttempts: number,
  baseUrl: string,
  headers: Headers,
  timing: { waitMs: number; fetchMs: number; errorDetail: string },
  noteAttempt: (status: number | string) => void,
): Promise<unknown> {
  for (let attempt = 0; ; attempt += 1) {
    if (hspCircuitOpen()) {
      noteAttempt("circuit_open");
      throw new HspRequestError("busy");
    }
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
        Math.max(1, Math.min(timeoutMs, deadline - Date.now())),
      ),
    }).catch(() => undefined);
    noteAttempt(response?.status ?? "network_error");
    if (response) recordHspStatus(response.status);

    if (response && response.status < 300) {
      timing.errorDetail = "";
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

    if (response && response.status >= 300) {
      const text = await response.text();
      timing.errorDetail = text.slice(0, 160).replace(/\s+/g, " ");
    } else {
      await response?.body?.cancel();
    }
    timing.fetchMs += Date.now() - fetchStarted;
    const serverError = response?.status === 500;
    if (serverError) {
      console.info(`[hsp] ${path} status=500 attempt=${attempt + 1}`);
    }
    if (response && !serverError && !isRetryableStatus(response.status)) {
      throw new HspRequestError("source_unavailable", undefined, response.status);
    }
    const retryAfter = response?.headers.get("retry-after") ?? null;
    const overloaded = response?.status === 429 || response?.status === 503;
    const delay = overloaded
      ? busyPauseMs(retryAfter)
      : retryDelayMs(attempt, retryAfter);
    const attemptsAllowed = serverError
      ? 2
      : overloaded
        ? overloadedAttempts
        : MAX_ATTEMPTS;
    const outOfTime = Date.now() + delay > deadline;
    if (attempt + 1 >= attemptsAllowed || outOfTime) {
      throw new HspRequestError(
        overloaded || outOfTime ? "busy" : "source_unavailable",
        undefined,
        response?.status,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
}

function hspAuth(): { baseUrl: string; headers: Headers; apiKey: string } {
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
  headers.set(connection.apiKeyHeader, connection.apiKey);
  return { baseUrl: connection.baseUrl, headers, apiKey: connection.apiKey };
}

function redactSecret(text: string, secret: string): string {
  if (!secret) {
    return text;
  }
  return text.split(secret).join("[redacted]");
}
