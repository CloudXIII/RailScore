import type { ServiceDay } from "../day-type";
import {
  quarterOf,
  quartersOf,
  type BacklogTrain,
  type Quarter,
} from "./match";
import type { DateSpan } from "./period";
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
 * files under other station codes, as on the Elizabeth line, needs lists of its own.
 */
export function listTasks(
  route: RouteCodes,
  trains: readonly BacklogTrain[],
  days: readonly ServiceDay[],
  span: DateSpan,
): ListTask[] {
  const tasks = new Map<string, ListTask>();
  for (const quarter of quartersOf(trains)) {
    for (const day of days) {
      for (const train of trains.filter((each) => leavesIn(each, quarter))) {
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

/** The lists that answer for one train. */
export function tasksOf<T extends ListTask>(
  route: RouteCodes,
  train: BacklogTrain,
  tasks: readonly T[],
): T[] {
  const stations = hspRoute(route, train);
  return tasks.filter(
    (task) =>
      task.stations.fromCrs === stations.fromCrs &&
      task.stations.toCrs === stations.toCrs &&
      leavesIn(train, task.quarter),
  );
}

function hspRoute(route: RouteCodes, train: BacklogTrain): RouteCodes {
  return {
    fromCrs: hspStationCode(route.fromCrs, train.operatorCode),
    toCrs: hspStationCode(route.toCrs, train.operatorCode),
  };
}

function leavesIn(train: BacklogTrain, quarter: Quarter): boolean {
  return train.legs.some(
    (leg) => quarterOf(leg.publicDeparture).fromTime === quarter.fromTime,
  );
}
