import { afterEach, describe, expect, it } from "vitest";
import {
  hspConnection,
  hspDailyCallLimit,
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
