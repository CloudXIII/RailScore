import vm from "node:vm";
import { describe, expect, it } from "vitest";
import {
  calculationPhase,
  progressMoment,
  retryDelaySeconds,
  searchPhase,
  shouldReloadWaitingPage,
  WAITING_RELOAD_MS,
  waitingReloadScript,
  SLOW_SOURCE_MESSAGE,
} from "./wait-phase";

describe("searchPhase", () => {
  it("names the period first, then moves on with the wait", () => {
    const at = (elapsedMs: number) =>
      searchPhase({ elapsedMs, periodDays: 90, days: "all" });

    expect(at(0)).toBe("Looking up trains from the last 90 days");
    expect(at(5_000)).toBe(
      "Checking the weekday, Saturday and Sunday timetables",
    );
    expect(at(20_000)).toBe(
      "Busy routes have many trains, so this can take a little longer",
    );
    expect(at(40_000)).toBe(SLOW_SOURCE_MESSAGE);
  });

  it("does not mention every day type for a single one", () => {
    expect(
      searchPhase({ elapsedMs: 5_000, periodDays: 30, days: "weekdays" }),
    ).toBe("Gathering every train that matches your time");
  });
});

describe("calculationPhase", () => {
  const base = { hasProvisional: false, stalled: false, periodDays: 60 };

  it("follows the journeys checked", () => {
    expect(calculationPhase(base)).toBe(
      "Fetching this train's journeys from the last 60 days",
    );
    expect(calculationPhase({ ...base, saved: 2, total: 40 })).toBe(
      "The first journeys are arriving",
    );
    expect(
      calculationPhase({ ...base, saved: 10, total: 40, hasProvisional: true }),
    ).toBe("Early figures are in. Checking the remaining journeys");
    expect(
      calculationPhase({ ...base, saved: 36, total: 40, hasProvisional: true }),
    ).toBe("Almost there, checking the last few journeys");
  });

  it("says the source is slow when the count stops moving", () => {
    expect(
      calculationPhase({ ...base, saved: 10, total: 40, stalled: true }),
    ).toBe(SLOW_SOURCE_MESSAGE);
  });
});

describe("progressMoment", () => {
  it("keeps the earlier moment while the count is unchanged", () => {
    const remembered = { saved: 12, at: 1_000 };
    expect(progressMoment(remembered, 12, 20_000)).toBe(remembered);
  });

  it("starts again when the count moves", () => {
    expect(progressMoment({ saved: 12, at: 1_000 }, 13, 20_000)).toEqual({
      saved: 13,
      at: 20_000,
    });
  });

  it("forgets a moment from an earlier visit", () => {
    expect(progressMoment({ saved: 12, at: 0 }, 12, 10 * 60 * 1000)).toEqual({
      saved: 12,
      at: 10 * 60 * 1000,
    });
  });
});

describe("shouldReloadWaitingPage", () => {
  it("reloads the same search once a minute has passed with no list", () => {
    expect(shouldReloadWaitingPage(false, WAITING_RELOAD_MS - 1)).toBe(false);
    expect(shouldReloadWaitingPage(false, WAITING_RELOAD_MS)).toBe(true);
  });

  it("does not reload once the list is on the page", () => {
    expect(shouldReloadWaitingPage(true, WAITING_RELOAD_MS + 5_000)).toBe(false);
  });

  it("arms the same minute from the first HTML, only for a search still waiting", () => {
    expect(waitingReloadScript).toContain(String(WAITING_RELOAD_MS));
    expect(waitingReloadScript).toContain('p.get("from")');
    expect(waitingReloadScript).toContain('p.get("to")');
    expect(waitingReloadScript).toContain("[data-results-ready]");
    expect(waitingReloadScript).toContain("location.reload()");
  });

  it("reloads a search that is still waiting and leaves the home page and a finished result alone", () => {
    const home = armReload("");
    expect(home.timers).toHaveLength(0);

    const waiting = armReload("?from=PNZ&to=TRU");
    expect(waiting.timers).toEqual([{ ms: WAITING_RELOAD_MS }]);
    waiting.fire();
    expect(waiting.reloaded()).toBe(true);

    const finished = armReload("?from=PNZ&to=TRU");
    finished.markReady();
    finished.fire();
    expect(finished.reloaded()).toBe(false);
  });
});

function armReload(search: string): {
  timers: { ms: number }[];
  fire: () => void;
  markReady: () => void;
  reloaded: () => boolean;
} {
  const timers: { fn: () => void; ms: number }[] = [];
  let reloaded = false;
  let ready = false;
  vm.runInNewContext(waitingReloadScript, {
    URLSearchParams,
    location: {
      search,
      reload() {
        reloaded = true;
      },
    },
    document: {
      querySelector(selector: string) {
        return ready && selector === "[data-results-ready]" ? { selector } : null;
      },
    },
    setTimeout(fn: () => void, ms: number) {
      timers.push({ fn, ms });
      return timers.length;
    },
  });
  return {
    timers: timers.map(({ ms }) => ({ ms })),
    fire() {
      timers[0]?.fn();
    },
    markReady() {
      ready = true;
    },
    reloaded: () => reloaded,
  };
}

describe("retryDelaySeconds", () => {
  it("grows with each try and levels off", () => {
    expect([1, 2, 3, 5, 10].map(retryDelaySeconds)).toEqual([
      10, 15, 20, 30, 30,
    ]);
  });
});
