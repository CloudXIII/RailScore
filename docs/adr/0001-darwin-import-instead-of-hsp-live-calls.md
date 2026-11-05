# 1. Import Darwin instead of calling HSP live

Accepted, 3 November 2026.

## Context

The first version asked Historic Service Performance (HSP) for every search and calculation. HSP takes 10 to 50 seconds for a list call, longer at busy times, refuses a second call beside a list call, and has no published rate limit. Pages waited, and sometimes gave up.

## Decision

Read the Darwin Push Port feed (Kafka, plus its hourly snapshots) on a schedule and store every run in Postgres. A search and a calculation are then a few database reads, with no call to an outside API. The list starts from the day's Darwin timetable (the 05:00 UTC snapshot) and pools each train's past runs by schedule UID.

## Consequences

- Searches answer in well under a second, and the figures for every visitor come from the same stored runs.
- History starts on the first day the import saw whole (`DARWIN_FIRST_DAY`, 4 November 2026). Earlier days need HSP ([ADR 4](0004-hsp-for-the-days-before-darwin.md)).
- The import must run often enough for Kafka's short retention ([ADR 3](0003-cron-job-org-every-15-minutes.md)), and the stored runs must fit Neon Free ([ADR 2](0002-month-packing-for-neon-free.md)).
- If the import stops, the figures stop at the last day stored. Darwin's history cannot be fetched later, so platforms and reason codes are kept even though the page does not show them yet.
- A development machine must never run the import with the production consumer group.
