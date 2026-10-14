import { describe, expect, it } from "vitest";
import {
  busyPauseMs,
  isRetryableStatus,
  isStoredRunReusable,
  isUnreadablePlaceholderReusable,
  retryDelayMs,
  takeToken,
  type TokenBucket,
} from "./policy";

describe("isRetryableStatus", () => {
  it("retries rate limits and gateway failures only", () => {
    expect([429, 502, 503, 504].every(isRetryableStatus)).toBe(true);
    expect([400, 401, 403, 404, 500].some(isRetryableStatus)).toBe(false);
  });
});

describe("busyPauseMs", () => {
  it("waits five seconds, or longer when Retry-After says so", () => {
    expect(busyPauseMs(null)).toBe(5_000);
    expect(busyPauseMs("0")).toBe(5_000);
    expect(busyPauseMs("8")).toBe(8_000);
  });
});

describe("retryDelayMs", () => {
  it("honours a numeric Retry-After, capped at 10 seconds", () => {
    expect(retryDelayMs(0, "2")).toBe(2000);
    expect(retryDelayMs(0, "120")).toBe(10_000);
  });

  it("backs off exponentially with jitter when Retry-After is missing or a date", () => {
    expect(retryDelayMs(0, null, () => 0.5)).toBe(500);
    expect(retryDelayMs(2, null, () => 0.5)).toBe(2000);
    expect(retryDelayMs(1, "Wed, 21 Oct 2026 07:28:00 GMT", () => 0)).toBe(500);
  });
});

describe("takeToken", () => {
  it("spends the burst, then refills at the configured rate", () => {
    const bucket: TokenBucket = { tokens: 2, updatedAt: 0 };
    expect(takeToken(bucket, 0, 2, 2)).toBe(true);
    expect(takeToken(bucket, 0, 2, 2)).toBe(true);
    expect(takeToken(bucket, 0, 2, 2)).toBe(false);
    expect(takeToken(bucket, 400, 2, 2)).toBe(false);
    expect(takeToken(bucket, 500, 2, 2)).toBe(true);
  });

  it("does not accumulate more than the capacity while idle", () => {
    const bucket: TokenBucket = { tokens: 0, updatedAt: 0 };
    takeToken(bucket, 60_000, 3, 3);
    expect(bucket.tokens).toBe(2);
  });
});

describe("isUnreadablePlaceholderReusable", () => {
  it("asks again after six hours", () => {
    const fetchedAt = new Date("2026-10-08T08:00:00Z");
    expect(
      isUnreadablePlaceholderReusable(
        fetchedAt,
        new Date("2026-10-08T13:59:00Z"),
      ),
    ).toBe(true);
    expect(
      isUnreadablePlaceholderReusable(
        fetchedAt,
        new Date("2026-10-08T14:00:00Z"),
      ),
    ).toBe(false);
  });
});

describe("isStoredRunReusable", () => {
  it("keeps a run for good once it was stored three days after it ran", () => {
    expect(
      isStoredRunReusable(
        "2026-09-01",
        new Date("2026-09-04T12:00:00Z"),
        new Date("2026-12-01T12:00:00Z"),
      ),
    ).toBe(true);
  });

  it("refreshes a run stored soon after it ran once six hours have passed", () => {
    const fetchedAt = new Date("2026-10-08T08:00:00Z");
    expect(
      isStoredRunReusable(
        "2026-10-07",
        fetchedAt,
        new Date("2026-10-08T13:00:00Z"),
      ),
    ).toBe(true);
    expect(
      isStoredRunReusable(
        "2026-10-07",
        fetchedAt,
        new Date("2026-10-08T15:00:00Z"),
      ),
    ).toBe(false);
  });
});
