# 4. Ask HSP for the days before Darwin, until about February 2027

Accepted, 5 November 2026.

## Context

The Darwin import began on 4 November 2026 ([ADR 1](0001-darwin-import-instead-of-hsp-live-calls.md)). A 30-, 60- or 90-day period would show only the days since then, so for months every period would be short.

## Decision

Show the page from Darwin first, then fill the days of the period before `DARWIN_FIRST_DAY` from HSP through `/api/earlier-days`: list counts from `serviceMetrics`, then the history train's runs from `serviceDetails`, one at a time. Store every answer (`hsp_metrics` for two days, `hsp_backlog_runs` until they age out), so a second visit makes no HSP call. HSP counts become `PunctualityTally`s and go through the same `calculateReliability` as Darwin's runs.

## Consequences

- The page is never held up by HSP, and a train keeps Darwin's figures if HSP is down or refuses.
- HSP is asked only while a period reaches before Darwin's first day. Sunset: 30-day periods stop asking from about 4 December 2026, 90-day periods from about 2 February 2027. After that HSP is no longer called, its rows age out, and the `hsp_*` tables, the `HSP_*` variables and `apps/web/server/hsp/` can be removed.
- At the 13 December 2026 timetable change some trains may no longer match their HSP rows, and keep Darwin's figures.
- One rule differs: HSP records a run with no actual time anywhere as cancelled, where Darwin only knows no movement was seen.
