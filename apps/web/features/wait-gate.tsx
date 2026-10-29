"use client";

import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { WaitingTrain } from "@/features/waiting-train";
import {
  claimWaitingReload,
  clearWaitingReload,
  WAITING_RELOAD_MS,
} from "@/features/wait-phase";
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
  const [gaveUp, setGaveUp] = useState(false);
  const markReady = useRef(() => setReady(true)).current;

  useEffect(() => {
    if (ready) {
      clearWaitingReload(window.location.pathname, window.location.search);
      return;
    }
    const timer = window.setTimeout(() => {
      if (document.querySelector("[data-results-ready]")) {
        return;
      }
      const reload = claimWaitingReload(
        window.location.pathname,
        window.location.search,
      );
      if (reload) {
        window.location.reload();
        return;
      }
      setGaveUp(true);
    }, WAITING_RELOAD_MS);
    return () => window.clearTimeout(timer);
  }, [ready]);

  return (
    <ContentReadyContext.Provider value={markReady}>
      {ready ? null : gaveUp ? (
        <div className="errors" role="alert">
          <p>This search did not finish. Try again later.</p>
          <button
            type="button"
            className="link-button"
            onClick={() => {
              clearWaitingReload(window.location.pathname, window.location.search);
              window.location.reload();
            }}
          >
            Try again
          </button>
        </div>
      ) : (
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
  return (
    <>
      <span data-results-ready="" hidden />
      {children}
    </>
  );
}
