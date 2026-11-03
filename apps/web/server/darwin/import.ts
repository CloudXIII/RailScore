import "server-only";
import { Kafka, logLevel, type Consumer } from "kafkajs";
import { database } from "../db";
import { darwinKafka, darwinKeepDays } from "../env";
import { errorText } from "../error-text";
import { parsePushPort, type DarwinUpdate } from "./push-port";
import {
  snapshotHours,
  snapshotUpdates,
  SnapshotMissingError,
} from "./snapshot";
import {
  acquireImport,
  applyUpdates,
  deleteOldRuns,
  importState,
  noteGap,
  noteGapFilled,
  noteProgress,
  noteTimetable,
  packFinishedDays,
  releaseImport,
  timetableDate,
} from "./store";

/** Messages folded into one database write and offset commit. */
const FLUSH_MESSAGES = 5_000;
/** Snapshots are read only once Kafka is caught up, and only while this much budget remains. */
const SNAPSHOT_RESERVE_MS = 60_000;
/** Snapshot files are published a few minutes after the hour. */
const SNAPSHOT_DELAY_MS = 10 * 60_000;
/** Snapshot hour read for the day's timetable. */
const TIMETABLE_HOUR_UTC = 5;

export type ImportResult =
  | { status: "busy" }
  | {
      status: "done";
      messages: number;
      /** Run rows written. A run changed by several flushes counts once per flush. */
      runWrites: number;
      caughtUp: boolean;
      newestMessageAt?: string;
      /** UTC date whose timetable this import read from the morning snapshot. */
      timetableLoaded?: string;
      /** Kafka had dropped messages this import never read. */
      gapFound: boolean;
      snapshotHours: string[];
      runsDeleted: number;
      /** Days moved into month rows by this import. */
      daysPacked: string[];
      ms: number;
    };

/**
 * Reads the Darwin Push Port messages since the last import and folds them into `darwin_runs`.
 * Kafka keeps about an hour of messages, so a scheduler runs this every 15 to 30 minutes.
 * Offsets are committed only after the runs they changed are written.
 */
export async function importDarwin(budgetMs: number): Promise<ImportResult> {
  const sql = database();
  if (!sql) {
    throw new Error("The Darwin import needs DATABASE_URL.");
  }
  const started = Date.now();
  const deadline = started + budgetMs;
  if (!(await acquireImport(sql, budgetMs + 60_000))) {
    return { status: "busy" };
  }
  try {
    const before = await importState(sql);
    const kafka = await readKafka(deadline, async (updates, newestAt) => {
      const written = await applyUpdates(sql, updates);
      await noteProgress(sql, newestAt);
      return written;
    });
    if (kafka.gapFound && before.lastMessageAt && kafka.oldestAt) {
      await noteGap(sql, before.lastMessageAt, kafka.oldestAt);
    }
    const timetable = kafka.caughtUp
      ? await loadTimetable(deadline)
      : { runWrites: 0 };
    const filled = kafka.caughtUp
      ? await fillGap(deadline)
      : { hours: [], runWrites: 0 };
    const runsDeleted = await deleteOldRuns(sql, darwinKeepDays(), new Date());
    const daysPacked = await packFinishedDays(sql, new Date(), deadline);
    return {
      status: "done",
      messages: kafka.messages,
      runWrites: kafka.runWrites + timetable.runWrites + filled.runWrites,
      caughtUp: kafka.caughtUp,
      ...(timetable.date ? { timetableLoaded: timetable.date } : {}),
      ...(kafka.newestAt
        ? { newestMessageAt: kafka.newestAt.toISOString() }
        : {}),
      gapFound: kafka.gapFound,
      snapshotHours: filled.hours,
      runsDeleted,
      daysPacked,
      ms: Date.now() - started,
    };
  } finally {
    await releaseImport(sql);
  }
}

type KafkaRead = {
  messages: number;
  runWrites: number;
  caughtUp: boolean;
  gapFound: boolean;
  oldestAt?: Date;
  newestAt?: Date;
};

async function readKafka(
  deadline: number,
  flush: (
    updates: DarwinUpdate[],
    newestAt: Date | undefined,
  ) => Promise<number>,
): Promise<KafkaRead> {
  const config = darwinKafka();
  const kafka = new Kafka({
    clientId: "railscore-import",
    brokers: config.brokers,
    ssl: true,
    sasl: {
      mechanism: config.mechanism,
      username: config.username,
      password: config.password,
    },
    connectionTimeout: 10_000,
    logLevel: logLevel.ERROR,
  });

  const admin = kafka.admin();
  await admin.connect();
  let ends: Map<number, number>;
  let gapFound = false;
  try {
    const offsets = await admin.fetchTopicOffsets(config.topic);
    const [committed] = await admin.fetchOffsets({
      groupId: config.groupId,
      topics: [config.topic],
    });
    ends = new Map(
      offsets.map((offset) => [offset.partition, Number(offset.high)]),
    );
    for (const offset of offsets) {
      const done = Number(
        committed?.partitions.find((p) => p.partition === offset.partition)
          ?.offset ?? -1,
      );
      gapFound ||= done >= 0 && done < Number(offset.low);
      if (done >= Number(offset.high)) {
        ends.delete(offset.partition);
      }
    }
  } finally {
    await admin.disconnect();
  }
  const result: KafkaRead = {
    messages: 0,
    runWrites: 0,
    caughtUp: ends.size === 0,
    gapFound,
  };
  if (ends.size === 0) {
    return result;
  }

  const consumer = kafka.consumer({
    groupId: config.groupId,
    maxBytes: 20 * 1024 * 1024,
  });
  await consumer.connect();
  try {
    await consumer.subscribe({ topic: config.topic, fromBeginning: true });
    await consumeUntilCaughtUp(
      consumer,
      config.topic,
      ends,
      deadline,
      flush,
      result,
    );
  } finally {
    await consumer.disconnect();
  }
  return result;
}

