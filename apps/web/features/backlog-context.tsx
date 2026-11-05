"use client";

import { createContext, useContext, type ReactNode } from "react";
import { useBacklog, type BacklogState } from "@/features/use-backlog";
import type { BacklogRequest } from "@/shared/contracts";

const BacklogContext = createContext<BacklogState | undefined>(undefined);

/**
 * One HSP answer per page, shared by the train list and the arrival history, so a page
 * asks HSP about each quarter-hour once. Without a request, as once Darwin covers the
 * period, there is no state and the figures are Darwin's.
 */
export function BacklogProvider({
  request,
  children,
}: {
  request: BacklogRequest | undefined;
  children: ReactNode;
}) {
  const state = useBacklog(request);
  return (
    <BacklogContext.Provider value={request ? state : undefined}>
      {children}
    </BacklogContext.Provider>
  );
}

export function useBacklogState(): BacklogState | undefined {
  return useContext(BacklogContext);
}
