import { addCalendarDays, type CalendarMark } from "@railscore/core";
import { formatClock } from "@/features/format";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

export type DayCell =
  | { readonly kind: "pad" }
  | { readonly kind: "empty"; readonly date: string }
  | {
      readonly kind: "run";
      readonly date: string;
      readonly mark: CalendarMark;
    };

export type DayMonth = {
  readonly id: string;
  readonly label: string;
  /** Weekday names across the top, Monday first. A filtered month omits days that never occur. */
  readonly weekdays: readonly (typeof WEEKDAYS)[number][];
  /** One row per week. Cells line up under `weekdays`. Days outside the block are padding. */
  readonly weeks: readonly (readonly DayCell[])[];
};

/** One month block, laid out like a calendar: weekdays across the top and weeks down the page. */
export type DayFilter = "weekdays" | "saturday" | "sunday" | "all";

export function calendarMonths(
  period: { from: string; to: string },
  marks: readonly CalendarMark[],
  days: DayFilter = "all",
): DayMonth[] {
  const byDate = new Map(marks.map((mark) => [mark.serviceDate, mark]));
  const months: DayMonth[] = [];
  let cursor = period.from.slice(0, 7);
  const last = period.to.slice(0, 7);

  while (cursor <= last) {
    const monthStart = `${cursor}-01`;
    const monthEnd = addCalendarDays(
      addCalendarDays(monthStart, 32).slice(0, 7) + "-01",
      -1,
    );
    const first = monthStart > period.from ? monthStart : period.from;
    const lastDay = monthEnd < period.to ? monthEnd : period.to;
    const gridStart = addCalendarDays(first, -weekdayIndex(first));
    const gridEnd = addCalendarDays(lastDay, 6 - weekdayIndex(lastDay));
    const weeks: DayCell[][] = [];
    for (
      let week = gridStart;
      week <= gridEnd;
      week = addCalendarDays(week, 7)
    ) {
      weeks.push(
        WEEKDAYS.map((_, index) =>
          cellFor(addCalendarDays(week, index), cursor, period, days, byDate),
        ),
      );
    }
    const used = WEEKDAYS.map((_, index) =>
      weeks.some((week) => week[index]?.kind !== "pad"),
    );
    months.push({
      id: cursor,
      label: monthLabel(monthStart),
      weekdays: WEEKDAYS.filter((_, index) => used[index]),
      weeks: weeks
        .map((week) => week.filter((_, index) => used[index]))
        .filter((week) => week.some((cell) => cell.kind !== "pad")),
    });
    cursor = addCalendarDays(monthEnd, 1).slice(0, 7);
  }
  return months;
}

function cellFor(
  date: string,
  month: string,
  period: { from: string; to: string },
  days: DayFilter,
  byDate: Map<string, CalendarMark>,
): DayCell {
  if (
    date.slice(0, 7) !== month ||
    date < period.from ||
    date > period.to ||
    !matchesDays(date, days)
  ) {
    return { kind: "pad" };
  }
  const mark = byDate.get(date);
  return mark ? { kind: "run", date, mark } : { kind: "empty", date };
}

function matchesDays(iso: string, days: DayFilter): boolean {
  const index = weekdayIndex(iso);
  if (days === "weekdays") {
    return index < 5;
  }
  if (days === "saturday") {
    return index === 5;
  }
  if (days === "sunday") {
    return index === 6;
  }
  return true;
}

function weekdayIndex(iso: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) {
    return 0;
  }
  const day = new Date(
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])),
  ).getUTCDay();
  return day === 0 ? 6 : day - 1;
}

function monthLabel(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    month: "short",
    timeZone: "UTC",
  }).format(utcDate(iso));
}

export type TimetableMark = {
  readonly number: number;
  readonly publicDeparture: string;
  readonly publicArrival: string;
};

/**
 * One number per distinct booked timetable, in the order each first appears.
 * The same departure and arrival keep one number across every date.
 */
export function timetableMarks(
  changes: readonly {
    serviceDate: string;
    publicDeparture: string;
    publicArrival: string;
  }[],
): {
  readonly marks: readonly TimetableMark[];
  readonly byDate: ReadonlyMap<string, number>;
} {
  const marks: TimetableMark[] = [];
  const byDate = new Map<string, number>();
  const numberByTimes = new Map<string, number>();
  const ordered = [...changes].sort((left, right) =>
    left.serviceDate.localeCompare(right.serviceDate),
  );
  for (const change of ordered) {
    const key = `${change.publicDeparture}-${change.publicArrival}`;
    let number = numberByTimes.get(key);
    if (number === undefined) {
      number = marks.length + 1;
      numberByTimes.set(key, number);
      marks.push({
        number,
        publicDeparture: change.publicDeparture,
        publicArrival: change.publicArrival,
      });
    }
    byDate.set(change.serviceDate, number);
  }
  return { marks, byDate };
}

/** Screen-reader suffix for a day that ran to another timetable. */
export function timetableChangeLabel(change: {
  publicDeparture: string;
  publicArrival: string;
}): string {
  return `, different timetable: ${formatClock(change.publicDeparture)}–${formatClock(change.publicArrival)}`;
}

export function dayLabel(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(utcDate(iso));
}

function utcDate(iso: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) {
    return new Date(NaN);
  }
  return new Date(
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])),
  );
}
