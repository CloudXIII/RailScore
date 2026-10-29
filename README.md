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
- Server-side integration with the Rail Data Marketplace HSP API, with results stored in Postgres so repeat searches don't call the API again.
- A request rate limit and a daily call cap shared across server instances, to stay within the provider's quotas.
- Long calculations are split into chunks and resumed across reloads, to fit serverless request time limits.

Built with AI-assisted development (Cursor).

## Data

Train performance is from [Historical Service Performance (HSP)](https://raildata.org.uk/dashboard/dataProduct/P-6fc218d1-a7f4-45b8-a863-a21cd6bb1902/overview) on the Rail Data Marketplace. Station names and CRS codes are from the [Knowledgebase Stations data feed](https://raildata.org.uk/dashboard/dataProduct/P-88ffe920-471c-4fd9-8e0d-95d5b9b7a257/overview). Both are listed there under the catalogue licence Open.

Credit the data publisher when showing this data. This project is not approved by, and is not affiliated with, the publisher or the Rail Data Marketplace.

Both feeds need your own marketplace credentials. None are included here.

## Install

Requires Node.js 22 or newer, and npm. The root `package.json` records that range.

```bash
npm install
```

Copy `.env.example` to `apps/web/.env.local` and replace the placeholders. Next.js and `npm run db:migrate` read that file. The example at the repository root is not loaded by itself. The server reads the variables in `apps/web/server/env.ts`. If a required one is missing, the error names it. `apps/web/.env.local` is ignored by Git. Do not commit it.

Every variable is server-only. Do not add a `NEXT_PUBLIC_` prefix.

| Variable                                            | Role                                                                                                                                                                                                       |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `HSP_BASE_URL`, `HSP_API_KEY`, `HSP_API_KEY_HEADER` | Historic Service Performance. Required. The key is sent in the header named by `HSP_API_KEY_HEADER`; the marketplace uses `x-apikey`.                                                                      |
| `STATIONS_BASE_URL`, `STATIONS_API_KEY`             | Station names and CRS codes. Required, including when `RAILSCORE_DATA=mock`. The server sends the key as `x-apikey`.                                                                                       |
| `DATABASE_URL`                                      | Optional Postgres. The running app should use a pooled URL. `npm run db:migrate` should use the direct URL. Without it, nothing is stored and the HSP rate limit covers this process only.                 |
| `HSP_MAX_REQUESTS_PER_SECOND`                       | Optional. Default 3. Shared by every process when `DATABASE_URL` is set.                                                                                                                                   |
| `HSP_LIST_WORKERS`                                  | Optional. List calls one search keeps in flight. Default 2.                                                                                                                                                |
| `HSP_LIST_SLOT_COUNT`                               | Optional. List calls in flight across every instance. Default 2. Needs a database row per slot (the schema inserts 1–12).                                                                                    |
| `HSP_LIST_START_GAP_MS`                             | Optional. Gap between list-call starts. Default 1500. `0` starts them together.                                                                                                                            |
| `HSP_DETAIL_CONCURRENCY`                            | Optional. Detail calls one calculation keeps in flight. Default 1.                                                                                                                                         |
| `HSP_SERIAL_AFTER_REFUSAL_MS`                       | Optional. After HSP refuses a list call beside another, that process uses one list call for this long. Default 180000. `0` keeps the worker count.                                                         |
| `DATABASE_POOL_MAX`                                 | Optional. Postgres connections in this process. Default 3.                                                                                                                                                 |
| `HSP_DAILY_CALL_LIMIT`                              | Optional. Default 5000 HSP calls per London day, only when `DATABASE_URL` is set. Without a database there is no daily cap. If the database is set and the counter cannot be reached, no HSP call is made. |
| `RAILSCORE_DATA`                                    | Leave unset for the live feed. `mock` serves made-up trains.                                                                                                                                               |
| `PORT`                                              | Optional. `npm run dev` uses 3000.                                                                                                                                                                         |
| `RAILSCORE_LOG_HSP`                                 | Optional. `1` logs each HSP call. Off by default.                                                                                                                                                          |

Create the tables when `DATABASE_URL` is set. Point that command at the direct URL, then point the running app at the pooled URL.

```bash
npm run db:migrate
```

## Use

```bash
npm run dev
```

Open <http://localhost:3000>. Choose two stations, a departing-after time, the days, and 30, 60, or 90 days. The defaults before a search are 06:30, weekdays, and 30 days. **Find trains** loads the list. Pick one service and press **Calculate reliability**.

Leave `RAILSCORE_DATA` unset for live trains. Set it to `mock` for made-up trains. The station list is still the live feed in both cases.

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

With more than one instance, memory is not shared. Postgres is what shares stored runs, stored service lists, the HSP rate limit, the list call slots, the calculation lock, and the daily call count.

A calculation calls HSP for one slice of about 10 seconds, then the page shows how many journeys are checked and reloads the same URL to continue. The host must allow a request of at least about 60 seconds, because finding the train list can take longer than that slice. The home route also sets Next.js `maxDuration` to 180 seconds. Hosts that do not read that Next.js option use their own request limit instead.

## Layout

```text
packages/core/src/     punctuality rules and London dates, no Next.js or database
apps/web/app/          home page and /api/reliability-progress
apps/web/features/     search, list, result, day grid
apps/web/server/       search, calculation, station list
apps/web/server/hsp/   HSP client, mapping, stored runs, rate limit, daily cap
apps/web/db/schema.sql tables for runs, service lists, the rate limit, the list call slots, the daily cap, and the calculation lock
apps/web/scripts/      database migrate
```

The home route sets `maxDuration` to 180 seconds. A service list starts no HSP call after 120 seconds; the page then reloads and carries on from the quarter-hours already stored. A refresh after the response starts no call after 130 seconds from the search's start. One calculation chunk stops after 10 seconds. The page then shows how many journeys are checked and reloads the same URL to fetch the next slice. While a slice runs, the browser polls `/api/reliability-progress` every 1.2 seconds. That progress map lives on the server instance doing the work.

Stored HSP details are one Postgres row per run id. Service lists are stored per quarter-hour, day type and period length, in Postgres and in this process (up to 5000 lists). Each list covers the whole period, because HSP takes as long for 7 days as for 90. A list up to 7 days behind the period is shown at once, and fetched again after the response is sent. A list older than that is fetched before the page shows. Station names are cached in memory, and in `apps/web/.data/stations.json` when the process can write that file, for up to 24 hours. Only name and CRS are kept.

## Rules in the code

A run at the passenger's stations is classified in `apps/web/server/hsp/map.ts`:

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

"All days" sends three HSP requests (`WEEKDAY`, `SATURDAY`, `SUNDAY`). Departing after a time covers that minute and the following 59. The period ends yesterday in `Europe/London`.

The list shows HSP's own count for each train: the share of runs that reached the destination within 5 minutes, and how many were cancelled or 30 or more minutes late. HSP counts a run with no actual time at the boarding stop as outside every tolerance, where the full calculation may still find its arrival, so the two can differ by a run.

The list folds two HSP groups into one train when they share the operator, each public time is within 2 minutes, the day types fit, and they never ran on the same date. The group with the most runs is the one shown.

## Known limits

With more than one instance, the progress line during the wait can stay still. The poll often reaches an instance that is not the one calling HSP. The count shown after each reload is the one that instance just computed. Stored runs are what let the next reload continue, and only when Postgres is configured.

Without `DATABASE_URL`, a reload can start the HSP work again, the daily cap is off, and the rate limit covers one process only.

The daily cap, when the database is configured, stops further HSP calls until the next London day. The visitor then sees "The daily limit for this demo has been reached. Try again tomorrow." Trains already stored still load. The default is 5000 calls. If that database is configured and the counter cannot be reached, no HSP call is made, and the visitor sees "The demo is temporarily unavailable. Try again later." There is no cap per visitor: one visitor can use the whole daily allowance.

A list call takes HSP about as long per clock minute whatever the period: a quarter-hour at Clapham Junction took 20 to 45 seconds, at Penzance about 5. HSP's gateway gives up after 55 seconds, so busy routes are asked for one quarter-hour at a time. With the defaults, two list calls run side by side across every instance, and a calculation makes one detail call at a time. When HSP refuses a second list call, the search carries on with one, and that process keeps to one for 3 minutes. A call refused on its own is asked again after a few seconds, until the search's time budget runs out. `HSP_LIST_WORKERS`, `HSP_LIST_SLOT_COUNT`, `HSP_LIST_START_GAP_MS`, `HSP_DETAIL_CONCURRENCY`, and `HSP_SERIAL_AFTER_REFUSAL_MS` raise that concurrency. Three HSP 5xx responses in a row stop further calls for 45 seconds.

## Assumptions

The code does not record an official HSP rate-limit document, the meaning of `late_canc_reason` values, whether HSP's weekday filter includes bank holidays, how long HSP waits before a day is complete, whether an RID is reused across timetable years, or a specification that the `HHMM` fields are `Europe/London`. The adapter treats those clock times as London civil times.

The signed data-sharing schedule was not available to read. The Data section records the public catalogue licence.

## Licence

[MIT](LICENSE).
