# RailScore

**[Live demo](https://rail-score.vercel.app)**

RailScore shows how a direct UK train has performed on its recent runs: arrivals within 5 minutes, cancellations, and a delay distribution. It is not a journey planner. Journeys with a change are out of scope. There is no single score.

<table>
  <tr>
    <td valign="top">
      <img src="docs/search.png" alt="Search" width="230">
    </td>
    <td valign="top">
      <img src="docs/train-list.png" alt="Trains" width="312">
    </td>
    <td valign="top">
      <img src="docs/arrival-history.png" alt="Arrival history" width="302">
    </td>
    <td valign="top">
      <img src="docs/arrival-history-mobile.png" alt="Arrival history on a phone" width="56">
    </td>
  </tr>
</table>

**Stack:** TypeScript, Next.js, PostgreSQL (Neon), Vitest, deployed on Vercel.

**Highlights**

- Punctuality rules live in `packages/core`, a TypeScript package with no framework or database, covered by unit tests.
- A scheduled import of the Darwin Push Port feed (Kafka) into Postgres, so a search and a calculation are a few database reads with no call to an outside API. Days before the import began are filled from HSP after the page is shown, and stored.
- Train lists start from today's Darwin timetable and pool each train's past runs by schedule UID.
- Runs on free tiers only: Vercel Hobby, Neon Free (0.5 GB: 90 days of the whole network, packed into month rows), and cron-job.org.

Built with AI-assisted development (Cursor).

## Data

Train performance is from Darwin Real Time Train Information (the Push Port, read over Kafka, and its hourly snapshots) on the Rail Data Marketplace. Station names and CRS codes are from the [Knowledgebase Stations data feed](https://raildata.org.uk/dashboard/dataProduct/P-88ffe920-471c-4fd9-8e0d-95d5b9b7a257/overview).

Darwin history starts on the first day the import saw whole, 4 November 2026 (`DARWIN_FIRST_DAY`), and reaches back at most `DARWIN_KEEP_DAYS` (90). The days of a period before that come from [Historic Service Performance](https://raildata.org.uk) (HSP) on the Rail Data Marketplace, asked after the page is shown and stored (see [Days before Darwin](#days-before-darwin-hsp)). Without HSP, the list names the days it covers. If the import stops, no new runs arrive.

Credit the data publisher when showing this data. This project is not approved by, and is not affiliated with, the publisher or the Rail Data Marketplace.

Both feeds need your own marketplace credentials. None are included here.

## Install

Requires Node.js 22 or newer, and npm. The root `package.json` records that range.

```bash
npm install
```

Copy `.env.example` to `apps/web/.env.local` and replace the placeholders. Next.js and `npm run db:migrate` read that file. The example at the repository root is not loaded by itself. The server reads the variables in `apps/web/server/env.ts`. If a required one is missing, the error names it. `apps/web/.env.local` is ignored by Git. Do not commit it.

Every variable is server-only. Do not add a `NEXT_PUBLIC_` prefix.

| Variable                                              | Role                                                                                                                                                                                                             |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `STATIONS_BASE_URL`, `STATIONS_API_KEY`               | Station names and CRS codes. Required, including when `RAILSCORE_DATA=mock`. The server sends the key as `x-apikey`.                                                                                             |
| `DATABASE_URL`                                        | Postgres holding the Darwin runs. Required for live data; without it no train is listed. The running app should use a pooled URL. `npm run db:migrate` should use the direct URL.                                |
| `DATABASE_POOL_MAX`                                   | Optional. Postgres connections in this process. Default 3.                                                                                                                                                       |
| `RAILSCORE_DATA`                                      | Leave unset for the live feed. `mock` serves made-up trains.                                                                                                                                                     |
| `PORT`                                                | Optional. `npm run dev` uses 3000.                                                                                                                                                                               |
| `DARWIN_KAFKA_*`                                      | Darwin Push Port on Kafka, for the import below. Required for live data. Bootstrap, SASL mechanism, security protocol, topic, group, username and password, as the Rail Data Marketplace Pub/Sub tab shows them. |
| `DARWIN_SNAPSHOT_URL`, `DARWIN_SNAPSHOT_CONSUMER_KEY` | Hourly Darwin snapshots, read for each day's timetable and when Kafka dropped messages. Required for live data.                                                                                                  |
| `DARWIN_KEEP_DAYS`                                    | Optional. Days of Darwin runs kept. Default 90.                                                                                                                                                                  |
| `DARWIN_FIRST_DAY`                                    | Optional. First day the Darwin import saw whole, `YYYY-MM-DD`. Default `2026-11-04`. Earlier stored days are not counted.                                                                                        |
| `HSP_BASE_URL`, `HSP_API_KEY_HEADER`, `HSP_API_KEY`   | Optional. Historic Service Performance, for the days of a period before `DARWIN_FIRST_DAY`. Without them the period starts at that day.                                                                          |
| `HSP_DAILY_CALL_LIMIT`                                | Optional. HSP calls a day across every visitor. Default 5000. Past it the figures are Darwin's alone until midnight.                                                                                             |
| `CRON_SECRET`                                         | Optional. Turns on `/api/import/darwin`, which needs `Authorization: Bearer <CRON_SECRET>`.                                                                                                                      |

Create the tables when `DATABASE_URL` is set. Point that command at the direct URL, then point the running app at the pooled URL.

```bash
npm run db:migrate
```

## Use

```bash
npm run dev
```

Open <http://localhost:3000>. Choose two stations, a departing-after time, the days, and 30, 60, or 90 days. The defaults before a search are 06:30, weekdays, and 30 days. **Find trains** loads the list. Pick one service and press **Calculate reliability**.

Leave `RAILSCORE_DATA` unset for live trains from the stored Darwin runs. Set it to `mock` for made-up trains, with no database. The station list is still the live feed in both cases.

The same choices are the URL query: `from`, `to`, `time`, `days` (`weekdays`, `saturday`, `sunday`, `all`), `period` (`30`, `60`, `90`), `service`, and `calculate=1`.

```bash
npm test
npm run build -w @railscore/web
```

Formatting is `npm run format`. There is no `lint` script.

## Deployment

Any Node host, including a serverless one, can run the production build. Node.js 22 or newer.

From the repository root:

```bash
npm install
npm run build -w @railscore/web
```

`npm run build` is not defined at the repository root. It is defined in `apps/web`. From that directory, `npm run build` is the same Next.js build.

After the build, from the repository root:

```bash
npm start
```

That serves the production build. `PORT` overrides 3000. `npm run dev` is the development server, not this command.

Set the variables from the table above in the host's environment. They stay on the server. For Postgres, give the app the pooled URL and run `npm run db:migrate` once with the direct URL.

On a host whose filesystem is read-only, the station file under `apps/web/.data/` is not kept. The list stays in the memory of that process and is fetched again when the process is new.

Postgres holds every run, so instances share nothing else. A search and a calculation each finish in one request.

### Darwin import

`/api/import/darwin` reads the Darwin Push Port messages since the last import and stores each run (RID) in `darwin_runs`, with its public calls, actual times and platforms, and Darwin's late and cancellation reason codes. The app does not show platforms or reasons yet; they are kept because Darwin's history cannot be fetched later. A platform Darwin marks as suppressed from public display is not stored. A calculation reads a train's finished runs from there. A run with no finished Darwin record, such as one from before the import began, counts as no data.

Once a day, after 05:10 UTC, the import also reads the 05:00 snapshot. Darwin loads the day's schedules between 02:00 and 04:00, so that snapshot holds about nine in ten of the day's passenger trains; trains added later in the day come through Kafka. A search then starts from the timetable: the trains of today (or, for another day type, of its latest day) between the two stations, then each train's runs in the period by schedule UID. That is two database reads. A train that ran in the period but is not in that timetable is shown as no longer running. Darwin counts from `DARWIN_FIRST_DAY`; the days of the period before it are HSP's.

Kafka keeps about an hour of messages, so a scheduler calls the route every 15 minutes. Vercel Hobby crons run at most once a day, and GitHub's scheduled workflows stop after 60 days without a commit, so the deployment uses [cron-job.org](https://cron-job.org) (free):

1. Set `CRON_SECRET` (a long random string) and the `DARWIN_*` variables in the deployment, then redeploy.
2. On cron-job.org, create a job for `https://<deployment>/api/import/darwin`, every 15 minutes, method GET.
3. Under Advanced, add the header `Authorization` with the value `Bearer <CRON_SECRET>`.
4. Turn on failure notifications, so a run of failures reaches you by email.

cron-job.org closes the connection after 30 seconds. The route answers `202` at once and imports after the response, within the function's 300 seconds, so the job shows success when the import has started. The result is in the deployment's log under `[darwin-import]`. `?wait=1` imports first and answers with the result, for a run by hand.

Offsets are committed only after the runs are written. A second import that starts while one is running finds the lease taken and stops. When Kafka dropped messages before an import read them, later imports fill those hours from the hourly snapshot files, which are kept for 2 to 3 days. A snapshot holds a run until about 30 minutes after it arrives, so a filled hour can miss some arrivals. Runs older than `DARWIN_KEEP_DAYS` are deleted.

A day stays one row per run for a week, so a search can start from the latest day of any day type. After that the import packs it into `darwin_months`: one row per schedule UID and calendar month, appended one day at a time. Each run keeps its RID, date, operator, reason codes and every call with its platform; the planned calling pattern is written once per day and the actual times as minutes from it, and Postgres compresses the rest. Packing is lossless: decoding gives back exactly the stored runs. A simulation of 90 days of the whole network from a real day took about 60 MB packed, against about 970 MB as one row per run. Messages for a day that is already packed are dropped.

### Days before Darwin (HSP)

Until Darwin covers the whole period (30 days from about 4 December 2026, 90 days from about 2 February 2027), the page fills the days before 4 November from HSP. The list and the history are first shown from Darwin; the page then reads `/api/backlog`, which answers one line of JSON per result as it arrives:

- **List figures.** One `serviceMetrics` call per quarter-hour the listed trains leave in (and per day type), for the dates from the start of the period to 3 November, with tolerances of 5, 14, 29 and 999 minutes. HSP trains join the listed train with the same operator, origin, departure from the boarding station and destination (or the one listed train with the same operator, departure and destination), and their counts are added to Darwin's. A row shows a placeholder until its quarter-hours are in.
- **Arrival history.** The figures come from those counts at once. The calendar then fills from `serviceDetails`, one run at a time, newest first. A run is stored in `hsp_backlog_runs` in the `darwin_runs` text form and classified by the same rules, except that a run HSP recorded with no actual time anywhere is cancelled (for Darwin it only means no movement was seen). Once every run is in, the figures come from the runs.
- **Pacing.** HSP refuses a third call in flight, list or detail alike, so every server shares two slots in `hsp_slots`: a list call holds one for its call, a history holds one for its whole run of detail calls, retrying a refused one after about 300 ms. Two searches of the same quarter-hour share one call through a claim on its `hsp_metrics` row. Calls are counted once per answer in `hsp_usage`.
- **Storage.** List answers depend on the day the period starts, so they are deleted after two days by the Darwin import. Runs never change, so a second visit makes no HSP call; they age out with `DARWIN_KEEP_DAYS`. A run is about 0.6 KB.

If HSP is down or refuses after its retries, the trains keep Darwin's figures and the history says the earlier journeys could not be loaded.

`apps/web/server/darwin/tiploc-crs.json` maps Darwin's TIPLOCs to CRS codes. Rebuild it from a Darwin reference file (`PPTimetable_*_ref_v*.xml.gz`, from "Darwin Timetable Files") with `node apps/web/scripts/tiploc-crs.mjs <file>`.

## Layout

```text
packages/core/src/          punctuality rules and London dates, no Next.js or database
apps/web/app/               home page, /api/import/darwin and /api/backlog
apps/web/features/          search, list, result, day grid
apps/web/server/            search, calculation, station list
apps/web/server/darwin/     Push Port parsing, run merge, store, import, lists from runs
apps/web/server/hsp/        HSP for the days before Darwin: periods, list counts, matching, runs, store
apps/web/server/services/   train folding and run classification shared by lists and calculations
apps/web/db/schema.sql      tables for Darwin runs, the import state and HSP's answers
apps/web/scripts/           database migrate, TIPLOC to CRS map
```

Station names are cached in memory, and in `apps/web/.data/stations.json` when the process can write that file, for up to 24 hours. Only name and CRS are kept.

## Rules in the code

A run at the passenger's stations is classified in `apps/web/server/services/map.ts`. Darwin runs are read in the serviceDetails shape that file was first written for (HSP's), with a cancelled call carrying a reason:

- **Arrived**, if the destination has an actual arrival. If the boarding stop has no actual time and a `late_canc_reason`, the outcome is **did not call**.
- **Cancelled**, if the destination has no actual arrival, it has a reason code, and no calling point has an actual time.
- **Did not call**, if the destination has no actual arrival, it has a reason code, and some calling point has an actual time.
- **No data** otherwise. Those runs are left out of the percentages.

`packages/core` then counts, with no I/O:

- Within 5 minutes includes early arrivals. Cancelled and did-not-call runs count as not on time and in the cancellation figure. Both figures use that same total.
- Bands are within 5, 6–14, 15–29, 30 or more, and cancelled.
- The longest delay is the latest arrival that is more than 5 minutes late, with its date when known.
- Percentages are whole numbers. A non-zero count is not shown as 0%, and a count short of the total is not shown as 100%.
- Below 20 runs with a known outcome, the page warns and still shows the figures.
- There is no average and no composite score.

"All days" lists weekday, Saturday and Sunday trains together. Departing after a time covers that minute and the following 59. The period ends yesterday in `Europe/London`.

The list shows a count for each train from the same runs: the share that reached the destination within 5 minutes, and how many were cancelled or 30 or more minutes late.

The list folds two schedules into one train when they share the operator, each public time is within 2 minutes, the day types fit, and they never ran on the same date. The group with the most runs is the one shown.

## Known limits

Darwin history covers only the days the import has run, at most 90; HSP fills the days before it while a period reaches back that far. At the 13 December 2026 timetable change some trains may no longer match their HSP rows, and keep Darwin's figures. HSP is often slow at the UK peak and sometimes refuses most calls for a while. The last week (about 13 MB a day) and the packed days (well under 1 MB a day) fit in Neon Free (0.5 GB). If the import stops, the figures stop at the last day stored.

The 05:00 snapshot holds about nine in ten of the day's trains. A train added to the timetable later in the day appears once Kafka brings it.

## Assumptions

The code does not record a specification that Darwin's `HHMM` times are `Europe/London`, or whether an RID is reused across timetable years. It treats those clock times as London civil times.

The signed data-sharing schedule was not available to read. The Data section records the public catalogue licence.

## Licence

[MIT](LICENSE).
