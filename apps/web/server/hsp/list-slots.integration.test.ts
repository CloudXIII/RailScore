import postgres from "postgres";
import { describe, expect, it } from "vitest";
import { HspRequestError } from "./client";
import { withListSlot } from "./list-slots";
import { waitForHspSlot } from "./rate-limit";

const databaseUrl = process.env.DATABASE_URL?.trim();

describe("list slot lock", () => {
  it.skipIf(!databaseUrl)(
    "returns busy while another transaction holds the slot rows",
    async () => {
      const sql = postgres(databaseUrl as string, {
        max: 1,
        prepare: false,
        connect_timeout: 15,
      });
      const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
      const hold = sql.begin(async (tx) => {
        await tx`select slot from hsp_list_slots order by slot for update`;
        await sleep(3_000);
      });
      try {
        await sleep(200);
        const started = Date.now();
        const outcome = await Promise.race([
          withListSlot(Date.now() + 5_000, async () => "ran").then(
            () => "ran" as const,
            (error: unknown) => error,
          ),
          sleep(1_500).then(() => "still-blocked" as const),
        ]);
        const waited = Date.now() - started;
        expect(outcome, `waited ${waited}ms`).toBeInstanceOf(HspRequestError);
        expect(outcome).toMatchObject({ kind: "busy" });
        expect(waited).toBeLessThan(1_500);
      } finally {
        await hold;
        await sql.end({ timeout: 5 });
      }
    },
  );

  it.skipIf(!databaseUrl)(
    "renews the lease while the call runs and frees the slot afterwards",
    async () => {
      const sql = postgres(databaseUrl as string, {
        max: 1,
        prepare: false,
        connect_timeout: 15,
      });
      const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
      try {
        const heldBefore = await sql<{ slot: number; owner: string | null }[]>`
          select slot, owner from hsp_list_slots
        `;
        let slot = 0;
        let extendedBy = 0;
        await withListSlot(Date.now() + 60_000, async () => {
          const rows = await sql<
            { slot: number; leased_until: Date; owner: string | null }[]
          >`select slot, leased_until, owner from hsp_list_slots`;
          const taken = rows.find((row) => {
            const previous = heldBefore.find((item) => item.slot === row.slot);
            return Boolean(row.owner) && row.owner !== previous?.owner;
          });
          if (!taken?.owner) throw new Error("this call did not take a slot");
          slot = taken.slot;
          const startedUntil = new Date(taken.leased_until).getTime();
          await sleep(16_000);
          const [after] = await sql<{ leased_until: Date }[]>`
            select leased_until from hsp_list_slots where slot = ${slot}
          `;
          extendedBy = new Date(after.leased_until).getTime() - startedUntil;
        });
        expect(extendedBy).toBeGreaterThan(10_000);
        const [released] = await sql<{ owner: string | null }[]>`
          select owner from hsp_list_slots where slot = ${slot}
        `;
        expect(released.owner).toBeNull();
      } finally {
        await sql.end({ timeout: 5 });
      }
    },
    25_000,
  );
});

describe("rate limit lock", () => {
  it.skipIf(!databaseUrl)(
    "answers busy when the rate row is locked, without spending a local token",
    async () => {
      const sql = postgres(databaseUrl as string, {
        max: 1,
        prepare: false,
        connect_timeout: 15,
      });
      const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
      const hold = sql.begin(async (tx) => {
        await tx`select id from hsp_rate_limit where id = 1 for update`;
        await sleep(3_000);
      });
      try {
        await sleep(200);
        const started = Date.now();
        const granted = await waitForHspSlot(started + 800);
        const waited = Date.now() - started;
        expect(granted).toBe(false);
        expect(waited).toBeGreaterThan(400);
      } finally {
        await hold;
        await sql.end({ timeout: 5 });
      }
    },
  );
});
