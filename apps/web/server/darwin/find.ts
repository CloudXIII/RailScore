import "server-only";
import { addCalendarDays, londonIsoDate, trailingDays } from "@railscore/core";
import { database } from "../db";
import { dayTypeOf } from "../day-type";
import {
  servicesFromRuns,
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
 * the chosen day type: today's once the morning snapshot is read. Their runs in the period
 * come by schedule UID. The period starts at the oldest stored day when the import began
 * later than the period, so the dates shown are the ones the counts cover. The runs read are
 * returned too, so a calculation for one of the trains needs no second read.
 */
export async function findDarwinServices(
  search: DarwinSearch,
  now: Date,
): Promise<
  Omit<DarwinServiceList, "timetableDate"> & {
    runs: ReadonlyMap<string, DarwinRun>;
  }
> {
  const period = trailingDays(search.periodDays, now);
  const sql = database();
  const oldest = sql ? await oldestRunDate(sql) : undefined;
  const empty = {
    services: [],
    retired: [],
    runs: new Map<string, DarwinRun>(),
    period: {
      from: oldest && oldest > period.from ? oldest : period.from,
      to: period.to,
    },
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
    const history = await runsOfTrains(sql, {
      uids: [...new Set(day.map((run) => run.uid).filter(Boolean))],
      fromDate: period.from,
      toDate: today,
    });
    const runs = new Map(day.map((run) => [run.rid, run]));
    for (const run of history) {
      runs.set(run.rid, run);
    }
    const list = servicesFromRuns([...runs.values()], search, {
      today,
      todayTimetable,
      oldest,
    });
    if (list && list.services.length > 0) {
      return { ...list, runs };
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
