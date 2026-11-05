# Architecture

How RailScore is put together. How to install, run and deploy it is in the [README](../README.md); the counting rules are in [data rules](data-rules.md); the reasons behind the main choices are in the [decision records](adr/).

## Layers

```text
packages/core/src/          run classification, punctuality tallies and figures, London dates
apps/web/app/               home page (renders the search use case), /api/import/darwin and /api/backlog
apps/web/features/          the page's components and their pure helpers: search, list, result, day grid
apps/web/shared/            types and pure helpers both sides use: listed trains, stations, the search
                            query, day types, the /api/backlog contract
apps/web/server/use-cases/  what a page asks for, as a view model: searching trains
apps/web/server/            the train source port (Darwin or sample), search periods, call text,
                            maintenance, the station feed and directory, environment
apps/web/server/darwin/     Push Port parsing, run merge, run store, month packing, import state, import
apps/web/server/hsp/        HSP for the days before Darwin: list counts, matching, runs, store
apps/web/server/mock/       sample trains for RAILSCORE_DATA=mock
apps/web/server/services/   train folding for the lists
apps/web/db/schema.sql      tables for Darwin runs, the import state and HSP's answers
apps/web/scripts/           database migrate, one-off data fixes, TIPLOC to CRS map
```

Dependencies point one way:

```text
features/      ──► shared/, packages/core
shared/        ──► packages/core
use cases      ──► packages/core, the TrainSource port (server/train-source.ts)
darwin/, hsp/  ──► packages/core, shared/, server/ helpers (periods, call text)
packages/core  ──► nothing
```

- `packages/core` has no framework, database or app import. It holds the rules: `classifyRun` and `passengerLeg` (`run-outcome.ts`), `calculateReliability` (`reliability.ts`), `PunctualityTally` and `sumTallies` (`tally.ts`), and the London calendar.
- `features/` and `shared/` run in the browser too, so they never import `server/`. ESLint enforces this (`no-restricted-imports` in `eslint.config.mjs`), and also that `packages/core` imports neither the app nor a framework.
- The use case `server/use-cases/search-trains.ts` reads trains through the `TrainSource` port. `server/train-source.ts` picks the Darwin source or the sample one once, from `RAILSCORE_DATA`.
- Darwin and HSP do not import each other. What both need sits in `server/`: search periods (`periods.ts`), the call text (`call-text.ts`) and maintenance (`maintenance.ts`).
- The page and `/api/backlog` exchange the types in `shared/contracts.ts`.

## Darwin import

`/api/import/darwin` reads the Darwin Push Port messages since the last import and stores each run (RID) in `darwin_runs`, with its public calls, actual times and platforms, and Darwin's late and cancellation reason codes. The app does not show platforms or reasons yet; they are kept because Darwin's history cannot be fetched later. A platform Darwin marks as suppressed from public display is not stored. A calculation reads a train's finished runs from there. A run with no finished Darwin record, such as one from before the import began, counts as no data.

Once a day, after 05:10 UTC, the import also reads the 05:00 snapshot. Darwin loads the day's schedules between 02:00 and 04:00, so that snapshot holds about nine in ten of the day's passenger trains; trains added later in the day come through Kafka. A search then starts from the timetable: the trains of today (or, for another day type, of its latest day) between the two stations, then each train's runs in the period by schedule UID. That is two database reads. A train that ran in the period but is not in that timetable is shown as no longer running. Darwin counts from `DARWIN_FIRST_DAY`; the days of the period before it are HSP's.

Kafka keeps about an hour of messages, so a scheduler calls the route every 15 minutes ([ADR 0003](adr/0003-cron-job-org-every-15-minutes.md)). The route answers `202` at once and imports after the response, within the function's 300 seconds. The result is in the deployment's log under `[darwin-import]`. `?wait=1` imports first and answers with the result, for a run by hand.

Offsets are committed only after the runs are written. A second import that starts while one is running finds the lease taken (`darwin_import_state`) and stops. When Kafka dropped messages before an import read them, later imports fill those hours from the hourly snapshot files, which are kept for 2 to 3 days. A snapshot holds a run until about 30 minutes after it arrives, so a filled hour can miss some arrivals. Runs older than `DARWIN_KEEP_DAYS` are deleted. After each import the route runs the maintenance step, which also deletes old HSP list answers.

