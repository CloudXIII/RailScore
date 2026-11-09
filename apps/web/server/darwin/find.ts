import "server-only";
import { addCalendarDays, londonIsoDate } from "@railscore/core";
import { database } from "../db";
import { dayTypeOf, nightAfter, type DayPattern } from "@/shared/day-type";
import type { ScheduledService } from "@/shared/scheduled-service";
import { darwinFirstDay, hspConnection } from "../env";
import { laterDate, searchPeriods, type DateSpan } from "../periods";
import {
  AFTER_MIDNIGHT,
  LIST_SIZE,
  NIGHT,
  overnightList,
  servicesFromRuns,
  legsLeaving,
  sameTrainLookup,
  trainPage,
  WHOLE_DAY,
  type ClockWindow,
  type DarwinSearch,
  type DarwinServiceList,
} from "./services";
import type { DarwinRun } from "./run";
import { timetableDate } from "./import-state";
import {
  oldestRunDate,
  openFrom,
  runsOfTrains,
  runsOnDay,
  uidsOfSameTrains,
} from "./store";

/** Days of the chosen type tried, newest first, for one with a timetable on this route. */
const TIMETABLE_DAYS_TRIED = 3;

/**
 * The service list from stored Darwin runs. The trains come from the latest timetable of
 * the chosen day type: today's once the morning snapshot is read. The list is the next few
 * trains from the searched time, and only their runs in the period are read, by schedule
 * UID, so a busy route costs no more than a quiet one. A train missing from an open day of
 * the day type may run under another UID that day: those UIDs are looked up by operator and
 * public times, and their runs read too (`sameTrainLookup`). Darwin counts from the first day it
 * saw whole; the days before it are HSP's, filled in by the page after the list is shown
 * (`hsp`). Without HSP the period starts at that first Darwin day, so the dates shown are the
 * ones the counts cover. The runs read are returned too, so a calculation for one of the
 * trains needs no second read.
 *
 * A list that reaches the end of the day goes on after midnight (`overnight`): the day's
 * trains that board after midnight, then the trains the next night's list shows before 04:00
 * (Saturday's list goes on with Sunday's), counted on that list's day type. That costs one
 * more read of a day's timetable, none when the next list is the same day's.
 */
export async function findDarwinServices(
  search: DarwinSearch,
  now: Date,
): Promise<
  Omit<DarwinServiceList, "timetableDate"> & {
    runs: ReadonlyMap<string, DarwinRun>;
    /** Trains after midnight at the end of the day. Absent when the list stops before it. */
    overnight?: ScheduledService[];
    /** Searched time, HHMM, of the trains before these. */
    earlier?: string;
    /** Searched time, HHMM, of the trains after these. */
    later?: string;
    /** Day type of the list `later` opens, when it is the next night's and not the searched one. */
    laterDays?: DayPattern;
    /** Days before Darwin, for HSP. Absent once Darwin covers the period. */
    hsp?: DateSpan;
  }
