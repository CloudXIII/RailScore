# Open items

Checks and ideas that are not done yet. Remove a line when it is done or dropped.

- **Measure `darwin_months`** once a full month is packed (early December 2026) and compare with the estimate in ADR 2 (about 60 MB per 90 days, about 250 MB per year).
- **Delete the old Neon project `railscore`** (HSP version, kept for rollback to tag `v1-hsp`) once the Darwin version is settled. Needs the user's OK; also unlink any Vercel–Neon integration still pointing at it.
- **Calibrate the outage rule** at the next Darwin outage: the `[darwin-import]` log now has `actualMessages` and `lastActualAt`, and `[trust-backup]` the fill's agreement figures ([ADR 7](adr/0007-trust-backup-during-darwin-outages.md)).
- **Idea: choose a date (today/tomorrow)** instead of day type + period in the search.
