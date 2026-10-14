import { describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  connected: false,
  rows: [] as { calls: number }[],
  error: undefined as Error | undefined,
  query: "",
  values: [] as unknown[],
}));

vi.mock("../db", () => ({
  database: () => {
    if (!state.connected) {
      return undefined;
    }
    const sql = (strings: TemplateStringsArray, ...values: unknown[]) => {
      state.query = strings.join(" ");
      state.values = values;
      if (state.error) {
        return Promise.reject(state.error);
      }
      return Promise.resolve(state.rows);
    };
    return sql;
  },
}));

import { DailyLimitError, takeDailyCall } from "./daily-limit";

describe("takeDailyCall", () => {
  it("does nothing when no database is configured", async () => {
    state.connected = false;
    await expect(
      takeDailyCall(new Date("2026-10-14T12:00:00Z")),
    ).resolves.toBeUndefined();
  });

  it("asks Postgres to count the call only while the day is under the limit", async () => {
    state.connected = true;
    state.error = undefined;
    state.rows = [{ calls: 1 }];
    process.env.HSP_DAILY_CALL_LIMIT = "40";

    await takeDailyCall(new Date("2026-06-15T12:00:00Z"));

    expect(state.query).toContain("hsp_daily_calls");
    expect(state.query).toContain("where");
    expect(state.values).toEqual(["2026-06-15", 40]);
    delete process.env.HSP_DAILY_CALL_LIMIT;
  });

  it("stops the call when the day is already at the limit", async () => {
    state.connected = true;
    state.error = undefined;
    state.rows = [];

    await expect(takeDailyCall()).rejects.toBeInstanceOf(DailyLimitError);
    await expect(takeDailyCall()).rejects.toThrow(
      "The daily limit for this demo has been reached. Try again tomorrow.",
    );
  });

  it("refuses the call when the counter cannot be updated", async () => {
    state.connected = true;
    state.error = new Error("relation hsp_daily_calls does not exist");
    const errors: unknown[][] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...args) => {
      errors.push(args);
    });

    await expect(takeDailyCall()).rejects.toThrow(
      "The demo is temporarily unavailable. Try again later.",
    );
    expect(errors).toEqual([
      [
        "HSP daily limit could not be updated",
        "relation hsp_daily_calls does not exist",
      ],
    ]);
    spy.mockRestore();
    state.error = undefined;
    state.connected = false;
  });
});
