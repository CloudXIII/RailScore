# 2. Pack finished days into month rows to fit Neon Free

Accepted, November 2026.

## Context

Neon Free gives 0.5 GB. One day of the whole network as one row per run is about 13 MB with its indexes, so 90 days would be about 970 MB. A station index (GIN) on the call text cost more than it saved and was dropped in favour of a per-day scan and a `(uid, service_date)` index.

## Decision

Keep the last week as one row per run (`darwin_runs`), so a search can start from the latest day of any day type and late messages can still change a run. Pack older days into `darwin_months`: one text row per schedule UID and calendar month, appended one day at a time without reading the row. The planned calling pattern is written once per day and the actual times as minutes from it; Postgres compresses the rest, with `toast_tuple_target` lowered so rows compress early in the month. The format is in `apps/web/server/darwin/month.ts`.

## Consequences

- A simulation of 90 days from a real day took about 60 MB packed. The whole store fits Neon Free with room for HSP's runs.
- Packing is lossless and tested: decoding gives back exactly the stored runs.
- A packed day no longer changes. A message for it is dropped, and a data fix has to rewrite the text (as `apps/web/scripts/fold-repeated-calls.ts` does).
- Reading a train's runs means decoding whole month rows of its UIDs, which is cheap at this size.
