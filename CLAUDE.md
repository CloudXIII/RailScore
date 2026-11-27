# RailScore — guide for Claude

RailScore shows how a direct UK train has performed on its recent runs: arrivals within 5 minutes, cancellations, a delay distribution. Live at https://rail-score.vercel.app. Portfolio project that must run on free tiers only (Vercel Hobby, Neon Free, cron-job.org): no paid or card-backed services. The user is technical but not an expert developer: **talk to them in Italian, in simple terms, and give a recommendation with its trade-offs**.

## Inviolable rules

1. **Never run the Darwin import locally** (`/api/import/darwin`, `?wait=1`, any script that reads Kafka) with the production `DARWIN_KAFKA_GROUP`: offsets are committed to that shared consumer group, so production would never see those messages.
2. **Never run `npm run build` while `next dev` runs in the same folder**: it overwrites `apps/web/.next` and breaks the dev server (recover: stop dev, delete `apps/web/.next`). Build with dev stopped or in another worktree.
3. **Production is off-limits without the user's explicit OK in chat, per action**: the Neon project RailScore-Production (its default branch), Vercel (env vars, deployments, settings), cron-job.org jobs. The Neon MCP in `.mcp.json` has write access: use it for reads on the `development` branch only; any write, reset or delete, and anything on production, needs an OK first. Neon Free has a 5 GB/month transfer cap: no big reads for curiosity.
4. **After a merged PR that changes `apps/web/db/schema.sql`**, production needs `npm run db:migrate`: remind the user, run it only with their OK. Before any `db:migrate`, check which `DATABASE_URL` is in effect (a shell variable beats `.env.local`).
5. **No secrets in git**: `.env.local`, API keys, `CRON_SECRET`, connection strings. `.env.example` lists names only. `backup/` never goes in a commit.
6. **Free tiers only**: a change to the import or to read paths says what it costs in Neon transfer, storage (1 GB) and compute.

## Stack

TypeScript (strict), npm workspaces, Node 26.x (pinned in `engines`; CI and Vercel use 26). Next.js 15 App Router + React 19, CSS Modules. Neon Postgres through `postgres` (postgres.js). Darwin Push Port via `kafkajs` + hourly snapshot files; HSP for the days before Darwin. Vitest, ESLint, Prettier, knip. Vercel (functions in London), GitHub Actions CI.

## Structure

```
packages/core/src/  framework-free domain, no I/O: reliability, run outcome, tally,
                    analysis period, London civil time. Every rule here has a test.
apps/web/
  app/              Next.js page and API routes (api/import/darwin = cron, api/earlier-days)
  features/         UI components with their *.module.css, formatting (format.ts)
  shared/           types and helpers used by client and server (contracts, day type, stations)
  server/           server-only: env.ts (ALL config), db.ts, darwin/ (parser, runs, month
                    packing, store, import), hsp/ (days before Darwin), services/, use-cases/,
                    mock/, stations.json (station list shipped with the app)
  db/schema.sql     the tables; scripts/migrate.mjs applies it
  scripts/          migrate, refresh-stations, fold-repeated-calls, tiploc-crs
docs/               architecture.md, data-rules.md, adr/, open-items.md
```

## Docs (read only the one you need)

- `docs/architecture.md` — layers, Darwin import, month packing, HSP, stations.
- `docs/data-rules.md` — how a run is classified and counted, the search and the list, known limits.
- `docs/adr/` — one file per decision (import instead of live HSP, month packing, cron-job.org, HSP for earlier days, one HSP slot, read each run once per import). **Before changing an area, read its ADR.** A new decision goes into a new ADR (`000N-title.md`: Context / Decision / Consequences, "Accepted, <date>"); if it replaces an older one, add a pointer at the top of the old one. Not in this file.
- `docs/open-items.md` — open checks and ideas.
- `README.md` — usage, environment variables, deploy steps.

## How to work without filling the context

- Grep/Glob first, then read only the parts you need (`offset`/`limit`). Big files: `server/darwin/services.ts`, `server/services/fold.ts`, `server/hsp/earlier-days.ts`, `features/service-list.tsx` and their tests.
- One test file while working: `npx vitest run <path>` from the workspace folder (`apps/web` or `packages/core`). Full checks only at the end.
- Browser: the `web-test` entry in `.claude/launch.json` (local file, not in git; port 3100, clears stale `DATABASE_*`/`HSP_*` shell variables). Prefer `read_page`/`get_page_text` to screenshots.
- Workflow for a feature: discuss and plan with the user in plan mode; once approved, give mechanical, well-specified steps to the `implementer` subagent (`.claude/agents/`, Haiku) with the exact files and test; keep design decisions in the main session; finish with `/code-review` and the full checks.
- One branch per change, PR to `main`. Commit and push only when the user asks.

## Commands

```powershell
npm ci
npm run dev                      # web app on :3000 (never together with build)
npm test                         # all workspaces (Vitest)
npm run typecheck
npm run lint
npm run knip                     # unused files, exports, dependencies
npm run format:check             # CI fails on unformatted files; fix with npm run format
npm run build -w @railscore/web  # only with dev stopped
npm run db:migrate               # applies db/schema.sql to DATABASE_URL (dev branch only without OK)
npm run stations:refresh -w @railscore/web
```

Full checks = what CI runs: `format:check`, `lint`, `knip`, `typecheck`, `test`, build.

## Conventions

- Code, identifiers, comments, commits, PRs and docs in English; conversation with the user in Italian. Commit subject: one plain sentence about the behaviour ("Count a missed call at boarding only when the call shows it").
- Domain rules live in `packages/core` with tests. Server code imports `server-only` and never reaches client components. Config only through `server/env.ts`; every variable is server-only (no `NEXT_PUBLIC_`), and a new one goes in `.env.example` and the README table.
- `db/schema.sql` is applied whole every time: changes must be idempotent (`create … if not exists`, `alter … add column if not exists`).
- Tests never hit Kafka, HSP or the production DB. The one DB integration test is skipped without `DATABASE_URL`.

## UI rules

- UK market: British English copy only (no Italian), dd/mm/yyyy dates, Europe/London times.
- Direct trains only, and the UI says so. Three outcomes (on time = within 5 minutes, late, cancelled) plus "no data", which is never counted as cancelled.
- Choosing a train stays two steps: pick in the list, then "Show arrival history". Rows do not become links.
- Do not propose unprompted: saved searches, platforms, delay reasons, translations.
- Styles in a CSS Module beside the component; check every change at phone width (375 px) and in dark mode.
