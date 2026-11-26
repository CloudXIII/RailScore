# 7. Fill Darwin outages from TRUST

Accepted, 26 November 2026.

## Context

Darwin is the only source of actual times. Twice in November 2026 it stopped sending them for hours while its Kafka topic showed no gap: on 12 November from 22:00 to 03:00, and on 25 November from 23:10 to about 02:00, during maintenance announced for 22:00–23:59. The snapshot fill ([ADR 3](0003-cron-job-org-every-15-minutes.md)) only covers messages Kafka dropped, so it could not help: Darwin had sent nothing to drop. Runs of those hours count as no data.

Network Rail's Train Movements feed (TRUST, topic `TRAIN_MVT_ALL_TOC` on the Rail Data Marketplace's Kafka) kept running. On 25 November a capture by hand filled 1,467 runs with 19,380 actual times, and 1,426 runs got their destination arrival back. Measured that night:

- Where both have an actual time, TRUST agrees with Darwin to the minute 81% of the time and within a minute 98%. With both up they cover public times equally (Darwin 96.3%, TRUST 95.5%).
- Kafka kept TRUST for about 4 hours on 13 November and only about 80 minutes on 25 November.
- A TRUST train names no RID. An activation gives its schedule UID and start day; one that came before the capture is matched by station and public time, which put 748 of 761 test trains on the right run and none on a wrong one.

Making TRUST the main source was considered and rejected: it has no timetable or public calling points, so it would need the SCHEDULE and VSTP feeds and a rewrite of the import.

## Decision

Darwin stays the source. The Darwin import also runs a TRUST backup (`server/trust/`), with no new scheduler call:

- **Outage.** The import notes the newest Darwin message carrying an actual time. Between 05:00 and 01:00 London, 20 minutes without one, in an import that has caught up with Kafka, starts an outage. It ends once actual times have been back for 30 minutes, never between 01:00 and 05:00 (few trains run, so silence there says little), and after 8 hours at most.
- **Capture.** While an outage holds, each import reads TRUST since the last read, starting 15 minutes before the outage, without committing offsets, and stores the activations and public movements, gzipped, in `trust_captures`.
- **Fill.** When the outage ends, the import matches the movements to `darwin_runs` (activation, else two calls by station and public time on the day the train ID ends with) and fills the actual times Darwin lacks at calls whose public time falls in the outage. It never overwrites Darwin, never fills a cancelled call, and skips lateness outside −30 to +600 minutes. It writes nothing when fewer than 100 calls before the outage have both sources, when under 90% of those agree within a minute, or when more than 20,000 runs would change. Every changed run is kept with its old calls in `trust_fills` for 14 days, and `npm run db:trust-fill` can undo a fill or force one that was refused.
- **Stations.** TRUST names places by STANOX. `server/trust/stanox-crs.json` maps them to CRS codes from Network Rail's location file (CORPUS); it agreed with all 2,119 stations learned on 25 November.
- **Daily check.** Once a day, after 12:00 London and outside an outage, the import reads 10 minutes of TRUST and logs `[trust-canary]` with its agreement with the runs the import already holds, so the rarely used path is known to work.

## Consequences

- An outage like 25 November's is filled about 40 minutes after Darwin's actual times return, with no one involved. Each fill and refusal is logged under `[trust-backup]`.
- Darwin always wins: an actual time it sends later replaces TRUST's.
- Costs on the free plans, at most one outage a week: no extra database wake-ups, since the backup runs inside the import; on normal days no Neon reads at all (the state row was already read). A fill reads its captures (about 0.5 MB an hour of outage) and the candidate runs (1 to 3 MB) once, under 10 MB an outage against 5 GB a month. Captures take up to about 5 MB, deleted after the fill; the fill records about 2 MB, for 14 days. Vercel: 5 to 20 seconds more per import during an outage, about 5 seconds once a day for the check.
- Captures and fill records go after 14 days, before their days are packed into months (after 15), when a fill could no longer reach them.
- An outage shorter than 20 minutes, or in the night hours alone, is not filled.
- Without the `NWR_MOVEMENTS_KAFKA_*` variables the import still notes outages but reads no TRUST.
- The same pieces (reading, matching, filling) can later fill every gap Darwin leaves, not only outages.
