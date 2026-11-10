import { addCalendarDays, trailingDays } from "@railscore/core";

export type DateSpan = { readonly from: string; readonly to: string };

export type SearchPeriods = {
  /** Dates the figures cover. */
  readonly period: DateSpan;
  /** Days before Darwin that HSP fills. Absent once Darwin covers the whole period, or without HSP. */
  readonly hsp?: DateSpan;
};

/**
 * Longest period HSP fills. HSP asks one call per run, so a longer period would cost hundreds
 * of calls a train; 180 and 365 days count Darwin's days alone and fill up as it records them.
 */
const HSP_LONGEST_PERIOD = 90;

/**
 * Splits the last `periodDays` finished days between HSP and Darwin. Darwin counts from
 * `darwinFrom`; HSP covers the days before it, so the period is whole from the first search.
 * Once the period starts on or after `darwinFrom` HSP is no longer asked: from early December
 * for 30 days, from early February 2027 for 90. Without HSP, or for a period longer than
 * `HSP_LONGEST_PERIOD`, the period starts at `darwinFrom`, so the dates shown are the ones the
 * counts cover.
 */
export function searchPeriods(
  periodDays: number,
  now: Date,
  darwinFrom: string,
  hspAvailable: boolean,
): SearchPeriods {
  const trailing = trailingDays(periodDays, now);
  const before = addCalendarDays(darwinFrom, -1);
  const hsp =
    hspAvailable &&
    periodDays <= HSP_LONGEST_PERIOD &&
    trailing.from < darwinFrom
      ? { from: trailing.from, to: before < trailing.to ? before : trailing.to }
      : undefined;
  return {
    period: {
      from: hsp || trailing.from > darwinFrom ? trailing.from : darwinFrom,
      to: trailing.to,
    },
    ...(hsp ? { hsp } : {}),
  };
}

/** The later of two ISO dates. */
export function laterDate(left: string, right: string): string {
  return left > right ? left : right;
}
