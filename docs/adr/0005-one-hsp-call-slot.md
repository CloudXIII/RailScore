# 5. Share one HSP call slot across every server

Accepted, 5 November 2026.

## Context

At busy times HSP refuses a second call beside a list call, list or detail alike, and a third list call in flight is always refused. Refusals come back in about 0.1 s; asking again after about 300 ms works, while an immediate retry fails. Serverless functions share no memory, so a limit kept in one process does not hold across visitors.

## Decision

Every server takes the one slot in `hsp_slots` (Postgres) before calling HSP: one HSP call at a time. A list call holds it for its call; a history holds it for its whole run of detail calls, asking a refused call again after 300 ms, then longer, up to 2 s. Two searches of the same quarter-hour share one call through a claim on its `hsp_metrics` row. Calls are counted once per answer in `hsp_usage` against `HSP_DAILY_CALL_LIMIT`, a cap the project sets itself against abuse; HSP publishes no quota.

## Consequences

- HSP sees at most one call at a time from RailScore, which is what it accepts at busy times.
- Visitors wait for each other at busy times; the page shows a placeholder meanwhile. This lasts only until HSP is no longer needed ([ADR 4](0004-hsp-for-the-days-before-darwin.md)).
- A slot held by a crashed function is renewed by its holder while it works and expires otherwise.
