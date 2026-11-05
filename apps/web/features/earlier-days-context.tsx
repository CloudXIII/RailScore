"use client";

import { createContext, useContext, type ReactNode } from "react";
import {
  useEarlierDays,
  type EarlierDaysState,
} from "@/features/use-earlier-days";
import type { EarlierDaysRequest } from "@/shared/contracts";

const EarlierDaysContext = createContext<EarlierDaysState | undefined>(
  undefined,
);

/**
 * One HSP answer per page, shared by the train list and the arrival history, so a page
 * asks HSP about each quarter-hour once. Without a request, as once Darwin covers the
 * period, there is no state and the figures are Darwin's.
 */
export function EarlierDaysProvider({
  request,
  children,
}: {
  request: EarlierDaysRequest | undefined;
  children: ReactNode;
}) {
  const state = useEarlierDays(request);
  return (
    <EarlierDaysContext.Provider value={request ? state : undefined}>
      {children}
    </EarlierDaysContext.Provider>
  );
}

export function useEarlierDaysState(): EarlierDaysState | undefined {
  return useContext(EarlierDaysContext);
}
