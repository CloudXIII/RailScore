import "server-only";
import { addCalendarDays, londonIsoDate } from "@railscore/core";
import { database } from "../db";
import { dayTypeOf } from "@/shared/day-type";
import { darwinFirstDay, hspConnection } from "../env";
import { laterDate, searchPeriods, type DateSpan } from "../periods";
import {
  servicesFromRuns,
  trainPage,
  uidsLeaving,
  WHOLE_DAY,
  type DarwinSearch,
  type DarwinServiceList,
} from "./services";
import type { DarwinRun } from "./run";
import {
  oldestRunDate,
  openFrom,
  runsOfTrains,
  runsOnDay,
  timetableDate,
} from "./store";

/** Days of the chosen type tried, newest first, for one with a timetable on this route. */
const TIMETABLE_DAYS_TRIED = 3;

/**
 * The service list from stored Darwin runs. The trains come from the latest timetable of
 * the chosen day type: today's once the morning snapshot is read. The list is the next few
 * trains from the searched time, and only their runs in the period are read, by schedule
 * UID, so a busy route costs no more than a quiet one. Darwin counts from the first day it
 * saw whole; the days before it are HSP's, filled in by the page after the list is shown
 * (`hsp`). Without HSP the period starts at that first Darwin day, so the dates shown are the
 * ones the counts cover. The runs read are returned too, so a calculation for one of the
 * trains needs no second read.
 */
export async function findDarwinServices(
  search: DarwinSearch,
  now: Date,
): Promise<
  Omit<DarwinServiceList, "timetableDate"> & {
    runs: ReadonlyMap<string, DarwinRun>;
    /** Searched time, HHMM, of the trains before these. */
    earlier?: string;
    /** Searched time, HHMM, of the trains after these. */
    later?: string;
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
  for (const date of timetableDays(search, today, todayTimetable, earliest)) {
    const day = await runsOnDay(sql, {
      fromCrs: search.fromCrs,
      toCrs: search.toCrs,
      date,
    });
    if (day.length === 0) {
      continue;
    }
    const input = { today, todayTimetable, countedFrom, period };
    const timetable = servicesFromRuns(day, search, input, WHOLE_DAY);
    if (!timetable || timetable.services.length === 0) {
      continue;
    }
    const page = trainPage(timetable.services, search.timeHhmm);
    const links = {
      ...(page.earlier ? { earlier: page.earlier } : {}),
      ...(page.later ? { later: page.later } : {}),
    };
    if (!page.window) {
      return { ...empty, ...links };
    }
    const history = await runsOfTrains(sql, {
      uids: uidsLeaving(day, search, page.window),
      fromDate: laterDate(period.from, countedFrom),
      toDate: today,
    });
    const runs = new Map(day.map((run) => [run.rid, run]));
    for (const run of history) {
      runs.set(run.rid, run);
    }
    const list = servicesFromRuns(
      [...runs.values()],
      search,
      input,
      page.window,
    );
    if (list) {
      return {
        ...list,
        runs,
        ...links,
        ...(periods.hsp ? { hsp: periods.hsp } : {}),
      };
    }
  }
  return empty;
}

/** Latest open dates of the chosen day type, today first when its timetable is loaded. */
function timetableDays(
  search: DarwinSearch,
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
    if (search.days === "all" || dayTypeOf(date) === search.days) {
      dates.push(date);
    }
  }
  return dates;
}