Never run the import from a development machine that shares the production Kafka consumer group (`DARWIN_KAFKA_GROUP`): its offsets would move on, and production would miss those messages.

## Month packing

A day stays one row per run for a week (`OPEN_DAYS` in `server/darwin/store.ts`), so a search can start from the latest day of any day type. After that the import packs it into `darwin_months`: one row per schedule UID and calendar month, appended one day at a time, so a month row is written without being read. Each day is appended and taken out of `darwin_runs` in one transaction, so a run is never in both places or in neither. Messages for a day that is already packed are dropped.

Each run keeps its RID, date, operator, reason codes and every call with its platform. The planned calling pattern is written once per day and the actual times as minutes from it; Postgres compresses the rest (`toast_tuple_target = 128`). The format is described at the top of `server/darwin/month.ts`. Packing is lossless: decoding gives back exactly the stored runs. A simulation of 90 days of the whole network from a real day took about 60 MB packed, against about 970 MB as one row per run ([ADR 0002](adr/0002-month-packing-for-neon-free.md)).

### One-off data fixes

Runs stored before `mergeUpdate` matched a call by one public time can hold a repeated last stop. Until every database has been through `npm run db:fold-calls -w @railscore/web -- --write` (`apps/web/scripts/fold-repeated-calls.ts`), every read folds it (`withFoldedCalls` in `server/darwin/store.ts`). Without `--write` the script only counts the rows it would change; a second run changes nothing.

## Days before Darwin (HSP)

Until Darwin covers the whole period (30 days from about 4 December 2026, 90 days from about 2 February 2027), the page fills the days before `DARWIN_FIRST_DAY` from HSP ([ADR 0004](adr/0004-hsp-for-the-days-before-darwin.md)). The list and the history are first shown from Darwin; the page then reads `/api/backlog`, which answers one line of JSON per result as it arrives:

- **List figures.** One `serviceMetrics` call per quarter-hour the listed trains leave in (and per day type), for the dates from the start of the period to the day before Darwin, with tolerances of 5, 14, 29 and 999 minutes. HSP trains join the listed train with the same operator, origin, departure from the boarding station and destination (or the one listed train with the same operator, departure and destination), and their tallies are added to Darwin's. A row shows a placeholder until its quarter-hours are in.
- **Arrival history.** The figures come from those tallies at once: `calculateReliability` takes the Darwin runs and HSP's tallies together. The calendar then fills from `serviceDetails`, one run at a time, newest first. A run is stored in `hsp_backlog_runs` in the `darwin_runs` text form and classified by the same rules, with one difference described in [data rules](data-rules.md). Once every run is in, the figures come from the runs.
- **Storage.** List answers depend on the day the period starts, so they are deleted after two days by the maintenance step. Runs never change, so a second visit makes no HSP call; they age out with `DARWIN_KEEP_DAYS`. A run is about 0.6 KB.

If HSP is down or refuses after its retries, the trains keep Darwin's figures and the history says the earlier journeys could not be loaded.

### HSP pacing

At busy times HSP refuses a second call beside a list call, list or detail alike, so every server shares one slot in `hsp_slots`: one HSP call at a time ([ADR 0005](adr/0005-one-hsp-call-slot.md)). A list call holds it for its call, and a history holds it for its whole run of detail calls, asking a refused one again after 300 ms, then longer, up to 2 s. Two searches of the same quarter-hour share one call through a claim on its `hsp_metrics` row. Calls are counted once per answer in `hsp_usage`, against `HSP_DAILY_CALL_LIMIT`, a cap the project sets itself against abuse.

## Stations

Station names and CRS codes come from the Knowledgebase feed (`server/station-feed.ts`), cached in memory, and in `apps/web/.data/stations.json` when the process can write that file, for up to 24 hours. Only name and CRS are kept. The lookup the search form uses is in `shared/stations.ts`.

`apps/web/server/darwin/tiploc-crs.json` maps Darwin's TIPLOCs to CRS codes. Rebuild it from a Darwin reference file (`PPTimetable_*_ref_v*.xml.gz`, from "Darwin Timetable Files") with `node apps/web/scripts/tiploc-crs.mjs <file>`.
