import type { CalendarMark } from "@railscore/core";
import {
  calendarMonths,
  dayLabel,
  timetableChangeLabel,
  timetableMarks,
  type DayCell,
} from "@/features/day-grid";
import { formatClock } from "@/features/format";
import type { TimetableChange } from "@/features/timetable-changes";
import type { DayPattern } from "@/shared/day-type";

export function DayCalendar({
  period,
  marks,
  days,
  changes = [],
}: {
  period: { from: string; to: string };
  marks: readonly CalendarMark[];
  days: DayPattern;
  changes?: readonly TimetableChange[];
}) {
  const months = calendarMonths(period, marks, days);
  if (months.length === 0) {
    return null;
  }
  const changeByDate = new Map(
    changes.map((change) => [change.serviceDate, change]),
  );
  const cells = months.flatMap((month) => month.weeks.flat());
  const visibleChanges = changes.filter((change) =>
    cells.some(
      (cell) => cell.kind !== "pad" && cell.date === change.serviceDate,
    ),
  );
  const footnotes = timetableMarks(visibleChanges);
  const showMissing = cells.some(
    (cell) => cell.kind === "run" && cell.mark.kind === "no_data",
  );
  const showEmpty = cells.some((cell) => cell.kind === "empty");
  return (
    <figure className="day-calendar">
      <figcaption>{calendarCaption(days)}</figcaption>
      <div className="day-months">
        {months.map((month) => (
          <table key={month.id} className="day-month">
            <caption>{month.label}</caption>
            <thead>
              <tr>
                {month.weekdays.map((weekday) => (
                  <th key={weekday} scope="col">
                    {weekday}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {month.weeks.map((week, weekIndex) => (
                <tr key={weekIndex}>
                  {week.map((cell, index) => (
                    <td key={`${weekIndex}-${index}`}>
                      {dayCell(
                        cell,
                        cell.kind === "pad"
                          ? undefined
                          : changeByDate.get(cell.date),
                        cell.kind === "pad"
                          ? undefined
                          : footnotes.byDate.get(cell.date),
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        ))}
      </div>
      {/* The colours of the outcomes are keyed by the distribution above the calendar.
          Only what it does not show is listed here. */}
      {showMissing || showEmpty || footnotes.marks.length > 0 ? (
        <ul className="day-legend">
          {showMissing ? (
            <LegendItem swatch="day-missing" label="No data" />
          ) : null}
          {showEmpty ? (
            <LegendItem swatch="day-empty" label="No train" />
          ) : null}
          {footnotes.marks.map((mark) => (
            <LegendItem
              key={mark.number}
              note={`*${mark.number}`}
              label={`${formatClock(mark.publicDeparture)}–${formatClock(mark.publicArrival)}`}
            />
          ))}
        </ul>
      ) : null}
    </figure>
  );
}

function LegendItem({
  swatch,
  note,
  label,
}: {
  swatch?: string;
  note?: string;
  label: string;
}) {
  return (
    <li aria-label={note ? `Timetable ${note.slice(1)}, ${label}` : undefined}>
      {note ? (
        <span className="day-footnote" aria-hidden="true">
          {note}
        </span>
      ) : (
        <span className={`swatch ${swatch}`} aria-hidden="true" />
      )}
      {label}
    </li>
  );
}

function calendarCaption(days: DayPattern): string {
  if (days === "weekdays") {
    return "How each weekday went";
  }
  if (days === "saturday") {
    return "How each Saturday went";
  }
  if (days === "sunday") {
    return "How each Sunday went";
  }
  return "How each day went";
}

function dayCell(
  cell: DayCell,
  change: TimetableChange | undefined,
  footnote?: number,
) {
  if (cell.kind === "pad") {
    return null;
  }
  const dateNumber = Number(cell.date.slice(8, 10));
  const changed = footnote ? " day-changed" : "";
  const changeLabel = change ? timetableChangeLabel(change) : "";
  const mark = footnote ? (
    <span className="day-footnote" aria-hidden="true">
      *{footnote}
    </span>
  ) : null;
  if (cell.kind === "empty") {
    return (
      <span
        className={`day day-empty${changed}`}
        aria-label={`${dayLabel(cell.date)}, no train recorded${changeLabel}`}
      >
        <span className="day-date">{dateNumber}</span>
        {mark}
      </span>
    );
  }
  const described = describe(cell.mark);
  return (
    <span
      className={`day ${bandClass(cell.mark)}${changed}`}
      aria-label={`${dayLabel(cell.date)}, ${described.label}${changeLabel}`}
    >
      <span className="day-date">{dateNumber}</span>
      <span className="day-value">{described.text}</span>
      {mark}
    </span>
  );
}

function describe(mark: CalendarMark): { text: string; label: string } {
  if (mark.kind === "cancelled") {
    // The full word does not fit a narrow cell. The cell label and the legend spell it out.
    return {
      text: "canc.",
      label: "cancelled or did not reach the destination",
    };
  }
  if (mark.kind === "no_data") {
    return { text: "no data", label: "no arrival time recorded" };
  }
  if (mark.latenessMinutes < 0) {
    const minutes = -mark.latenessMinutes;
    return {
      text: `−${minutes} early`,
      label: `${minutes} ${minutes === 1 ? "minute" : "minutes"} early`,
    };
  }
  if (mark.latenessMinutes === 0) {
    return { text: "on time", label: "on time" };
  }
  return {
    text: `+${mark.latenessMinutes} late`,
    label: `${mark.latenessMinutes} minutes late`,
  };
}

function bandClass(mark: CalendarMark): string {
  if (mark.kind === "on_time") {
    return "day-on-time";
  }
  if (mark.kind === "cancelled") {
    return "day-cancelled";
  }
  if (mark.kind === "no_data") {
    return "day-missing";
  }
  if (mark.latenessMinutes < 15) {
    return "day-late";
  }
  if (mark.latenessMinutes < 30) {
    return "day-later";
  }
  return "day-severe";
}
