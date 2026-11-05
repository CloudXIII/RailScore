import type { ReliabilityResult } from "@railscore/core";
import { DayCalendar } from "@/features/day-calendar";
import {
  formatClock,
  formatDate,
  formatDuration,
  FEW_JOURNEYS,
  operatorName,
  scoreTier,
  serviceDayNote,
  throughServiceLabel,
} from "@/features/format";
import type { DayPattern } from "@/shared/day-type";
import {
  notableChanges,
  scheduleNotes,
  usualDays,
} from "@/features/timetable-changes";
import { stationName, type Station } from "@/shared/stations";
import type { ScheduledService } from "@/shared/scheduled-service";
import bands from "./bands.module.css";
import styles from "./reliability-result.module.css";

export function ReliabilityResultView({
  service,
  fromCrs,
  toCrs,
  period,
  result,
  stations,
  days,
  progress,
  pending = false,
}: {
  service: ScheduledService;
  fromCrs: string;
  toCrs: string;
  period: { from: string; to: string };
  result: ReliabilityResult;
  stations: readonly Station[];
  days: DayPattern;
  /** How far HSP's older journeys have got, while they load. */
  progress?: string;
  /** The figures wait for HSP's older journeys: a placeholder stands in for them. */
  pending?: boolean;
}) {
  const through = throughServiceLabel(service, fromCrs, toCrs, (crs) =>
    stationName(crs, stations),
  );
  const known = result.withinFiveMinutes.total;
  const showCalendar = !pending && result.calendar.length > 0;
  const changes = notableChanges(service);
  const notes = scheduleNotes(service);
  const dayNote = serviceDayNote(usualDays(service), days);
  return (
    <div className={styles.resultStack} aria-live="polite">
      <section
        className={`card ${styles.result}`}
        aria-labelledby="result-title"
      >
        <div className={styles.resultSummary}>
          <h2 id="result-title" className={styles.resultTimes}>
            {formatClock(service.publicDeparture)}–
            {formatClock(service.publicArrival)}
          </h2>
          <p className="meta">
            {operatorName(service.operatorCode)} ·{" "}
            {formatDuration(service.publicDeparture, service.publicArrival)}
            {dayNote ? ` · ${dayNote}` : ""}
            {through ? (
              <>
                <br />
                {through}
              </>
            ) : null}
          </p>
          {pending ? (
            <div className={styles.headline}>
              <span
                className={`score-placeholder ${styles.headlinePlaceholder}`}
              />
            </div>
          ) : (
            <Headline result={result} period={period} days={days} />
          )}
          {progress ? (
            <p className="meta earlier-days-progress" role="status">
              {progress}
            </p>
          ) : null}
          {notes.length > 0 ? (
            <ul className={styles.includedTimes}>
              {notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          ) : null}
          {!pending && result.excludedCount > 0 ? (
            <p className="warning">
              {result.excludedCount === 1
                ? "1 journey has"
                : `${result.excludedCount} journeys have`}{" "}
              no arrival time and no sign of a cancellation, so{" "}
              {result.excludedCount === 1 ? "it is" : "they are"} left out of
              every figure.
            </p>
          ) : null}
          {!pending &&
          result.status === "no_history" &&
          result.excludedCount === 0 ? (
            <p className="warning">
              No past journeys were found for this train in the period.
            </p>
          ) : null}
        </div>
        {!pending && known > 0 ? <Distribution result={result} /> : null}
      </section>
      {showCalendar ? (
        <section className="card">
          <DayCalendar
            period={period}
            marks={result.calendar}
            days={days}
            changes={changes}
          />
        </section>
      ) : null}
    </div>
  );
}

function Distribution({ result }: { result: ReliabilityResult }) {
  const { distribution } = result;
  const rows = [
    {
      label: "Early or within 5 minutes",
      count: distribution.withinFive,
      band: bands.onTime,
      bar: bands.onTimeBar,
    },
    {
      label: "6 to 14 minutes late",
      count: distribution.sixToFourteen,
      band: bands.late,
      bar: bands.lateBar,
    },
    {
      label: "15 to 29 minutes late",
      count: distribution.fifteenToTwentyNine,
      band: bands.later,
      bar: bands.laterBar,
    },
    {
      label: "30 minutes or more late",
      count: distribution.thirtyOrMore,
      band: bands.severe,
      bar: bands.severeBar,
    },
    {
      label: "Cancelled or did not reach your destination",
      count: distribution.cancelled,
      band: bands.cancelled,
      bar: bands.cancelledBar,
    },
  ];
  const max = Math.max(...rows.map((row) => row.count));
  return (
    <table className={styles.distribution}>
      <caption>How each journey went</caption>
      <tbody>
        {rows.map((row) => (
          <tr key={row.label}>
            <th scope="row">
              {/* The swatch doubles as the calendar's key: its cells use the same colours (bands.module.css). */}
              <span className={styles.distributionLabel}>
                <span
                  className={`${bands.swatch} ${row.band}`}
                  aria-hidden="true"
                />
                {row.label}
              </span>
              <span className={styles.distributionTrack} aria-hidden="true">
                <span
                  className={`${styles.distributionBar} ${row.bar}`}
                  style={{
                    width: max === 0 ? "0%" : `${(row.count / max) * 100}%`,
                  }}
                />
              </span>
            </th>
            <td className={styles.distributionCount}>{row.count}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Headline({
  result,
  period,
  days,
}: {
  result: ReliabilityResult;
  period: { from: string; to: string };
  days: DayPattern;
}) {
  const within = result.withinFiveMinutes;
  return (
    <div className={styles.headline}>
      {within.percentage !== null ? (
        <p
          className={`${styles.headlineValue} tier-${scoreTier(within.percentage, within.total)}`}
        >
          {within.percentage}%
        </p>
      ) : null}
      <p className={styles.verdict}>{punctualitySentence(result)}</p>
      <p className="meta">{sampleLine(result, period, days)}</p>
    </div>
  );
}

function punctualitySentence(result: ReliabilityResult): string {
  const { percentage } = result.withinFiveMinutes;
  if (percentage === null) {
    return "There were no journeys with a known outcome, so there is no on-time figure.";
  }
  return "of these journeys arrived on time, no more than 5 minutes late.";
}

function sampleLine(
  result: ReliabilityResult,
  period: { from: string; to: string },
  days: DayPattern,
): string {
  const known = result.withinFiveMinutes.total;
  const excluded =
    result.excludedCount > 0 ? ` (${result.excludedCount} without data)` : "";
  const journeys = `${known} ${journeyNoun(known, days)}${excluded}`;
  const line = `${journeys}, ${formatDate(period.from)} to ${formatDate(period.to)}.`;
  return known > 0 && known < FEW_JOURNEYS
    ? `${line} Too few journeys to say much yet.`
    : line;
}

function journeyNoun(count: number, days: DayPattern): string {
  const journeys = count === 1 ? "journey" : "journeys";
  if (days === "weekdays") {
    return `weekday ${journeys}`;
  }
  if (days === "saturday") {
    return `Saturday ${journeys}`;
  }
  if (days === "sunday") {
    return `Sunday ${journeys}`;
  }
  return journeys;
}
