import "server-only";
import { gunzipSync, gzipSync } from "node:zlib";
import { londonIsoDate } from "@railscore/core";
import type { Sql } from "postgres";
import { decodeCalls } from "../call-text";
import type { ImportState } from "../darwin/import-state";
import {
  noteOutage,
  noteTrustCanary,
  noteTrustRead,
} from "../darwin/import-state";
import type { KnownRuns } from "../darwin/store";
import { nwrMovementsKafka } from "../env";
import { errorText } from "../error-text";
import {
  fillRefusals,
  fillRuns,
  NO_FILL,
  type FillStats,
  type FillWindow,
} from "./fill";
import { readTrust } from "./kafka";
import { crsOfStanox, matchTrains, type CandidateRun } from "./match";
import {
  latestMovements,
  type TrustActivation,
  type TrustMovement,
} from "./movements";
import { londonHour, nextOutage, outageHolds, type OutageStep } from "./outage";

/**
 * The TRUST backup the Darwin import runs after reading Kafka. While Darwin sends no actual
 * times (`nextOutage`), each import reads TRUST since the last read and stores it in
 * `trust_captures`. When the outage ends, the stored movements fill the actual times Darwin
 * lacks, if they agree with Darwin where both have one (`fillRefusals`); every changed run is
 * kept in `trust_fills` so the fill can be undone. Once a day, outside an outage, a few minutes
 * of TRUST are compared with the runs the import holds in memory, so the rarely used path is
 * known to work. See docs/adr/0007-trust-backup-during-darwin-outages.md.
 */

/** TRUST read before the outage began, to compare with Darwin. */
export const OVERLAP_MS = 15 * 60_000;
/** Most time a capture may take in one import. */
const CAPTURE_MS = 40_000;
/** Time a fill or the daily check needs left in the import's budget. */
const STEP_MS = 30_000;
/** Captures and fill records are kept this long: open days are packed into months after 15. */
const KEEP_DAYS = 14;
/** London hour from which the daily check runs. */
const CANARY_HOUR = 12;
/** TRUST minutes the daily check reads, ending this long ago. */
const CANARY_SPAN_MS = 10 * 60_000;
const CANARY_LAG_MS = 5 * 60_000;

export type TrustOutcome = {
  outage: OutageStep["event"];
  outageFrom?: string;
  captured?: {
    from: string;
    to?: string;
    movements: number;
    complete: boolean;
  };
  fill?: FillOutcome;
  canary?: FillStats & { trains: number; unknownStations: number };
  capturesExpired?: number;
  error?: string;
};

export type FillOutcome = {
  stats: FillStats;
  refusals: string[];
  /** Rows written; 0 when refused. */
  written: number;
  filledAt?: string;
};

