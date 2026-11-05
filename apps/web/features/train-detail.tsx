"use client";

import { useEffect, useState, type MouseEvent, type ReactNode } from "react";
import styles from "./train-detail.module.css";

/**
 * One chosen train, with the list already loaded for this search.
 * Narrow screens show one of the two at a time. Wide screens show both side by side.
 */
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
    const chosen = document
      .querySelector<HTMLInputElement>('input[name="service"]:checked')
      ?.closest<HTMLElement>("label");
    const heading = document.getElementById("trains-heading");
    (chosen ?? heading)?.scrollIntoView({ block: chosen ? "center" : "start" });
    heading?.focus({ preventScroll: true });
  }, [showTrains]);

  return (
    <div
      className={styles.detailScreen}
      data-view={showTrains ? "trains" : "result"}
    >
      <div className={styles.detailTrains}>{trains}</div>
      <div className={styles.detailResult}>
        <a
          className={styles.backTrains}
          href={href}
          aria-label="Back to trains"
          onClick={(event: MouseEvent<HTMLAnchorElement>) => {
            // This page already has the list. Following the link would search again.
            event.preventDefault();
            setShowTrains(true);
            window.history.replaceState(null, "", href);
          }}
        >
          <svg
            className={styles.backChevron}
            viewBox="0 0 12 24"
            aria-hidden="true"
          >
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
    </div>
  );
}
