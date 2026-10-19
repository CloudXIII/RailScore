import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { postHsp } from "./client";
import { DailyLimitError, takeDailyCall } from "./daily-limit";
import { HspResponseError } from "./map";
import { BUSY_PAUSE_MS } from "./policy";

vi.mock("./rate-limit", () => ({
  waitForHspSlot: vi.fn(async () => true),
}));

vi.mock("./daily-limit", async () => {
  const actual =
    await vi.importActual<typeof import("./daily-limit")>("./daily-limit");
  return { ...actual, takeDailyCall: vi.fn(async () => {}) };
});

const ENV_NAMES = [
  "HSP_API_KEY",
  "HSP_API_KEY_HEADER",
  "HSP_BASE_URL",
] as const;

describe("postHsp", () => {
  const saved = new Map<string, string | undefined>();

  beforeEach(() => {
    for (const name of ENV_NAMES) {
      saved.set(name, process.env[name]);
      delete process.env[name];
    }
    process.env.HSP_BASE_URL = "https://hsp.test";
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    for (const name of ENV_NAMES) {
      const value = saved.get(name);
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    }
    vi.unstubAllGlobals();
  });

  it("does not call the network when credentials are missing", async () => {
    await expect(
      postHsp("/serviceMetrics", { from_loc: "EUS" }),
    ).rejects.toMatchObject({
      kind: "not_configured",
      message:
        "Missing required environment variable: HSP_API_KEY, HSP_API_KEY_HEADER",
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("reports auth failure, a login redirect and HTTP 500 without retrying", async () => {
    useTestKey();
    for (const status of [401, 302, 500]) {
      vi.mocked(fetch).mockClear();
      vi.mocked(fetch).mockResolvedValue(httpResponse(status, ""));
      await expect(postHsp("/serviceMetrics", {})).rejects.toMatchObject({
        kind: "source_unavailable",
      });
      expect(fetch, String(status)).toHaveBeenCalledTimes(1);
      expect(vi.mocked(fetch).mock.calls[0]?.[1]).toMatchObject({
        redirect: "manual",
      });
    }
  });

  it("retries a 503 once, after a pause, and then returns the JSON body", async () => {
    useTestKey();
    vi.useFakeTimers();
    vi.mocked(fetch)
      .mockResolvedValueOnce(httpResponse(503, "", { "retry-after": "0" }))
      .mockResolvedValueOnce(
        httpResponse(200, JSON.stringify({ Services: [] })),
      );

    const pending = postHsp("/serviceMetrics", { from_loc: "EUS" });
    await vi.advanceTimersByTimeAsync(BUSY_PAUSE_MS);

    await expect(pending).resolves.toEqual({ Services: [] });
    expect(fetch).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it("stops after the paused retry is busy too", async () => {
    useTestKey();
    vi.useFakeTimers();
    vi.mocked(fetch).mockResolvedValue(
      httpResponse(503, "", { "retry-after": "0" }),
    );

    const pending = postHsp("/serviceDetails", { rid: "1" });
    const rejected = expect(pending).rejects.toMatchObject({ kind: "busy" });
    await vi.advanceTimersByTimeAsync(BUSY_PAUSE_MS);

    await rejected;
    expect(fetch).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it("does not call HSP when the daily limit is reached", async () => {
    useTestKey();
    vi.mocked(takeDailyCall).mockRejectedValueOnce(new DailyLimitError());

    await expect(postHsp("/serviceMetrics", {})).rejects.toThrow(
      "The daily limit for this demo has been reached. Try again tomorrow.",
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects a 200 that is not JSON", async () => {
    useTestKey();
    vi.mocked(fetch).mockResolvedValue(httpResponse(200, "<html>"));

    await expect(postHsp("/serviceMetrics", {})).rejects.toBeInstanceOf(
      HspResponseError,
    );
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

function useTestKey(): void {
  process.env.HSP_API_KEY = "test-key";
  process.env.HSP_API_KEY_HEADER = "x-apikey";
}

function httpResponse(
  status: number,
  body: string,
  headers: Record<string, string> = {},
): Response {
  return new Response(body, { status, headers });
}
