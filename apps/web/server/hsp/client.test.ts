import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CIRCUIT_OPEN_MS, resetHspCircuit } from "./circuit";
import { postHsp } from "./client";
import { DailyLimitError, takeDailyCall } from "./daily-limit";
import { HspResponseError } from "../services/map";
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
    resetHspCircuit();
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

  it("reports auth failure and a login redirect without retrying", async () => {
    useTestKey();
    for (const status of [401, 302]) {
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
    vi.mocked(fetch).mockImplementation(() =>
      Promise.resolve(httpResponse(503, "", { "retry-after": "0" })),
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

  it("tries a 500 once more and logs the status", async () => {
    useTestKey();
    vi.useFakeTimers();
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    vi.mocked(fetch)
      .mockResolvedValueOnce(httpResponse(500, "upstream"))
      .mockResolvedValueOnce(httpResponse(200, JSON.stringify({ rid: "1" })));

    const pending = postHsp("/serviceDetails", { rid: "1" });
    await vi.advanceTimersByTimeAsync(1_000);
    await expect(pending).resolves.toEqual({ rid: "1" });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(info.mock.calls.some((call) => String(call[0]).includes("status=500"))).toBe(
      true,
    );
    info.mockRestore();
    vi.useRealTimers();
  });

  it("does not call HSP while the circuit is open", async () => {
    useTestKey();
    vi.mocked(fetch).mockImplementation(() =>
      Promise.resolve(httpResponse(503, "down")),
    );
    await expect(
      postHsp("/serviceMetrics", {}, { retryOverloaded: false }),
    ).rejects.toMatchObject({ kind: "busy" });
    await expect(
      postHsp("/serviceMetrics", {}, { retryOverloaded: false }),
    ).rejects.toMatchObject({ kind: "busy" });
    await expect(
      postHsp("/serviceMetrics", {}, { retryOverloaded: false }),
    ).rejects.toMatchObject({ kind: "busy" });
    expect(fetch).toHaveBeenCalledTimes(3);
    vi.mocked(fetch).mockClear();
    await expect(postHsp("/serviceMetrics", {})).rejects.toMatchObject({
      kind: "busy",
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("calls HSP again after the circuit has been open for 45 seconds", async () => {
    useTestKey();
    vi.useFakeTimers();
    try {
      vi.mocked(fetch).mockImplementation(() =>
        Promise.resolve(httpResponse(503, "down")),
      );
      for (let attempt = 0; attempt < 3; attempt += 1) {
        await expect(
          postHsp("/serviceMetrics", {}, { retryOverloaded: false }),
        ).rejects.toMatchObject({ kind: "busy" });
      }
      await vi.advanceTimersByTimeAsync(CIRCUIT_OPEN_MS);
      vi.mocked(fetch).mockReset();
      vi.mocked(fetch).mockResolvedValue(
        httpResponse(200, JSON.stringify({ ok: true })),
      );
      await expect(postHsp("/serviceMetrics", {})).resolves.toEqual({ ok: true });
      expect(fetch).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
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