export async function trustBackup(
  sql: Sql,
  before: ImportState,
  lastActualAt: Date | undefined,
  caughtUp: boolean,
  known: KnownRuns,
  deadline: number,
  now = new Date(),
): Promise<TrustOutcome> {
  const stored = before.outage.lastActualAt;
  const state = {
    ...before.outage,
    ...(lastActualAt && (!stored || lastActualAt > stored)
      ? { lastActualAt }
      : {}),
  };
  const step = nextOutage(state, now, caughtUp);
  const outcome: TrustOutcome = {
    outage: step.event,
    ...(step.state.outageFrom
      ? { outageFrom: step.state.outageFrom.toISOString() }
      : {}),
  };
  if (step.event !== "none") {
    await noteOutage(sql, step.state);
  }
  if (step.event === "started") {
    console.error(
      "[trust-backup] Darwin has sent no actual time since",
      step.state.outageFrom?.toISOString(),
    );
  } else if (step.event === "capped") {
    console.error(
      "[trust-backup] Outage closed after 8 hours with Darwin still quiet; filling what was read",
    );
  }

  try {
    const config = nwrMovementsKafka();
    if (!config) {
      return outcome;
    }
    const outageFrom = step.state.outageFrom;
    // The closing import, and any after it while a capture was cut short, still read TRUST.
    const capturing =
      outageFrom !== undefined &&
      Date.now() < deadline - STEP_MS &&
      (outageHolds(step.state) ||
        step.event === "ended" ||
        step.event === "capped" ||
        (step.state.closedAt !== undefined &&
          before.trustReadTo !== undefined &&
          before.trustReadTo < step.state.closedAt));
    // A new outage reads from its own start, whatever an earlier one left.
    let readTo = step.event === "started" ? undefined : before.trustReadTo;
    if (step.event === "started" && before.trustReadTo) {
      await noteTrustRead(sql, undefined);
    }
    let captureComplete = true;
    if (capturing) {
      const from = readTo ?? new Date(outageFrom.getTime() - OVERLAP_MS);
      const read = await readTrust(
        config,
        from,
        undefined,
        Math.min(deadline - STEP_MS, Date.now() + CAPTURE_MS),
      );
      if (
        !before.trustReadTo &&
        (!read.oldestAt ||
          read.oldestAt.getTime() - from.getTime() > 5 * 60_000)
      ) {
        console.error(
          "[trust-backup] Kafka had already dropped TRUST from",
          from.toISOString(),
          "to",
          read.oldestAt?.toISOString() ?? "now",
        );
      }
      readTo = read.newestAt ?? from;
      captureComplete = read.complete;
      await storeCapture(sql, outageFrom, from, readTo, read);
      await noteTrustRead(sql, readTo);
      outcome.captured = {
        from: from.toISOString(),
        ...(read.newestAt ? { to: read.newestAt.toISOString() } : {}),
        movements: read.movements.length,
        complete: read.complete,
      };
    }

    const closedAt = step.state.closedAt;
    // A capture cut short by its time cap is finished by the next import before the fill.
    if (
      outageFrom &&
      closedAt &&
      readTo &&
      captureComplete &&
      Date.now() < deadline - STEP_MS
    ) {
      // Tried once: a refused or failed fill stays in trust_captures for the script.
      await noteTrustRead(sql, undefined);
      readTo = undefined;
      outcome.fill = await fillOutage(
        sql,
        outageFrom,
        { from: outageFrom.getTime() - OVERLAP_MS, to: closedAt.getTime() },
        { known },
      );
      const log = outcome.fill.refusals.length ? console.error : console.info;
      log("[trust-backup] fill", JSON.stringify(outcome.fill));
    }

    if (
      step.event === "none" &&
      !readTo &&
      !outcome.fill &&
      caughtUp &&
      londonHour(now) >= CANARY_HOUR &&
      before.trustCanaryDate !== londonIsoDate(now) &&
      Date.now() < deadline - STEP_MS
    ) {
      outcome.canary = await canary(config, known, now, deadline - STEP_MS);
      await noteTrustCanary(sql, londonIsoDate(now));
      const { overlap, withinOneMinute } = outcome.canary;
      const log =
        overlap < 50 || withinOneMinute / overlap < 0.9
          ? console.error
          : console.info;
      log("[trust-canary]", JSON.stringify(outcome.canary));
    }

    const expired = await deleteExpired(sql);
    if (expired > 0) {
      outcome.capturesExpired = expired;
      console.error(
        `[trust-backup] ${expired} TRUST captures were never filled and are now deleted`,
      );
    }
  } catch (error) {
    outcome.error = errorText(error);
    console.error("[trust-backup] failed", outcome.error);
  }
  return outcome;
}

type Capture = {
  activations: TrustActivation[];
  movements: TrustMovement[];
};

async function storeCapture(
  sql: Sql,
  outageFrom: Date,
  from: Date,
  to: Date,
  read: Capture,
): Promise<void> {
  const data = gzipSync(
    JSON.stringify({
      activations: read.activations,
      movements: read.movements,
    } satisfies Capture),
  );
  await sql`
    insert into trust_captures (outage_from, read_from, read_to, movements, data)
    values (${outageFrom}, ${from}, ${to}, ${read.movements.length}, ${data})
  `;
}

/**
 * Fills the actual times Darwin lacks in the window from the outage's captures. Refused, and
 * nothing written, when `fillRefusals` finds a reason, unless `force` (the hand-run script).
 * `dryRun` measures only. A run is written only while its calls are still the text read.
 */
export async function fillOutage(
  sql: Sql,
  outageFrom: Date,
  window: FillWindow,
  options: { known?: KnownRuns; force?: boolean; dryRun?: boolean } = {},
): Promise<FillOutcome> {
  const captures = await sql<{ data: Buffer }[]>`
    select data from trust_captures where outage_from = ${outageFrom} order by id
  `;
  const activations: TrustActivation[] = [];
  const movements: TrustMovement[] = [];
  for (const { data } of captures) {
    const capture = JSON.parse(gunzipSync(data).toString("utf8")) as Capture;
    activations.push(...capture.activations);
    movements.push(...capture.movements);
  }
  const runs = await candidateRuns(sql, window);
  const byTrain = latestMovements(movements);
  const matched = matchTrains([...runs.values()], activations, byTrain);
  const { fills, stats } = fillRuns(runs, matched, byTrain, window);
  const refusals = fillRefusals(stats);
  if (options.dryRun || (refusals.length > 0 && !options.force)) {
    return { stats, refusals, written: 0 };
  }
  const filledAt = new Date();
  const written = await sql.begin(async (tx) => {
    const rows = await tx<{ rid: string }[]>`
      update darwin_runs d set calls = v.after, updated_at = now()
      from unnest(
        ${fills.map((fill) => fill.rid)}::text[],
        ${fills.map((fill) => fill.before)}::text[],
        ${fills.map((fill) => fill.after)}::text[]
      ) as v(rid, before, after)
      where d.rid = v.rid and d.calls = v.before
      returning d.rid
    `;
    const done = new Set(rows.map((row) => row.rid));
    const kept = fills.filter((fill) => done.has(fill.rid));
    await tx`
      insert into trust_fills (rid, filled_at, old_calls, new_calls)
      select rid, ${filledAt}, old_calls, new_calls
      from unnest(
        ${kept.map((fill) => fill.rid)}::text[],
        ${kept.map((fill) => fill.before)}::text[],
        ${kept.map((fill) => fill.after)}::text[]
      ) as v(rid, old_calls, new_calls)
    `;
    await tx`delete from trust_captures where outage_from = ${outageFrom}`;
    return kept;
  });
  for (const fill of written) {
    const run = options.known?.get(fill.rid);
    if (run) {
      options.known!.set(fill.rid, { ...run, calls: decodeCalls(fill.after) });
    }
  }
  return {
    stats,
    refusals,
    written: written.length,
    filledAt: filledAt.toISOString(),
  };
}

