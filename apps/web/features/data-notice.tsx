import styles from "./data-notice.module.css";

export function DataNotice({ sample }: { sample: boolean }) {
  return (
    <footer className={styles.siteFooter}>
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
          {/* The explanations wait behind a click. The data credit stays in view. */}
          <details className={styles.aboutFigures}>
            <summary>
              <h2>About these figures</h2>
            </summary>
            <p>
              These figures describe past direct trains in the period shown.
              They are not a forecast, and they are not a basis for Delay Repay
              or any other compensation.
            </p>
            <p>
              Cancelled includes trains that did not stop at the station you
              board, and trains that did not reach the destination. RailScore
              works that out from the recorded times. It is not an official
              cancellation figure.
            </p>
          </details>
          <p>
            Train running data: Darwin, and Historic Service Performance for
            days before 4 November 2026, Rail Delivery Group. Station names:
            National Rail. RailScore is not endorsed by Rail Delivery Group,
            National Rail or train operators.
          </p>
        </>
      )}
    </footer>
  );
}
