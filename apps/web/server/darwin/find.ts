import "server-only";
import { addCalendarDays, londonIsoDate, trailingDays } from "@railscore/core";
import { database } from "../db";
import { dayTypeOf } from "../day-type";
import { darwinListMode } from "../env";
import {
  servicesFromRuns,
  type DarwinSearch,
  type DarwinServiceList,
} from "./services";
import { oldestRunDate, runsOfTrains, runsOnDay, timetableDate } from "./store";

/** Days of the chosen type tried, newest first, for one with a timetable on this route. */
const TIMETABLE_DAYS_TRIED = 3;

/**
 * The service list from stored Darwin runs, or undefined when HSP should give it instead.
 * The trains come from the latest timetable of the chosen day type: today's once the
 * morning snapshot is read. Their runs in the period come by schedule UID.
 * With `DARWIN_LISTS=auto` Darwin is used once the runs reach back a full day before the
 * period, so the counts describe the whole period. `force` uses whatever is stored.
 */
export async function findDarwinServices(
  search: DarwinSearch,
  now: Date,
): Promise<DarwinServiceList | undefined> {
  const mode = darwinListMode();
  const sql = database();
  if (mode === "off" || !sql) {
    return undefined;
  }
  const oldest = await oldestRunDate(sql);
  const period = trailingDays(search.periodDays, now);
  if (!oldest || (mode === "auto" && oldest >= period.from)) {
    return undefined;
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
  return undefined;
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
