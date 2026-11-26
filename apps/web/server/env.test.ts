import { afterEach, describe, expect, it } from "vitest";
import {
  databasePoolMax,
  darwinKeepDays,
  darwinSnapshot,
  MissingEnvironmentError,
  nwrMovementsKafka,
  requireEnv,
} from "./env";

const NAMES = [
  "DARWIN_SNAPSHOT_URL",
  "DARWIN_SNAPSHOT_CONSUMER_KEY",
  "DATABASE_POOL_MAX",
  "DARWIN_KEEP_DAYS",
  "RAILSCORE_TEST_REQUIRED",
  "NWR_MOVEMENTS_KAFKA_BOOTSTRAP",
  "NWR_MOVEMENTS_KAFKA_USERNAME",
  "NWR_MOVEMENTS_KAFKA_PASSWORD",
  "NWR_MOVEMENTS_KAFKA_GROUP",
  "NWR_MOVEMENTS_KAFKA_TOPIC",
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

describe("nwrMovementsKafka", () => {
  it("is off when none of its variables is set", () => {
    clear();

    expect(nwrMovementsKafka()).toBeUndefined();
  });

  it("names the missing variables when only some are set", () => {
    clear();
    process.env.NWR_MOVEMENTS_KAFKA_BOOTSTRAP = "broker.test:9092";
    process.env.NWR_MOVEMENTS_KAFKA_TOPIC = "TRAIN_MVT_ALL_TOC";

    expect(() => nwrMovementsKafka()).toThrow(
      "Missing required environment variable: NWR_MOVEMENTS_KAFKA_USERNAME, NWR_MOVEMENTS_KAFKA_PASSWORD, NWR_MOVEMENTS_KAFKA_GROUP",
    );
  });

  it("splits the bootstrap servers", () => {
    clear();
    process.env.NWR_MOVEMENTS_KAFKA_BOOTSTRAP = "a.test:9092, b.test:9092";
    process.env.NWR_MOVEMENTS_KAFKA_USERNAME = "user";
    process.env.NWR_MOVEMENTS_KAFKA_PASSWORD = "secret";
    process.env.NWR_MOVEMENTS_KAFKA_GROUP = "group";
    process.env.NWR_MOVEMENTS_KAFKA_TOPIC = "TRAIN_MVT_ALL_TOC";

    expect(nwrMovementsKafka()).toEqual({
      brokers: ["a.test:9092", "b.test:9092"],
      username: "user",
      password: "secret",
      groupId: "group",
      topic: "TRAIN_MVT_ALL_TOC",
    });
  });
});

describe("numeric settings", () => {
  it("keeps the defaults until a usable value is set", () => {
    clear();
    expect(databasePoolMax()).toBe(3);
    expect(darwinKeepDays()).toBe(365);

    process.env.DATABASE_POOL_MAX = "0";
    process.env.DARWIN_KEEP_DAYS = "nope";
    expect(databasePoolMax()).toBe(3);
    expect(darwinKeepDays()).toBe(365);

    process.env.DATABASE_POOL_MAX = "40";
    process.env.DARWIN_KEEP_DAYS = "14";
    expect(databasePoolMax()).toBe(40);
    expect(darwinKeepDays()).toBe(14);
  });
});