/**
 * Runs that may hold a call in the window: those of its London days, and of the day before when
 * the window starts in the early hours (a run crossing midnight), with a time in one of its
 * London hours. About a megabyte for a night's outage.
 */
async function candidateRuns(
  sql: Sql,
  window: FillWindow,
): Promise<Map<string, CandidateRun>> {
  const hours = new Set<string>();
  for (let at = window.from; at < window.to; at += 3_600_000) {
    hours.add(String(londonHour(new Date(at))).padStart(2, "0"));
  }
  hours.add(String(londonHour(new Date(window.to))).padStart(2, "0"));
  const firstDay = londonIsoDate(
    new Date(
      window.from - (londonHour(new Date(window.from)) < 6 ? 86_400_000 : 0),
    ),
  );
  const lastDay = londonIsoDate(new Date(window.to));
  const pattern = `,(${[...hours].join("|")})[0-9]{2},`;
  const rows = await sql<
    { rid: string; uid: string; service_date: string; calls: string }[]
  >`
    select rid, uid, service_date::text as service_date, calls
    from darwin_runs
    where service_date between ${firstDay}::date and ${lastDay}::date
      and calls ~ ${pattern}
  `;
  return new Map(
    rows.map((row) => [
      row.rid,
      {
        rid: row.rid,
        uid: row.uid,
        serviceDate: row.service_date,
        calls: decodeCalls(row.calls),
      },
    ]),
  );
}

/** Puts back the calls a fill replaced, where nothing has changed them since. */
export async function revertFill(sql: Sql, filledAt: Date): Promise<number> {
  return sql.begin(async (tx) => {
    const rows = await tx<{ rid: string }[]>`
      update darwin_runs d set calls = f.old_calls, updated_at = now()
      from trust_fills f
      where f.filled_at = ${filledAt} and d.rid = f.rid and d.calls = f.new_calls
      returning d.rid
    `;
    await tx`
      delete from trust_fills
      where filled_at = ${filledAt} and rid in ${tx(rows.length ? rows.map((row) => row.rid) : [""])}
    `;
    return rows.length;
  });
}

/** Compares a few minutes of TRUST with the runs this import holds. Reads nothing from Neon. */
async function canary(
  config: NonNullable<ReturnType<typeof nwrMovementsKafka>>,
  known: KnownRuns,
  now: Date,
  deadline: number,
): Promise<FillStats & { trains: number; unknownStations: number }> {
  const read = await readTrust(
    config,
    new Date(now.getTime() - CANARY_LAG_MS - CANARY_SPAN_MS),
    new Date(now.getTime() - CANARY_LAG_MS),
    Math.min(deadline, Date.now() + CAPTURE_MS),
  );
  const runs = new Map<string, CandidateRun>();
  for (const [rid, run] of known) {
    if (run) {
      runs.set(rid, run);
    }
  }
  const byTrain = latestMovements(read.movements);
  const matched = matchTrains([...runs.values()], read.activations, byTrain);
  const { stats } = fillRuns(runs, matched, byTrain, NO_FILL);
  const stanoxes = new Set(read.movements.map((movement) => movement.stanox));
  return {
    ...stats,
    trains: matched.size,
    unknownStations: [...stanoxes].filter((stanox) => !crsOfStanox(stanox))
      .length,
  };
}

/** Deletes captures and fill records past `KEEP_DAYS`. Returns how many captures went. */
async function deleteExpired(sql: Sql): Promise<number> {
  await sql`
    delete from trust_fills where filled_at < now() - ${KEEP_DAYS} * interval '1 day'
  `;
  const gone = await sql`
    delete from trust_captures where captured_at < now() - ${KEEP_DAYS} * interval '1 day'
  `;
  return gone.count;
}
