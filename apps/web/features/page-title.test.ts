import { describe, expect, it } from "vitest";
import { pageTitle } from "./page-title";

describe("pageTitle", () => {
  it("names both stations", () => {
    expect(pageTitle("London Paddington", "Reading")).toBe(
      "London Paddington to Reading · RailScore",
    );
  });

  it("stays the app name until both stations are known", () => {
    expect(pageTitle()).toBe("RailScore");
    expect(pageTitle("Reading")).toBe("RailScore");
  });
});
