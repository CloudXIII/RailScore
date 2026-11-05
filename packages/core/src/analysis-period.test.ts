import { describe, expect, it } from "vitest";
import { dateOfRid, trailingDays } from "./analysis-period";

describe("trailingDays", () => {
  it("covers the chosen number of days and ends yesterday in London", () => {
    const period = trailingDays(30, new Date("2026-10-08T12:00:00Z"));
    expect(period).toEqual({ from: "2026-09-08", to: "2026-10-07" });
    expect(trailingDays(90, new Date("2026-10-08T12:00:00Z")).from).toBe(
      "2026-07-10",
    );
  });
});

describe("dateOfRid", () => {
  it("reads the service date a RID starts with", () => {
    expect(dateOfRid("202611047654321")).toBe("2026-11-04");
  });

  it("is undefined for a RID that does not start with a date", () => {
    expect(dateOfRid("X1234")).toBeUndefined();
  });
});
