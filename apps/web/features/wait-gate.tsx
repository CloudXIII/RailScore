"use client";

import {
  createContext,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { WaitingTrain } from "@/features/waiting-train";
import type { DayPattern } from "@/server/query";

const ContentReadyContext = createContext<(() => void) | null>(null);

/**
 * Keeps the waiting UI outside a Suspense fallback so it hydrates and can
 * advance phase text / poll progress while the panel is still loading.
 */
export function WaitGate({
  children,
  title,
  detail,
  mode,
  periodDays,
  days,
  serviceKey,
}: {
  children: ReactNode;
  title: string;
  detail: string;
  mode: "search" | "calculation";
  periodDays: number;
  days: DayPattern;
  serviceKey?: string;
}) {
  const [ready, setReady] = useState(false);
  const markReady = useRef(() => setReady(true)).current;

  return (
    <ContentReadyContext.Provider value={markReady}>
      {ready ? null : (
        <WaitingTrain
          title={title}
          detail={detail}
          mode={mode}
          periodDays={periodDays}
          days={days}
          serviceKey={serviceKey}
        />
      )}
      <div hidden={!ready}>{children}</div>
    </ContentReadyContext.Provider>
  );
}

/** Signals WaitGate that the streamed panel content is on the page. */
export function ContentReady({ children }: { children: ReactNode }) {
  const markReady = useContext(ContentReadyContext);
  useLayoutEffect(() => {
    markReady?.();
  }, [markReady]);
  return children;
}
