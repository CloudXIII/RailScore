import type { Sql } from "postgres";
import { describe, expect, it } from "vitest";
import type { DarwinUpdate } from "./push-port";
import { applyUpdates, type KnownRuns } from "./store";

const now = new Date("2026-11-02T09:00:00Z");
const rid = "202611026782766";

const status: DarwinUpdate = {
  kind: "status",
  rid,
  serviceDate: "2026-11-02",
  calls: [{ tpl: "CLPHMJN", ptd: "0812", atd: "0813" }],
};

/**
 * A stand-in for postgres.js that answers the queries `applyUpdates` sends: the RIDs each read
 * asked for, and the rows each write sent.
 */
function fakeDatabase(stored: Record<string, string>) {
  const reads: string[][] = [];
  const writes: { rid: string; calls: string }[][] = [];
  const sql = (first: unknown, ...values: unknown[]) => {
    if (!Array.isArray(first) || !("raw" in first)) {
      return { list: first };
    }
    const text = first.join("?");
    if (text.includes("min(service_date)")) {
      return Promise.resolve([{ oldest: null }]);
    }
    if (text.includes("insert into darwin_runs")) {
      writes.push(
        (values[0] as { list: { rid: string; calls: string }[] }).list,
      );
      return Promise.resolve([]);
    }
    const rids = (values[0] as { list: string[] }).list;
    reads.push(rids);
    return Promise.resolve(
      rids
        .filter((wanted) => stored[wanted] !== undefined)
        .map((wanted) => ({
          rid: wanted,
          service_date: "2026-11-02",
          uid: "C82766",
          toc: "SW",
          calls: stored[wanted],
          late_reason: "",
          cancel_reason: "",
        })),
    );
  };
  return { sql: sql as unknown as Sql, reads, writes };
}

describe("applyUpdates", () => {
  it("reads a run once per import and merges later updates onto what it wrote", async () => {
    const db = fakeDatabase({ [rid]: "CLJ,,0812,,,,;WAT,0823,,,,," });
    const known: KnownRuns = new Map();

    await applyUpdates(db.sql, [status], known, now);
    await applyUpdates(
      db.sql,
      [
        {
          ...status,
          calls: [{ tpl: "WATRLMN", pta: "0823", ata: "0826" }],
        },
      ],
      known,
      now,
    );

    expect(db.reads).toEqual([[rid]]);
    expect(db.writes.map((rows) => rows.map((row) => row.calls))).toEqual([
      ["CLJ,,0812,,0813,,;WAT,0823,,,,,"],
      ["CLJ,,0812,,0813,,;WAT,0823,,0826,,,"],
    ]);
  });

  it("remembers a RID with no stored run, so it is not asked for again", async () => {
    const db = fakeDatabase({});
    const known: KnownRuns = new Map();
    const unknown = { ...status, rid: "202611027000001", calls: [] };

    await applyUpdates(db.sql, [unknown], known, now);
    await applyUpdates(db.sql, [unknown], known, now);

    expect(db.reads).toEqual([["202611027000001"]]);
    expect(known.get("202611027000001")).toBeNull();
    expect(db.writes).toEqual([]);
  });
});
