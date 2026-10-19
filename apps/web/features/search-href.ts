import type { ParsedQuery } from "@/server/query";

/** The train list for this search, without a chosen service. */
export function listHref(
  query: Pick<ParsedQuery, "fromText" | "toText" | "time" | "days" | "period">,
  time = query.time,
): string {
  const params = new URLSearchParams({
    from: query.fromText,
    to: query.toText,
    time,
    days: query.days,
    period: String(query.period),
  });
  return `/?${params.toString()}`;
}
