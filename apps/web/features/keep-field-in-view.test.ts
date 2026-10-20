import { afterEach, describe, expect, it, vi } from "vitest";
import { keepFieldInView } from "./keep-field-in-view";

describe("keepFieldInView", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("scrolls the field once the keyboard has had time to open", () => {
    vi.useFakeTimers();
    const scrollIntoView = vi.fn();
    const element = { scrollIntoView } as unknown as HTMLElement;
    vi.stubGlobal("document", { activeElement: element });

    keepFieldInView(element);
    expect(scrollIntoView).not.toHaveBeenCalled();

    vi.advanceTimersByTime(280);
    expect(scrollIntoView).toHaveBeenCalledWith({
      block: "center",
      inline: "nearest",
    });
  });

  it("does nothing if focus has already moved on", () => {
    vi.useFakeTimers();
    const scrollIntoView = vi.fn();
    const element = { scrollIntoView } as unknown as HTMLElement;
    vi.stubGlobal("document", { activeElement: {} });

    keepFieldInView(element);
    vi.advanceTimersByTime(280);
    expect(scrollIntoView).not.toHaveBeenCalled();
  });
});
