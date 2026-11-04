import "server-only";
import { hspConnection } from "../env";

/**
 * HSP refused or failed the call. `busy` is a 503 or 429: HSP takes about two list calls
 * and five detail calls a second, and refuses the rest at once.
 */
export class HspCallError extends Error {
  constructor(
    readonly kind: "busy" | "failed" | "not_configured",
    readonly status?: number,
  ) {
    super(`HSP call ${kind}${status ? ` (${status})` : ""}`);
  }
}

/** Calls made by this process since the last `takeCallCount`, for the daily count. */
let calls = 0;

export function takeCallCount(): number {
  const taken = calls;
  calls = 0;
  return taken;
}

/** One POST to HSP. No retries: callers pace and retry to suit the endpoint. */
export async function postHsp(
  path: "/serviceMetrics" | "/serviceDetails",
  body: unknown,
  timeoutMs: number,
): Promise<unknown> {
  const connection = hspConnection();
  if (!connection) {
    throw new HspCallError("not_configured");
  }
  calls += 1;
  const started = Date.now();
  const response = await fetch(`${connection.baseUrl}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      [connection.apiKeyHeader]: connection.apiKey,
    },
    body: JSON.stringify(body),
    redirect: "manual",
    cache: "no-store",
    signal: AbortSignal.timeout(timeoutMs),
  }).catch(() => undefined);
  if (path === "/serviceMetrics" || !response || response.status >= 300) {
    console.info(
      `[hsp] ${path} status=${response?.status ?? "timeout"} ms=${Date.now() - started}`,
    );
  }
  if (!response) {
    throw new HspCallError("failed");
  }
  if (response.status >= 300) {
    await response.body?.cancel();
    throw new HspCallError(
      response.status === 503 || response.status === 429 ? "busy" : "failed",
      response.status,
    );
  }
  try {
    return (await response.json()) as unknown;
  } catch {
    throw new HspCallError("failed", response.status);
  }
}
