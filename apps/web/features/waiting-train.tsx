"use client";

import { useEffect, useRef, useState } from "react";
import {
  applyProgressUpdate,
  type ProgressSnapshot,
} from "@/features/progress-update";
import {
  calculationPhase,
  progressMoment,
  searchPhase,
  SLOW_SOURCE_MESSAGE,
  STALL_MS,
  type ProgressMoment,
} from "@/features/wait-phase";
import type { ProvisionalFigures } from "@/server/hsp/calculation-progress";
import type { DayPattern } from "@/server/query";

export function WaitingTrain({
  title,
  detail,
  mode,
  periodDays,
  days,
  slow = false,
  serviceKey,
  saved,
  total,
  provisional,
}: {
  title: string;
  detail: string;
  mode: "search" | "calculation";
  periodDays: number;
  days: DayPattern;
  /** The source already answered busy. Show that instead of the usual phase. */
  slow?: boolean;
  serviceKey?: string;
  saved?: number;
  total?: number;
  provisional?: ProvisionalFigures;
}) {
  const [live, setLive] = useState<ProgressSnapshot | undefined>(
    typeof saved === "number" && typeof total === "number" && total > 0
      ? { saved, total, ...(provisional ? { provisional } : {}) }
      : undefined,
  );
  const liveRef = useRef(live);
  const mountedAt = useRef(Date.now());
  const [now, setNow] = useState(() => Date.now());
  const [moved, setMoved] = useState<ProgressMoment | undefined>(undefined);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!serviceKey) {
      return;
    }
    let stopped = false;
    async function poll() {
      try {
        const response = await fetch(
          `/api/reliability-progress?service=${encodeURIComponent(serviceKey!)}`,
          {
            cache: "no-store",
          },
        );
        if (!response.ok || stopped) {
          return;
        }
        const body = (await response.json()) as Parameters<
          typeof applyProgressUpdate
        >[1];
        if (stopped) {
          return;
        }
        const next = applyProgressUpdate(
          liveRef.current,
          body,
          Date.now() - mountedAt.current,
        );
        if (next) {
          liveRef.current = next;
          setLive(next);
        }
      } catch {
        // The next poll tries again.
      }
    }
    void poll();
    const timer = window.setInterval(() => void poll(), 1200);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [serviceKey]);

  const known = live && live.total > 0 ? live : undefined;
  const savedCount = known?.saved ?? 0;

  useEffect(() => {
    if (mode !== "calculation" || !serviceKey) {
      return;
    }
    const storageKey = `railscore:progress:${serviceKey}`;
    const moment = progressMoment(
      readMoment(storageKey),
      savedCount,
      Date.now(),
    );
    setMoved(moment);
    try {
      window.sessionStorage.setItem(storageKey, JSON.stringify(moment));
    } catch {
      // Without storage a reload starts the stall clock again.
    }
  }, [mode, serviceKey, savedCount]);

  const stalled = moved !== undefined && now - moved.at >= STALL_MS;
  const phase = slow
    ? SLOW_SOURCE_MESSAGE
    : mode === "search"
      ? searchPhase({ elapsedMs: now - mountedAt.current, periodDays, days })
      : calculationPhase({
          saved: known?.saved,
          total: known?.total,
          hasProvisional: Boolean(known?.provisional),
          stalled,
          periodDays,
        });
  const isSlow = phase === SLOW_SOURCE_MESSAGE;

  return (
    <section className="card train-wait" role="status">
      <div className="wait-heading">
        <span className="spinner" aria-hidden="true" />
        <h2>{title}</h2>
      </div>
      <p key={phase} className={isSlow ? "wait-phase slow" : "wait-phase"}>
        {phase}
      </p>
      {known ? (
        <p className="train-count">
          <strong>
            {known.saved} of {known.total}
          </strong>{" "}
          journeys checked
        </p>
      ) : null}
      {known?.provisional && known.saved < known.total ? (
        <p className="train-count">
          So far, <strong>{known.provisional.onTimePercentage}%</strong> arrived
          on time and <strong>{known.provisional.cancelledPercentage}%</strong>{" "}
          were cancelled, from {known.provisional.known} journeys checked so
          far. The final figures may differ.
        </p>
      ) : null}
      <p className="meta">{detail}</p>
    </section>
  );
}

function readMoment(storageKey: string): ProgressMoment | undefined {
  try {
    const raw = window.sessionStorage.getItem(storageKey);
    const value = raw ? (JSON.parse(raw) as Partial<ProgressMoment>) : {};
    return typeof value.saved === "number" && typeof value.at === "number"
      ? { saved: value.saved, at: value.at }
      : undefined;
  } catch {
    return undefined;
  }
}
