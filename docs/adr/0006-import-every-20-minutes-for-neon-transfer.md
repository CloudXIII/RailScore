# 6. Import every 20 minutes and read each run once per import

Accepted, 22 November 2026. Changes the interval of [ADR 3](0003-cron-job-org-every-15-minutes.md).

## Context

Neon Free allows 5 GB a month of public network transfer: bytes sent from the database to its clients. Writes are free. In November 2026 the project used it all in about three weeks with almost no visitors. Hourly consumption showed about 8 MB an hour in the day, 14 MB at midnight and about 140 MB a day, almost all of it the Darwin import:

- Kafka carries about 97,000 messages an hour. An import every 15 minutes folds them in flushes of 5,000 messages, and each flush read back every run it touched, so a train in motion was read about five times per import, about 2 MB per import.
- Packing a finished day reads the whole day once a night (about 9 MB), and the morning timetable reads back most of the day's runs (about 5 MB).

Kafka keeps only about 1 to 1.5 hours of messages, so the import cannot run hourly.

## Decision

- An import keeps the runs it has read or written in memory (`KnownRuns` in `server/darwin/store.ts`) and reads a run from Neon at most once. While it holds its lease nothing else writes `darwin_runs`, so the copy in memory is the stored run.
- cron-job.org calls the import every 20 minutes instead of 15. A train in motion is then read about three times an hour instead of about twenty.

## Consequences

- Estimated transfer: about 50–65 MB a day, 1.5–2 GB a month, before visitors. Measure it again after a change to the import.
- Today's runs are up to 20 minutes old instead of 15.
- One missed call still leaves about 30 minutes of retention, less than before. Messages Kafka drops are still filled from the hourly snapshot files.
- An import holds every run it reads in memory: about 25,000 runs, some tens of MB, on the morning of a timetable load.
