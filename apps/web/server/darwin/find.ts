import "server-only";
import { addCalendarDays, londonIsoDate, trailingDays } from "@railscore/core";
import { database } from "../db";
import { dayTypeOf } from "../day-type";
import {
  servicesFromRuns,
  type DarwinSearch,
  type DarwinServiceList,
} from "./services";
import { oldestRunDate, runsOfTrains, runsOnDay, timetableDate } from "./store";

/** Days of the chosen type tried, newest first, for one with a timetable on this route. */
const TIMETABLE_DAYS_TRIED = 3;

/**
 * The service list from stored Darwin runs. The trains come from the latest timetable of
 * the chosen day type: today's once the morning snapshot is read. Their runs in the period
 * come by schedule UID. The period starts at the oldest stored day when the import began
 * later than the period, so the dates shown are the ones the counts cover.
 */
export async function findDarwinServices(
  search: DarwinSearch,
  now: Date,
): Promise<Omit<DarwinServiceList, "timetableDate">> {
  const period = trailingDays(search.periodDays, now);
  const sql = database();
  const oldest = sql ? await oldestRunDate(sql) : undefined;
  const empty = {
    services: [],
    retired: [],
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
  for (const date of timetableDays(search, today, todayTimetable, oldest)) {
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
    const known = new Set(history.map((run) => run.rid));
    const list = servicesFromRuns(
      [...history, ...day.filter((run) => !known.has(run.rid))],
      search,
      { today, todayTimetable, oldest },
    );
    if (list && list.services.length > 0) {
      return list;
    }
  }
  return empty;
}

/** Latest dates of the chosen day type, today first when its timetable is loaded. */
function timetableDays(
  search: DarwinSearch,
  today: string,
  todayTimetable: boolean,
  oldest: string,
): string[] {
  const dates: string[] = [];
  for (
    let date = todayTimetable ? today : addCalendarDays(today, -1);
    date >= oldest && dates.length < TIMETABLE_DAYS_TRIED;
    date = addCalendarDays(date, -1)
  ) {
    if (search.days === "all" || dayTypeOf(date) === search.days) {
      dates.push(date);
    }
  }
  return dates;
}
