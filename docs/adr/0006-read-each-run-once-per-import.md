# 6. Read each run once per import, and leave the interval to the deployment

Accepted, 22 November 2026. Changes the interval of [ADR 3](0003-cron-job-org-every-15-minutes.md).

## Context

Neon Free allows 5 GB a month of public network transfer, bytes sent from the database to its clients, and 100 CU-hours of compute per project. Writes are free. In November 2026 the project used all its transfer in about three weeks with almost no visitors. Hourly consumption showed about 8 MB an hour in the day, 14 MB at midnight and about 140 MB a day, almost all of it the Darwin import:

- Kafka carries about 97,000 messages an hour. An import every 15 minutes folds them in flushes of 5,000 messages, and each flush read back every run it touched, so a train in motion was read about five times per import, about 2 MB per import.
- Packing a finished day reads the whole day once a night (about 9 MB), and the morning timetable reads back most of the day's runs (about 5 MB).

Compute follows the number of imports more than their work: the database stays up about 5 minutes after each import before it scales to zero. At night an import every 15 minutes kept it up about 22 minutes an hour, about 3 CU-hours a day, close to the Free allowance over a month.

Kafka keeps only about 1 to 1.5 hours of messages, so the import cannot run hourly.

## Decision

- An import keeps the runs it has read or written in memory (`KnownRuns` in `server/darwin/store.ts`) and reads a run from Neon at most once. While it holds its lease nothing else writes `darwin_runs`, so the copy in memory is the stored run.
- How often the scheduler calls the import is the deployment's choice, from every 15 to every 30 minutes. Estimates at today's traffic, before visitors:

| Interval   | Reads of a moving train an hour | Compute a month | Transfer a month | Retention left after one missed call |
| ---------- | ------------------------------- | --------------- | ---------------- | ------------------------------------ |
| 15 minutes | 4                               | ~90 CU-hours    | ~2 GB            | ~30–60 minutes                       |
| 20 minutes | 3                               | ~70 CU-hours    | ~1.8 GB          | ~20–50 minutes                       |
| 30 minutes | 2                               | ~50 CU-hours    | ~1.5 GB          | ~0–30 minutes                        |

## Consequences

- A shorter interval keeps today's runs fresher and leaves more of Kafka's retention for a missed call; a longer one uses less of Neon's allowances. On Neon Free, 15 minutes leaves little compute to spare.
- Messages Kafka drops are filled from the hourly snapshot files, kept for 2 to 3 days.
- Measure transfer and compute again after a change to the import or the interval.
- An import holds every run it reads in memory: about 25,000 runs, some tens of MB, on the morning of a timetable load.