> {
  const sql = database();
  const oldest = sql ? await oldestRunDate(sql) : undefined;
  const countedFrom = laterDate(darwinFirstDay(), oldest ?? "");
  const periods = searchPeriods(
    search.periodDays,
    now,
    countedFrom,
    hspConnection() !== undefined,
  );
  const period = periods.period;
  const empty = {
    services: [],
    retired: [],
    runs: new Map<string, DarwinRun>(),
    period,
    ...(periods.hsp ? { hsp: periods.hsp } : {}),
  };
  if (!sql || !oldest) {
    return empty;
  }
  const today = londonIsoDate(now);
  const todayTimetable = (await timetableDate(sql)) === today;
  const earliest = oldest > openFrom(now) ? oldest : openFrom(now);
  const input = { today, todayTimetable, countedFrom, period };
  /** The latest timetable of a day type on this route, newest first. */
  const latestTimetable = async (
    days: DayPattern,
    known?: { date: string; runs: DarwinRun[] },
  ) => {
    for (const date of timetableDays(days, today, todayTimetable, earliest)) {
      const runs =
        known?.date === date
          ? known.runs
          : await runsOnDay(sql, {
              fromCrs: search.fromCrs,
              toCrs: search.toCrs,
              date,
            });
      const timetable =
        runs.length > 0
          ? servicesFromRuns(runs, { ...search, days }, input, WHOLE_DAY)
          : undefined;
      if (timetable && timetable.services.length > 0) {
        return { date, runs, timetable };
      }
    }
    return undefined;
  };

  const found = await latestTimetable(search.days);
  if (!found) {
    return empty;
  }
  const day = found.runs;
  const page = trainPage(found.timetable.services, search.timeHhmm);
  const parts: {
    search: DarwinSearch;
    runs: DarwinRun[];
    window: ClockWindow;
  }[] = page.window ? [{ search, runs: day, window: page.window }] : [];
  let later = page.later;
  let laterDays: DayPattern | undefined;
  if (!page.later) {
    const lateTrains =
      servicesFromRuns(day, search, input, AFTER_MIDNIGHT)?.services ?? [];
    parts.push({ search, runs: day, window: AFTER_MIDNIGHT });
    const nightDays = nightAfter(search.days);
    const next = await latestTimetable(nightDays, {
      date: found.date,
      runs: day,
    });
    const nightSearch = { ...search, days: nightDays };
    const nightTrains = next
      ? (servicesFromRuns(next.runs, nightSearch, input, NIGHT)?.services ?? [])
      : [];
    const room = LIST_SIZE - page.services.length - lateTrains.length;
    const nightPage = trainPage(nightTrains, NIGHT.from, Math.max(0, room));
    if (next && nightPage.window) {
      parts.push({
        search: nightSearch,
        runs: next.runs,
        window: nightPage.window,
      });
    }
    if (nightPage.later) {
      later = nightPage.later;
      laterDays = nightDays === search.days ? undefined : nightDays;
    }
  }
  const links = {
    ...(page.earlier ? { earlier: page.earlier } : {}),
    ...(later ? { later } : {}),
    ...(laterDays ? { laterDays } : {}),
  };
  const span = {
    fromDate: laterDate(period.from, countedFrom),
    toDate: today,
  };
  const legs = parts.map((part) =>
    legsLeaving(part.runs, part.search, part.window),
  );
  const known = new Set(legs.flat().map((leg) => leg.uid));
  const runs = new Map<string, DarwinRun>();
  for (const run of [
    ...parts.flatMap((part) => part.runs),
    ...(await runsOfTrains(sql, { uids: [...known], ...span })),
  ]) {
    runs.set(run.rid, run);
  }
  const lookups = parts.flatMap((part, index) => {
    const lookup = sameTrainLookup(
      legs[index]!,
      [...runs.values()],
      part.search,
      openDays(
        part.search.days,
        laterDate(span.fromDate, earliest),
        today,
        todayTimetable,
      ),
    );
    return lookup ? [lookup] : [];
  });
  if (lookups.length > 0) {
    const found = await uidsOfSameTrains(sql, {
      fromCrs: search.fromCrs,
      toCrs: search.toCrs,
      dates: [...new Set(lookups.flatMap((lookup) => lookup.dates))].sort(),
      trains: lookups.flatMap((lookup) => lookup.trains),
    });
    const uids = found.filter((uid) => !known.has(uid));
    for (const run of await runsOfTrains(sql, { uids, ...span })) {
      runs.set(run.rid, run);
    }
  }
  const lists = parts.map((part) =>
    servicesFromRuns([...runs.values()], part.search, input, part.window),
  );
  const list = page.window ? lists[0] : undefined;
  const services = list?.services ?? [];
  return {
    ...empty,
    ...(list ?? {}),
    services,
    runs,
    ...(page.later
      ? {}
      : {
          overnight: overnightList(
            services,
            lists[page.window ? 1 : 0]?.services ?? [],
            lists[page.window ? 2 : 1]?.services ?? [],
          ),
        }),
    ...links,
  };
}

/** Latest open dates of the chosen day type, today first when its timetable is loaded. */
function timetableDays(
  days: DayPattern,
  today: string,
  todayTimetable: boolean,
  earliest: string,
): string[] {
  const dates: string[] = [];
  for (
    let date = todayTimetable ? today : addCalendarDays(today, -1);
    date >= earliest && dates.length < TIMETABLE_DAYS_TRIED;
    date = addCalendarDays(date, -1)
  ) {
    if (days === "all" || dayTypeOf(date) === days) {
      dates.push(date);
    }
  }
  return dates;
}

/**
 * Open dates of the chosen day type from `from` to today. Today only when its timetable is
 * loaded: before that its runs are partial.
 */
function openDays(
  days: DayPattern,
  from: string,
  today: string,
  todayTimetable: boolean,
): string[] {
  const dates: string[] = [];
  const last = todayTimetable ? today : addCalendarDays(today, -1);
  for (let date = from; date <= last; date = addCalendarDays(date, 1)) {
    if (days === "all" || dayTypeOf(date) === days) {
      dates.push(date);
    }
  }
  return dates;
}
