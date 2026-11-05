import { describe, expect, it } from "vitest";
import { parseQuery } from "./query";
import { type ParsedQuery } from "@/shared/search-query";
import type { Station } from "@/shared/stations";

const STATIONS: readonly Station[] = [
  { crs: "EUS", name: "London Euston" },
  { crs: "MAN", name: "Manchester Piccadilly" },
];

function search(
  time: string | undefined,
  extra: Record<string, string> = {},
): ParsedQuery {
  return parseQuery(
    {
      from: "London Euston (EUS)",
      to: "Manchester Piccadilly (MAN)",
      ...(time === undefined ? {} : { time }),
      ...extra,
    },
    STATIONS,
  );
}

describe("parseQuery time", () => {
  it("rejects a clock that matches the shape but is not a time", () => {
    for (const time of ["25:00", "24:00", "07:60"]) {
      const parsed = search(time, { calculate: "1" });
      expect(parsed.errors, time).toContain("Enter a departure time.");
      expect(parsed.calculate, time).toBe(false);
      expect(parsed.from?.crs, time).toBe("EUS");
      expect(parsed.to?.crs, time).toBe("MAN");
    }
  });

  it("keeps a real time and defaults a missing one to 06:30", () => {
    expect(search("23:59").errors).toEqual([]);
    expect(search("23:59").time).toBe("23:59");
    expect(search("").time).toBe("06:30");
    expect(search("").errors).toEqual([]);
    expect(search(undefined).time).toBe("06:30");
  });
});
