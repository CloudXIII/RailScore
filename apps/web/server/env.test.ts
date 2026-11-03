import { afterEach, describe, expect, it } from "vitest";
import {
  databasePoolMax,
  darwinKeepDays,
  darwinSnapshot,
  MissingEnvironmentError,
  requireEnv,
} from "./env";

const NAMES = [
  "DARWIN_SNAPSHOT_URL",
  "DARWIN_SNAPSHOT_CONSUMER_KEY",
  "DATABASE_POOL_MAX",
  "DARWIN_KEEP_DAYS",
  "RAILSCORE_TEST_REQUIRED",
] as const;

const saved = new Map<string, string | undefined>();

function clear(): void {
  for (const name of NAMES) {
    saved.set(name, process.env[name]);
    delete process.env[name];
  }
}

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

describe("requireEnv", () => {
  it("names the missing variable", () => {
    clear();

    expect(() => requireEnv("RAILSCORE_TEST_REQUIRED")).toThrow(
      new MissingEnvironmentError("RAILSCORE_TEST_REQUIRED"),
    );
  });

  it("treats a blank value as missing", () => {
    clear();
    process.env.RAILSCORE_TEST_REQUIRED = "  ";

    expect(() => requireEnv("RAILSCORE_TEST_REQUIRED")).toThrow(
      "Missing required environment variable: RAILSCORE_TEST_REQUIRED",
    );
  });

  it("names every missing snapshot value", () => {
    clear();
    process.env.DARWIN_SNAPSHOT_URL = "https://snapshot.test";

    expect(() => darwinSnapshot()).toThrow(
      "Missing required environment variable: DARWIN_SNAPSHOT_CONSUMER_KEY",
    );
  });
});

describe("numeric settings", () => {
  it("keeps the defaults until a usable value is set", () => {
    clear();
    expect(databasePoolMax()).toBe(3);
    expect(darwinKeepDays()).toBe(90);

    process.env.DATABASE_POOL_MAX = "0";
    process.env.DARWIN_KEEP_DAYS = "nope";
    expect(databasePoolMax()).toBe(3);
    expect(darwinKeepDays()).toBe(90);

    process.env.DATABASE_POOL_MAX = "40";
    process.env.DARWIN_KEEP_DAYS = "14";
    expect(databasePoolMax()).toBe(40);
    expect(darwinKeepDays()).toBe(14);
  });
});
