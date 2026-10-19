import { beforeEach, describe, expect, it, vi } from "vitest";

type StoredRow = {
  rid: string;
  service_date: string;
  payload: unknown;
  fetched_at: Date;
};

const state = vi.hoisted(() => ({
  rows: [] as StoredRow[],
}));

vi.mock("../db", () => ({
  database: () => {
    const sql = (strings: TemplateStringsArray) => {
      if (strings.join(" ").includes("from hsp_runs")) {
        return Promise.resolve(state.rows);
      }
      return Promise.resolve([]);
    };
    sql.array = (values: readonly string[]) => values;
    sql.json = (value: unknown) => value;
    return sql;
  },
}));

import { loadStoredRuns, saveRun } from "./run-store";

const rid = "202608010000001";
const fresh = {
  serviceAttributesDetails: {
    date_of_service: "2026-08-01",
    locations: [
      { location: "LIV", gbtt_pta: "0630", actual_ta: "0631" },
      { location: "MIA", gbtt_pta: "0721", actual_ta: "0722" },
    ],
  },
};
const stale = {
  serviceAttributesDetails: { date_of_service: "2026-08-01", locations: [] },
};

describe("loadStoredRuns", () => {
  beforeEach(() => {
    state.rows = [];
  });

  it("keeps a newer in-memory run when the database row is older", async () => {
    await saveRun(rid, fresh);
    state.rows = [
      {
        rid,
        service_date: "2026-08-01",
        payload: stale,
        fetched_at: new Date(Date.now() - 60 * 60 * 1000),
      },
    ];

    const stored = await loadStoredRuns([rid], new Date());

    expect(stored.get(rid)).toEqual(fresh);
  });

  it("uses the database row when it was fetched later than memory", async () => {
    await saveRun(rid, stale);
    state.rows = [
      {
        rid,
        service_date: "2026-08-01",
        payload: fresh,
        fetched_at: new Date(Date.now() + 5_000),
      },
    ];

    const stored = await loadStoredRuns([rid], new Date());

    expect(stored.get(rid)).toEqual(fresh);
  });
});
