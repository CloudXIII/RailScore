import type { DayPattern } from "@/shared/day-type";
import type { ParsedQuery } from "@/shared/search-query";

/**
 * The train list for this search, without a chosen service. `days` opens another day type's
 * list, as the next night's when the trains after midnight go on past one page.
 */
export function listHref(
  query: Pick<ParsedQuery, "fromText" | "toText" | "time" | "days" | "period">,
  time = query.time,
  days: DayPattern = query.days,
): string {
  const params = new URLSearchParams({
    from: query.fromText,
    to: query.toText,
    time,
    days,
    period: String(query.period),
  });
  return `/?${params.toString()}`;
}
