"use client";

import { useEffect, useRef, useState } from "react";
import {
  applyProgressUpdate,
  type ProgressSnapshot,
} from "@/features/progress-update";
import type { ProvisionalFigures } from "@/server/hsp/calculation-progress";

export function WaitingTrain({
  title,
  detail,
  serviceKey,
  saved,
  total,
  provisional,
}: {
  title: string;
  detail: string;
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

  return (
    <section className="card train-wait" role="status">
      <div className="wait-heading">
        <span className="spinner" aria-hidden="true" />
        <h2>{title}</h2>
      </div>
      {known ? (
        <p className="train-count">
          <strong>
            {known.saved} of {known.total}
          </strong>{" "}
          runs checked
        </p>
      ) : null}
      {known?.provisional && known.saved < known.total ? (
        <p className="train-count">
          So far, <strong>{known.provisional.onTimePercentage}%</strong> arrived
          within 5 minutes and{" "}
          <strong>{known.provisional.cancelledPercentage}%</strong> were
          cancelled, from {known.provisional.known} runs checked so far. The
          final figures may differ.
        </p>
      ) : null}
      <p className="meta">{detail}</p>
    </section>
  );
}
