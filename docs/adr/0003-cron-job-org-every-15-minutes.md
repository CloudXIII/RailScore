# 3. Call the import from cron-job.org every 15 minutes

Accepted, 3 November 2026.

## Context

Darwin's Kafka topic keeps only about an hour of messages, so the import must run several times an hour. The project runs on free tiers. Vercel Hobby crons run at most once a day. GitHub's scheduled workflows stop after 60 days without a commit. An always-on worker would need a paid host.

## Decision

[cron-job.org](https://cron-job.org) (free) calls `GET /api/import/darwin` every 15 minutes with `Authorization: Bearer <CRON_SECRET>`. cron-job.org closes the connection after 30 seconds, so the route answers `202` at once and imports after the response, within the function's 300 seconds.

## Consequences

- One missed call still leaves about 45 minutes of retention. When Kafka did drop messages, later imports fill those hours from the hourly snapshot files, kept for 2 to 3 days.
- cron-job.org shows success once the import has started, not once it has finished. The result is in the deployment's log under `[darwin-import]`, and failure notifications reach the owner by email.
- A lease in `darwin_import_state` stops two imports from overlapping.
- The route is closed unless `CRON_SECRET` is set.
