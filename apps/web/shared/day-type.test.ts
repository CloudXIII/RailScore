import { describe, expect, it } from "vitest";
import { nightAfter, ownDays } from "./day-type";

describe("the night after a day", () => {
  it("runs Saturday into Sunday and Sunday into a weekday", () => {
    expect(nightAfter("saturday")).toBe("sunday");
    expect(nightAfter("sunday")).toBe("weekdays");
    expect(nightAfter("weekdays")).toBe("weekdays");
    expect(nightAfter("all")).toBe("all");
  });

  it("names a train's own day types only when they are not the searched ones", () => {
    expect(ownDays(["sunday"], "saturday")).toEqual(["sunday"]);
    expect(ownDays(["saturday"], "saturday")).toBeUndefined();
    expect(ownDays(["sunday"], "all")).toBeUndefined();
    expect(ownDays([], "saturday")).toBeUndefined();
  });
});
