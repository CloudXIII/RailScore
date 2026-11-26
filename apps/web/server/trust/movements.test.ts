import { describe, expect, it } from "vitest";
import {
  latestMovements,
  parseTrustMessage,
  ukClockToUtc,
  type TrustMovement,
} from "./movements";

/** A TRUST timestamp: the UK clock time written as if it were UTC. */
const uk = (clock: string) => String(Date.parse(`${clock}Z`));

function movement(body: Record<string, string>) {
  return { header: { msg_type: "0003" }, body };
}

describe("parseTrustMessage", () => {
  it("keeps activations and movements at public times", () => {
    const value = JSON.stringify([
      {
        header: { msg_type: "0001" },
        body: {
          train_id: "722M151025",
          train_uid: "C12345 ",
          tp_origin_timestamp: "2026-11-25",
        },
      },
      movement({
        train_id: "722M151025",
        loc_stanox: "87701",
        event_type: "ARRIVAL",
        gbtt_timestamp: uk("2026-11-25T23:41"),
        actual_timestamp: uk("2026-11-25T23:43:30"),
      }),
      // A passing point: no public time.
      movement({
        train_id: "722M151025",
        loc_stanox: "87702",
        event_type: "DEPARTURE",
        gbtt_timestamp: "",
        actual_timestamp: uk("2026-11-25T23:45"),
      }),
      { header: { msg_type: "0002" }, body: { train_id: "x" } },
    ]);
    expect(parseTrustMessage(value)).toEqual({
      activations: [
        { trainId: "722M151025", uid: "C12345", date: "2026-11-25" },
      ],
      movements: [
        {
          trainId: "722M151025",
          stanox: "87701",
          event: "arrival",
          planned: "2341",
          actual: "2343",
          plannedAt: Date.parse("2026-11-25T23:41Z"),
          lateness: 2,
        },
      ],
    });
  });

  it("gives nothing for a value that is not a JSON array", () => {
    expect(parseTrustMessage("not json")).toEqual({
      activations: [],
      movements: [],
    });
    expect(parseTrustMessage("{}")).toEqual({ activations: [], movements: [] });
  });

  it("counts an early arrival as negative lateness across midnight", () => {
    const { movements } = parseTrustMessage(
      JSON.stringify([
        movement({
          train_id: "1A01MX26",
          loc_stanox: "1",
          event_type: "DEPARTURE",
          gbtt_timestamp: uk("2026-11-26T00:01"),
          actual_timestamp: uk("2026-11-25T23:59"),
        }),
      ]),
    );
    expect(movements[0]).toMatchObject({
      planned: "0001",
      actual: "2359",
      lateness: -2,
    });
  });
});

describe("ukClockToUtc", () => {
  it("is the same instant in winter", () => {
    expect(ukClockToUtc(Date.parse("2026-11-25T23:41Z"))).toBe(
      Date.parse("2026-11-25T23:41Z"),
    );
  });

  it("is an hour earlier in summer", () => {
    expect(ukClockToUtc(Date.parse("2026-07-01T08:00Z"))).toBe(
      Date.parse("2026-07-01T07:00Z"),
    );
  });
});

describe("latestMovements", () => {
  it("keeps the latest report of each call, by train", () => {
    const base: TrustMovement = {
      trainId: "A",
      stanox: "1",
      event: "arrival",
      planned: "1000",
      actual: "1001",
      plannedAt: 1,
      lateness: 1,
    };
    const corrected = { ...base, actual: "1002", lateness: 2 };
    const departure = { ...base, event: "departure" as const };
    const other = { ...base, trainId: "B" };
    expect(latestMovements([base, departure, other, corrected])).toEqual(
      new Map([
        ["A", [corrected, departure]],
        ["B", [other]],
      ]),
    );
  });
});
