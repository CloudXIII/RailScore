import type { DarwinRun, StoredCall } from "./run";

/**
 * Finished days of one schedule UID, packed into one text per calendar month.
 * Each compaction appends one day as a chunk, so a month row is written without reading it:
 *
 *   P<crs>,<pta>,<ptd>;…      the planned calling pattern of the runs below it
 *   <dd>,<rid>,<toc>,<times>  one run: day of month, RID, operator, actual times
 *
 * A RID that starts with the run's date keeps only its tail. Times give each call's actual arrival and departure as minutes from the
 * planned time ("0", "3", "-1"), one call per space, "a/d" when the two differ, "" when there
 * is none, "=HHMM" when there is no planned time to count from, and a trailing "c" when the
 * call was cancelled. A RID appended again (a late update) replaces the earlier copy.
 * Decoding gives back exactly the stored runs.
 */
export function encodeMonthChunk(runs: readonly DarwinRun[]): string {
  const lines: string[] = [];
  let current: string | undefined;
  for (const run of runs) {
    const pattern = run.calls
      .map((call) => [call.crs, call.pta ?? "", call.ptd ?? ""].join(","))
      .join(";");
    if (pattern !== current) {
      lines.push(`P${pattern}`);
      current = pattern;
    }
    const datePrefix = run.serviceDate.replaceAll("-", "");
    const rid = run.rid.startsWith(datePrefix)
      ? run.rid.slice(datePrefix.length)
      : `!${run.rid}`;
    const times = run.calls
      .map((call) => {
        const arrival = timeText(call.pta, call.ata);
        const departure = timeText(call.ptd, call.atd);
        return (
          (arrival === departure ? arrival : `${arrival}/${departure}`) +
          (call.cancelled ? "c" : "")
        );
      })
      .join(" ");
    lines.push([run.serviceDate.slice(8), rid, run.toc, times].join(","));
  }
  return lines.join("\n");
}

/** The runs of one month row, oldest day first. `month` is the row's first day, YYYY-MM-01. */
export function decodeMonth(
  month: string,
  uid: string,
  text: string,
): DarwinRun[] {
  const byRid = new Map<string, DarwinRun>();
  let pattern: string[][] = [];
  for (const line of text.split("\n")) {
    if (line.startsWith("P")) {
      pattern = line
        .slice(1)
        .split(";")
        .map((call) => call.split(","));
      continue;
    }
    if (!line) {
      continue;
    }
    const [day = "", rid = "", toc = "", times = ""] = line.split(",");
    const serviceDate = `${month.slice(0, 8)}${day}`;
    const parts = times.split(" ");
    const calls = pattern.map(
      ([crs = "", pta = "", ptd = ""], index): StoredCall => {
        let part = parts[index] ?? "";
        const cancelled = part.endsWith("c");
        if (cancelled) {
          part = part.slice(0, -1);
        }
        const [arrival = "", departure = arrival] = part.split("/");
        const ata = actualOf(pta, arrival);
        const atd = actualOf(ptd, departure);
        return {
          crs,
          ...(pta ? { pta } : {}),
          ...(ptd ? { ptd } : {}),
          ...(ata ? { ata } : {}),
          ...(atd ? { atd } : {}),
          ...(cancelled ? { cancelled: true } : {}),
        };
      },
    );
    const run: DarwinRun = {
      rid: rid.startsWith("!")
        ? rid.slice(1)
        : serviceDate.replaceAll("-", "") + rid,
      serviceDate,
      uid,
      toc,
      calls,
    };
    byRid.delete(run.rid);
    byRid.set(run.rid, run);
  }
  return [...byRid.values()].sort(
    (left, right) =>
      left.serviceDate.localeCompare(right.serviceDate) ||
      left.rid.localeCompare(right.rid),
  );
}

/** First day of the month a date falls in. */
export function monthOf(isoDate: string): string {
  return `${isoDate.slice(0, 7)}-01`;
}

function timeText(planned: string | undefined, actual: string | undefined) {
  if (!actual) {
    return "";
  }
  if (!planned) {
    return `=${actual}`;
  }
  let minutes = clock(actual) - clock(planned);
  if (minutes >= 720) {
    minutes -= 1440;
  } else if (minutes < -720) {
    minutes += 1440;
  }
  return String(minutes);
}

function actualOf(planned: string, text: string): string {
  if (!text) {
    return "";
  }
  if (text.startsWith("=")) {
    return text.slice(1);
  }
  const minutes = (((clock(planned) + Number(text)) % 1440) + 1440) % 1440;
  return (
    String(Math.floor(minutes / 60)).padStart(2, "0") +
    String(minutes % 60).padStart(2, "0")
  );
}

function clock(hhmm: string): number {
  return Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(2, 4));
}
