import styles from "./data-notice.module.css";

export function DataNotice({ sample }: { sample: boolean }) {
  return (
    <footer className={styles.siteFooter}>
      <div className={styles.siteFooterInner}>
        {sample ? (
          <>
            <h2>About these figures</h2>
            <p>
              These screens use sample data. The trains and figures are made up.
              They are not historical performance from Rail Delivery Group. Only
              direct trains are shown.
            </p>
          </>
        ) : (
          <>
            {/* Data credit only. How the figures work sits next to the figures. */}
            <p>
              Train data: Darwin and Historic Service Performance, Rail Delivery
              Group. Station names: National Rail.
            </p>
            <p>
              RailScore is not endorsed by Rail Delivery Group, National Rail or
              train operators.
            </p>
          </>
        )}
      </div>
    </footer>
  );
}

/** Under the trains and figures: what they are, with the details one click away. */
export function AboutFigures() {
  return (
    <section className={styles.aboutFigures} aria-label="About these figures">
      <p>
        Based on past journeys. Not a forecast, and not a basis for Delay Repay
        or any other compensation.
      </p>
      <details>
        <summary>How these figures work</summary>
        <div className={styles.aboutFiguresBody}>
          <p>
            The figures describe past direct trains in the period shown. On time
            means the train arrived early or no more than 5 minutes late.
          </p>
          <p>
            Cancelled includes trains that did not stop at the station you
            board, and trains that did not reach the destination. RailScore
            works that out from the recorded times. It is not an official
            cancellation figure.
          </p>
          <p>
            Journeys before 4 November 2026 come from Historic Service
            Performance. Later journeys come from Darwin.
          </p>
        </div>
      </details>
    </section>
  );
}
