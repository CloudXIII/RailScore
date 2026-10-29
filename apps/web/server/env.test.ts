import { afterEach, describe, expect, it } from "vitest";
import {
  databasePoolMax,
  hspConnection,
  hspDailyCallLimit,
  hspDetailConcurrency,
  hspListSlotCount,
  hspListStartGapMs,
  hspListWorkers,
  hspSerialAfterRefusalMs,
  logHspCalls,
  MissingEnvironmentError,
  requireEnv,
} from "./env";

const NAMES = [
  "HSP_BASE_URL",
  "HSP_API_KEY",
  "HSP_API_KEY_HEADER",
  "RAILSCORE_TEST_REQUIRED",
] as const;

describe("requireEnv", () => {
  const saved = new Map<string, string | undefined>();

  afterEach(() => {
    for (const name of NAMES) {
      const value = saved.get(name);
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    }
  });

  it("names the missing variable", () => {
    saved.set("RAILSCORE_TEST_REQUIRED", process.env.RAILSCORE_TEST_REQUIRED);
    delete process.env.RAILSCORE_TEST_REQUIRED;

    expect(() => requireEnv("RAILSCORE_TEST_REQUIRED")).toThrow(
      new MissingEnvironmentError("RAILSCORE_TEST_REQUIRED"),
    );
  });

  it("treats a blank value as missing", () => {
    saved.set("RAILSCORE_TEST_REQUIRED", process.env.RAILSCORE_TEST_REQUIRED);
    process.env.RAILSCORE_TEST_REQUIRED = "  ";

    expect(() => requireEnv("RAILSCORE_TEST_REQUIRED")).toThrow(
      "Missing required environment variable: RAILSCORE_TEST_REQUIRED",
    );
  });

  it("names every missing HSP value", () => {
    for (const name of NAMES) {
      saved.set(name, process.env[name]);
      delete process.env[name];
    }
    process.env.HSP_BASE_URL = "https://hsp.test";

    expect(() => hspConnection()).toThrow(
      "Missing required environment variable: HSP_API_KEY, HSP_API_KEY_HEADER",
    );
  });
});

describe("hspDailyCallLimit", () => {
  const key = "HSP_DAILY_CALL_LIMIT";
  const previous = process.env[key];

  afterEach(() => {
    if (previous === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = previous;
    }
  });

  it("stays at 5000 unless set to a positive whole number", () => {
    delete process.env[key];
    expect(hspDailyCallLimit()).toBe(5000);
    process.env[key] = "  ";
    expect(hspDailyCallLimit()).toBe(5000);
    process.env[key] = "0";
    expect(hspDailyCallLimit()).toBe(5000);
    process.env[key] = "nope";
    expect(hspDailyCallLimit()).toBe(5000);
    process.env[key] = "40";
    expect(hspDailyCallLimit()).toBe(40);
  });
});

describe("hsp concurrency", () => {
  const keys = [
    "HSP_LIST_WORKERS",
    "HSP_LIST_SLOT_COUNT",
    "HSP_LIST_START_GAP_MS",
    "HSP_DETAIL_CONCURRENCY",
    "HSP_SERIAL_AFTER_REFUSAL_MS",
    "DATABASE_POOL_MAX",
  ] as const;
  const saved = new Map<string, string | undefined>();

  afterEach(() => {
    for (const name of keys) {
      const value = saved.get(name);
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    }
  });

  it("keeps the HSP-safe defaults until a usable value is set", () => {
    for (const name of keys) {
      saved.set(name, process.env[name]);
      delete process.env[name];
    }
    expect(hspListWorkers()).toBe(2);
    expect(hspListSlotCount()).toBe(2);
    expect(hspListStartGapMs()).toBe(1_500);
    expect(hspDetailConcurrency()).toBe(1);
    expect(hspSerialAfterRefusalMs()).toBe(180_000);
    expect(databasePoolMax()).toBe(3);

    process.env.HSP_LIST_WORKERS = "0";
    process.env.HSP_LIST_START_GAP_MS = "nope";
    expect(hspListWorkers()).toBe(2);
    expect(hspListStartGapMs()).toBe(1_500);

    process.env.HSP_LIST_WORKERS = "16";
    process.env.HSP_LIST_SLOT_COUNT = "32";
    process.env.HSP_LIST_START_GAP_MS = "0";
    process.env.HSP_DETAIL_CONCURRENCY = "12";
    process.env.HSP_SERIAL_AFTER_REFUSAL_MS = "0";
    process.env.DATABASE_POOL_MAX = "40";
    expect(hspListWorkers()).toBe(16);
    expect(hspListSlotCount()).toBe(32);
    expect(hspListStartGapMs()).toBe(0);
    expect(hspDetailConcurrency()).toBe(12);
    expect(hspSerialAfterRefusalMs()).toBe(0);
    expect(databasePoolMax()).toBe(40);
  });
});

describe("logHspCalls", () => {
  const key = "RAILSCORE_LOG_HSP";
  const previous = process.env[key];

  afterEach(() => {
    if (previous === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = previous;
    }
  });

  it("stays off unless the variable is 1", () => {
    delete process.env[key];
    expect(logHspCalls()).toBe(false);
    process.env[key] = "1";
    expect(logHspCalls()).toBe(true);
    process.env[key] = "true";
    expect(logHspCalls()).toBe(false);
  });
});
