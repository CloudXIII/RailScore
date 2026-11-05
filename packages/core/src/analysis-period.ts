const LONDON = "Europe/London";

/** Trailing London calendar dates, ending on the last complete day. `length` includes that day. */
export function trailingDays(
  length: number,
  now: Date,
): { from: string; to: string } {
  const today = londonIsoDate(now);
  const to = addCalendarDays(today, -1);
  const from = addCalendarDays(to, -(length - 1));
  return { from, to };
}

export function londonIsoDate(now: Date): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: LONDON,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  if (!year || !month || !day) {
    throw new Error("Could not read the London calendar date.");
  }
  return `${year}-${month}-${day}`;
}

export function addCalendarDays(isoDate: string, days: number): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!match) {
    throw new Error(`Expected a YYYY-MM-DD date, received "${isoDate}".`);
  }
  const utc = new Date(
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])),
  );
  utc.setUTCDate(utc.getUTCDate() + days);
  return utc.toISOString().slice(0, 10);
}

/**
 * The service date a Darwin RID starts with (`YYYYMMDD…`), as `YYYY-MM-DD`.
 * Undefined when the RID does not start with eight digits.
 */
export function dateOfRid(rid: string): string | undefined {
  const match = /^(\d{4})(\d{2})(\d{2})/.exec(rid);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : undefined;
}
