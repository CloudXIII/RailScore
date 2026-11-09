# Data rules

How a run is classified and counted. The rules live in `packages/core`, with no I/O, and are covered by its unit tests. How the data gets there is in [architecture](architecture.md).

## Classifying a run

A run at the passenger's stations is classified in `packages/core/src/run-outcome.ts`, from its calls in one typed shape (`Call`). Darwin's runs and HSP's answers are each translated into it first. A call is flagged when Darwin cancelled it or HSP gave a reason code for it; HSP does not say whether a code is a late or a cancellation reason.

The destination is the first call there after boarding, preferring one with a public arrival, and boarding is the last departure from the boarding station before it. A train round the Kingston loop is read at its arrival back into Waterloo, and a train that passes Clapham Junction twice is boarded the second time. When Darwin repeated the destination call at the end of a run after a schedule change, the repeat with the same public arrival and an actual time is used.

- **Arrived**, if the destination has an actual arrival. If the boarding stop has a public departure and no actual departure (or, without a public departure, no actual time and a flag), the outcome is **did not call**.
- **Cancelled**, if the destination has no actual arrival and no call has an actual time.
- **Did not call**, if the destination has no actual arrival, it is flagged, and some call has an actual time.
- **No data** otherwise. Those runs are left out of the percentages.

Darwin and HSP differ in one case. A Darwin run with no movement seen at all is no data, since the import may not have seen it. HSP records a run with no actual time anywhere as cancelled, and RailScore follows it.

## Counting

`calculateReliability` (`packages/core/src/reliability.ts`) counts:

- Within 5 minutes includes early arrivals. Cancelled and did-not-call runs count as not on time and in the cancelled band. The share uses every run with a known outcome.
- Bands are within 5, 6–14, 15–29, 30 or more, and cancelled.
- Percentages are whole numbers. A non-zero count is not shown as 0%, and a count short of the total is not shown as 100%.
- There is no average and no composite score.

Runs known only by count come as a `PunctualityTally` (`packages/core/src/tally.ts`): runs, and those within 5, 14 and 29 minutes and arrived at all. Darwin's list counts and HSP's `serviceMetrics` counts are both tallies. `calculateReliability` takes tallies beside runs: they go into the totals and bands, never on the calendar. A band is never below zero, should a source send counts that do not nest.

Below 5 runs with a known outcome, the page says there are too few journeys, still shows the figures, and gives the on-time share no colour. 90% or more on time is good, 75% or more fair.

## The search and the list

"All days" lists weekday, Saturday and Sunday trains together. Departing after a time covers that minute and the following 59. The period ends yesterday in `Europe/London`, and Darwin counts only days from `DARWIN_FIRST_DAY`.

A day's list runs by the day a train leaves the boarding station, in clock order. Darwin files every run under its service date, the day it starts, so the list reads each run's public times from its first stop and moves a train whose boarding time has passed midnight to the end of the day (`crossesMidnight` in `server/darwin/services.ts`). Trains before 04:00 at the top of a list are the end of the night before, and say so ("Friday night, after midnight" on a Saturday).

When a list reaches the day's last train, it goes on after midnight: the day's own trains that board after midnight, then the trains the next night's list shows before 04:00, while there is room on the page. Saturday night runs into Sunday's list, Sunday night into the weekday list, and a weekday or "All days" night into a list of its own type (Friday night's trains after midnight are at the top of Saturday's). A train from the next night's list is counted as it is there, on that day type: the Sunday 00:02 in a Saturday list shows its Sunday journeys and is marked "Sundays", and HSP is asked about it on Sundays. When the night has more trains than the page holds, "Later trains" opens the next night's list. "No more direct trains" is only said when neither the rest of the day nor the night before 04:00 has one.

The list shows a figure for each train from the same rules: the share that reached the destination within 5 minutes, and how many were cancelled or 30 or more minutes late. A run with no actual departure at the boarding stop is outside every tolerance, as in the full calculation.

The list folds schedules into one train (`server/services/fold.ts`):

- Identical schedules are pooled across day types.
- A schedule joins the most-run one with the same operator, a departure within 2 minutes, a journey within 15 minutes of the same length, and no run on the same date. Each is compared with that anchor, never with another schedule folded in, so 10:19, 10:21 and 10:23 do not chain into one train.
- A schedule listed with no public arrival joins the one train with the same operator and a departure within 2 minutes.
- A train that runs only on day types another lacks, such as the Sunday 11:49 for a Monday-to-Saturday 11:43, joins it when it is the only such train within 10 minutes and the journey takes about the same time.
- A train with no run in the last 14 days of the period is set apart as no longer running, before the day-type fold, so it cannot absorb a train that still runs.

## Known limits

Darwin history covers only the days the import has run, at most 90; HSP fills the days before it while a period reaches back that far. At the 13 December 2026 timetable change some trains may no longer match their HSP rows, and keep Darwin's figures. HSP is often slow at the UK peak and sometimes refuses most calls for a while. The last week (about 13 MB a day) and the packed days (well under 1 MB a day) fit in Neon Free (0.5 GB). If the import stops, the figures stop at the last day stored.

The 05:00 snapshot holds about nine in ten of the day's trains. A train added to the timetable later in the day appears once Kafka brings it.

## Assumptions

The code does not record a specification that Darwin's `HHMM` times are `Europe/London`, or whether an RID is reused across timetable years. It treats those clock times as London civil times.

The signed data-sharing schedule was not available to read. The README's Data section records the public catalogue licence.
