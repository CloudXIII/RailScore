"use client";

import { useEffect } from "react";
import { WaitingTrain } from "@/features/waiting-train";
import type { ProvisionalFigures } from "@/server/hsp/calculation-progress";

/** The page ran out of time mid-calculation. Reload the same URL, which continues from the saved runs. */
export function CalculationProgress({
  saved,
  total,
  provisional,
  serviceKey,
}: {
  saved: number;
  total: number;
  provisional?: ProvisionalFigures;
  serviceKey?: string;
}) {
  useEffect(() => {
    const timer = window.setTimeout(() => window.location.reload(), 700);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <WaitingTrain
      title="Checking this train's recent runs"
      detail="This page refreshes on its own and keeps going. Leave this tab open."
      serviceKey={serviceKey}
      saved={saved}
      total={total}
      provisional={provisional}
    />
  );
}
