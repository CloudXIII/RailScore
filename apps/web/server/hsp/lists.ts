import {
  DAY_TYPES,
  dayTypesOf,
  type DayPattern,
  type ServiceDay,
} from "@/shared/day-type";
import type { EarlierDaysTrain } from "@/shared/contracts";
import { quarterOf, quartersOf, type Quarter } from "./match";
import type { DateSpan } from "../periods";
import { hspStationCode } from "./stations";

/** The searched stations, as Darwin or HSP names them. */
export type RouteCodes = { readonly fromCrs: string; readonly toCrs: string };

/** One serviceMetrics call: a quarter-hour and day type between two stations as HSP names them. */
export type ListTask = {
  readonly quarter: Quarter;
  readonly day: ServiceDay;
  readonly stations: RouteCodes;
  /** Same stations, day type, quarter-hour and dates: the same answer for every search. */
  readonly key: string;
};

/**
 * The list calls the trains need, each once, by quarter-hour then day type. A train HSP
 * files under other station codes, as on the Elizabeth line, needs lists of its own. A train
 * counted on day types of its own, such as a Sunday train after midnight in a Saturday list,
 * is asked about on those instead of the searched `days`.
 */
export function listTasks(
  route: RouteCodes,
  trains: readonly EarlierDaysTrain[],
  days: readonly ServiceDay[],
  span: DateSpan,
): ListTask[] {
  const tasks = new Map<string, ListTask>();
  for (const quarter of quartersOf(trains)) {
    for (const day of DAY_TYPES) {
      for (const train of trains.filter(
        (each) => leavesIn(each, quarter) && (each.days ?? days).includes(day),
      )) {
        const stations = hspRoute(route, train);
        const key = [
          stations.fromCrs,
          stations.toCrs,
          day,
          quarter.fromTime,
          span.from,
          span.to,
        ].join("|");
        if (!tasks.has(key)) {
          tasks.set(key, { quarter, day, stations, key });
        }
      }
    }
  }
  return [...tasks.values()];
}

/** The lists that answer for one train: its quarter-hours, on its day types. */
export function tasksOf<T extends ListTask>(
  route: RouteCodes & { readonly days: DayPattern },
  train: EarlierDaysTrain,
  tasks: readonly T[],
): T[] {
  const stations = hspRoute(route, train);
  const days = train.days ?? dayTypesOf(route.days);
  return tasks.filter(
    (task) =>
      task.stations.fromCrs === stations.fromCrs &&
      task.stations.toCrs === stations.toCrs &&
      days.includes(task.day) &&
      leavesIn(train, task.quarter),
  );
}

function hspRoute(route: RouteCodes, train: EarlierDaysTrain): RouteCodes {
  return {
    fromCrs: hspStationCode(route.fromCrs, train.operatorCode),
    toCrs: hspStationCode(route.toCrs, train.operatorCode),
  };
}

function leavesIn(train: EarlierDaysTrain, quarter: Quarter): boolean {
  return train.legs.some(
    (leg) => quarterOf(leg.publicDeparture).fromTime === quarter.fromTime,
  );
}
