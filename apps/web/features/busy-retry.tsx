"use client";

import { useEffect, useRef, useState } from "react";
import { WaitingTrain } from "@/features/waiting-train";
import { retryDelaySeconds } from "@/features/wait-phase";
import type { DayPattern } from "@/server/query";

const MAX_TRIES = 6;
/** Tries further apart than this count as a new wait. */
const FRESH_AFTER_MS = 5 * 60 * 1000;

type Tries = { count: number; at: number };

/**
 * The source answered busy. Reload the same URL after a pause, which picks up
 * from the weeks and runs already saved. After a few tries, hand back to the user.
 */
export function BusyRetry({
  title,
  mode,
  periodDays,
  days,
  serviceKey,
  message,
}: {
  title: string;
  mode: "search" | "calculation";
  periodDays: number;
  days: DayPattern;
  serviceKey?: string;
  message: string;
}) {
  const [secondsLeft, setSecondsLeft] = useState<number | undefined>();
  const [gaveUp, setGaveUp] = useState(false);

  const tries = useRef<number | undefined>(undefined);

  useEffect(() => {
    const now = Date.now();
    if (tries.current === undefined) {
      const storageKey = triesKey();
      const previous = readTries(storageKey);
      tries.current =
        previous && now - previous.at < FRESH_AFTER_MS ? previous.count + 1 : 1;
      writeTries(storageKey, { count: tries.current, at: now });
    }
    const count = tries.current;
    if (count > MAX_TRIES) {
      setGaveUp(true);
      return;
    }
    const reloadAt = now + retryDelaySeconds(count) * 1000;
    const tick = () =>
      setSecondsLeft(Math.max(0, Math.ceil((reloadAt - Date.now()) / 1000)));
    tick();
    const countdown = window.setInterval(tick, 1000);
    const reload = window.setTimeout(
      () => window.location.reload(),
      reloadAt - now,
    );
    return () => {
      window.clearInterval(countdown);
      window.clearTimeout(reload);
    };
  }, []);

  if (gaveUp) {
    return (
      <div className="errors" role="alert">
        <p>{message}</p>
        <button
          type="button"
          className="link-button"
          onClick={() => {
            writeTries(triesKey(), undefined);
            window.location.reload();
          }}
        >
          Try again
        </button>
      </div>
    );
  }

  return (
    <WaitingTrain
      title={title}
      detail={
        secondsLeft === undefined
          ? "Your search continues from where it stopped."
          : `Trying again in ${secondsLeft} s. Your search continues from where it stopped.`
      }
      mode={mode}
      periodDays={periodDays}
      days={days}
      slow
      serviceKey={serviceKey}
    />
  );
}

function triesKey(): string {
  return `railscore:busy:${window.location.pathname}${window.location.search}`;
}

function readTries(storageKey: string): Tries | undefined {
  try {
    const raw = window.sessionStorage.getItem(storageKey);
    const value = raw ? (JSON.parse(raw) as Partial<Tries>) : {};
    return typeof value.count === "number" && typeof value.at === "number"
      ? { count: value.count, at: value.at }
      : undefined;
  } catch {
    return undefined;
  }
}

function writeTries(storageKey: string, tries: Tries | undefined): void {
  try {
    if (tries) {
      window.sessionStorage.setItem(storageKey, JSON.stringify(tries));
    } else {
      window.sessionStorage.removeItem(storageKey);
    }
  } catch {
    // Without storage each reload counts as a first try.
  }
}
