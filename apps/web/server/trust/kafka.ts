import "server-only";
import { Kafka, logLevel } from "kafkajs";
import type { DarwinKafka } from "../env";
import {
  parseTrustMessage,
  type TrustActivation,
  type TrustMovement,
} from "./movements";

export type TrustRead = {
  activations: TrustActivation[];
  movements: TrustMovement[];
  /** Kafka messages read (each holds about 25 TRUST messages). */
  messages: number;
  /** Oldest and newest Kafka message read. */
  oldestAt?: Date;
  newestAt?: Date;
  /** Every partition was read to the end it had, or to `to`. */
  complete: boolean;
};

/**
 * Reads the TRUST messages Kafka timestamped from `from` up to `to` (or to the end the topic
 * had when the read began). Offsets are never committed: the consumer group only lets kafkajs
 * fetch. Kafka kept TRUST for 80 minutes to 4 hours in November 2026, so an older `from` starts
 * at the oldest message kept. Stops at `deadline` with what it has.
 */
export async function readTrust(
  config: DarwinKafka,
  from: Date,
  to: Date | undefined,
  deadline: number,
): Promise<TrustRead> {
  const kafka = new Kafka({
    clientId: "railscore-trust",
    brokers: config.brokers,
    ssl: true,
    sasl: {
      mechanism: "plain",
      username: config.username,
      password: config.password,
    },
    connectionTimeout: 10_000,
    logLevel: logLevel.ERROR,
  });
  const result: TrustRead = {
    activations: [],
    movements: [],
    messages: 0,
    complete: false,
  };

  const admin = kafka.admin();
  await admin.connect();
  const todo = new Map<number, { start: number; end: number }>();
  try {
    const starts = await admin.fetchTopicOffsetsByTimestamp(
      config.topic,
      from.getTime(),
    );
    const ends = await admin.fetchTopicOffsets(config.topic);
    for (const { partition, offset } of starts) {
      const end = Number(
        ends.find((e) => e.partition === partition)?.high ?? -1,
      );
      const start = Number(offset) < 0 ? end : Number(offset);
      if (start < end) {
        todo.set(partition, { start, end });
      }
    }
  } finally {
    await admin.disconnect();
  }
  if (todo.size === 0) {
    result.complete = true;
    return result;
  }

  const until = to?.getTime() ?? Number.POSITIVE_INFINITY;
  const consumer = kafka.consumer({
    groupId: config.groupId,
    maxBytes: 20 * 1024 * 1024,
  });
  await consumer.connect();
  try {
    await consumer.subscribe({ topic: config.topic, fromBeginning: false });
    await new Promise<void>((resolve, reject) => {
      const left = new Set(todo.keys());
      let stopped = false;
      const stop = () => {
        stopped = true;
        clearTimeout(timer);
        resolve();
      };
      // A quiet partition delivers no batch, so the deadline also ends the wait.
      const timer = setTimeout(stop, Math.max(0, deadline - Date.now()));
      consumer
        .run({
          autoCommit: false,
          eachBatch: async ({ batch, heartbeat }) => {
            const range = todo.get(batch.partition);
            if (stopped || !range || !left.has(batch.partition)) {
              return;
            }
            for (const message of batch.messages) {
              const offset = Number(message.offset);
              const at = Number(message.timestamp);
              if (offset >= range.end || at > until) {
                left.delete(batch.partition);
                break;
              }
              if (at >= from.getTime()) {
                const read = parseTrustMessage(
                  message.value?.toString("utf8") ?? "",
                );
                result.activations.push(...read.activations);
                result.movements.push(...read.movements);
                result.messages += 1;
                const time = new Date(at);
                result.oldestAt ??= time;
                if (!result.newestAt || time > result.newestAt) {
                  result.newestAt = time;
                }
              }
              if (offset + 1 >= range.end) {
                left.delete(batch.partition);
              }
            }
            await heartbeat();
            if (left.size === 0) {
              result.complete = true;
              stop();
            } else if (Date.now() > deadline) {
              stop();
            }
          },
        })
        .catch(reject);
      for (const [partition, { start }] of todo) {
        consumer.seek({
          topic: config.topic,
          partition,
          offset: String(start),
        });
      }
    });
  } finally {
    await consumer.disconnect();
  }
  return result;
}