/** Consumes until every partition reaches the end it had when the import started, or time runs out. */
function consumeUntilCaughtUp(
  consumer: Consumer,
  topic: string,
  ends: Map<number, number>,
  deadline: number,
  flush: (
    updates: DarwinUpdate[],
    newestAt: Date | undefined,
  ) => Promise<number>,
  result: KafkaRead,
): Promise<void> {
  let pending: DarwinUpdate[] = [];
  let pendingMessages = 0;
  let stopped = false;
  return new Promise<void>((resolve, reject) => {
    const stop = () => {
      stopped = true;
      clearTimeout(timer);
      resolve();
    };
    // A quiet partition delivers no batch, so the deadline also ends the wait.
    const timer = setTimeout(
      stop,
      Math.max(0, deadline - Date.now() - SNAPSHOT_RESERVE_MS / 2),
    );
    consumer
      .run({
        autoCommit: false,
        eachBatch: async ({ batch, heartbeat }) => {
          if (stopped) {
            return;
          }
          for (const message of batch.messages) {
            const at = new Date(Number(message.timestamp));
            result.oldestAt ??= at;
            if (!result.newestAt || at > result.newestAt) {
              result.newestAt = at;
            }
            pending.push(...parsePushPort(xmlOf(message.value)));
            pendingMessages += 1;
          }
          result.messages += batch.messages.length;
          const next = Number(batch.lastOffset()) + 1;
          const reached = next >= (ends.get(batch.partition) ?? 0);
          if (reached) {
            ends.delete(batch.partition);
          }
          const outOfTime = Date.now() > deadline - SNAPSHOT_RESERVE_MS;
          if (pendingMessages >= FLUSH_MESSAGES || reached || outOfTime) {
            result.runWrites += await flush(pending, result.newestAt);
            await consumer.commitOffsets([
              { topic, partition: batch.partition, offset: String(next) },
            ]);
            pending = [];
            pendingMessages = 0;
          }
          await heartbeat();
          if (ends.size === 0 || outOfTime) {
            result.caughtUp = ends.size === 0;
            stop();
          }
        },
      })
      .catch(reject);
  });
}

/** Message values are JSON with the Push Port XML in `bytes`. */
function xmlOf(value: Buffer | null): string {
  if (!value) {
    return "";
  }
  try {
    const wrapper = JSON.parse(value.toString("utf8")) as { bytes?: unknown };
    return typeof wrapper.bytes === "string" ? wrapper.bytes : "";
  } catch {
    return value.toString("utf8");
  }
}

/**
 * Once a day, reads the 05:00 UTC snapshot for the day's timetable. Darwin loads the day's
 * schedules between 02:00 and 04:00, so that snapshot holds about nine in ten of the day's
 * passenger trains. Trains added later in the day arrive through Kafka.
 */
async function loadTimetable(
  deadline: number,
): Promise<{ date?: string; runWrites: number }> {
  const sql = database()!;
  const hour = new Date();
  hour.setUTCHours(TIMETABLE_HOUR_UTC, 0, 0, 0);
  const date = hour.toISOString().slice(0, 10);
  if (
    Date.now() < hour.getTime() + SNAPSHOT_DELAY_MS ||
    Date.now() > deadline - SNAPSHOT_RESERVE_MS ||
    (await timetableDate(sql)) === date
  ) {
    return { runWrites: 0 };
  }
  try {
    const runWrites = await applyUpdates(sql, await snapshotUpdates(hour));
    await noteTimetable(sql, date);
    return { date, runWrites };
  } catch (error) {
    if (!(error instanceof SnapshotMissingError)) {
      console.error("The Darwin timetable could not be read", errorText(error));
    }
    return { runWrites: 0 };
  }
}

/** Reads snapshot hours for a gap Kafka left, oldest first, while the budget lasts. */
async function fillGap(
  deadline: number,
): Promise<{ hours: string[]; runWrites: number }> {
  const sql = database()!;
  const { gap } = await importState(sql);
  const filled = { hours: [] as string[], runWrites: 0 };
  if (!gap) {
    return filled;
  }
  const latest = Date.now() - SNAPSHOT_DELAY_MS;
  for (const hour of snapshotHours(gap.from, gap.to)) {
    if (
      hour.getTime() > latest ||
      Date.now() > deadline - SNAPSHOT_RESERVE_MS
    ) {
      break;
    }
    try {
      filled.runWrites += await applyUpdates(sql, await snapshotUpdates(hour));
      filled.hours.push(hour.toISOString());
    } catch (error) {
      if (!(error instanceof SnapshotMissingError)) {
        console.error("A Darwin snapshot could not be read", errorText(error));
        break;
      }
    }
    await noteGapFilled(sql, hour);
  }
  return filled;
}
