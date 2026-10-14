"use client";

import { useEffect, useState, type MouseEvent, type ReactNode } from "react";

/** One chosen train, with a way back to the list already loaded for this search. */
export function TrainDetail({
  href,
  result,
  trains,
}: {
  href: string;
  result: ReactNode;
  trains: ReactNode;
}) {
  const [showTrains, setShowTrains] = useState(false);

  useEffect(() => {
    if (!showTrains) {
      return;
    }
    const chosen = document.querySelector<HTMLElement>(
      ".service:has(input:checked)",
    );
    const heading = document.getElementById("trains-heading");
    (chosen ?? heading)?.scrollIntoView({ block: chosen ? "center" : "start" });
    heading?.focus({ preventScroll: true });
  }, [showTrains]);

  if (showTrains) {
    return trains;
  }

  return (
    <div className="detail-screen">
      <a
        className="back-trains"
        href={href}
        aria-label="Back to trains"
        onClick={(event: MouseEvent<HTMLAnchorElement>) => {
          // This page already has the list. Following the link would search again.
          event.preventDefault();
          setShowTrains(true);
          window.history.replaceState(null, "", href);
        }}
      >
        <svg className="back-chevron" viewBox="0 0 12 24" aria-hidden="true">
          <path
            d="M9.5 2.5 2.5 12l7 9.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        Back
      </a>
      {result}
    </div>
  );
}
