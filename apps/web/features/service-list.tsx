"use client";

import { useState } from "react";
import {
  formatClock,
  formatDuration,
  formatServiceFacts,
  formatSevereJourneys,
  emptyTrains,
  inEarlyHours,
  listIntro,
  nightNote,
  listScore,
  olderJourneysNote,
  olderJourneysRowNote,
  scoreTier,
  operatorName,
  throughServiceLabel,
  trainListHeading,
} from "@/features/format";
import type { DayPattern } from "@/shared/day-type";
import { stationName, type Station } from "@/shared/stations";
import { scheduleNotes, usualDays } from "@/features/timetable-changes";
import { listHref } from "@/features/search-href";
import {
  matchesServiceKey,
  serviceKey,
  type ScheduledService,
} from "@/shared/scheduled-service";
import type { ParsedQuery } from "@/shared/search-query";
import { useEarlierDaysState } from "@/features/earlier-days-context";
import {
  earlierDaysTotal,
  listPunctuality,
  type TrainEarlierDays,
} from "@/features/earlier-days-figures";
import styles from "./service-list.module.css";

export function ServiceList({
  query,
  services,
  overnight,
  retired = [],
  listed,
  earlier,
  later,
  laterDays,
  darwinFrom,
  stations,
}: {
  query: ParsedQuery;
  services: readonly ScheduledService[];
  /** Trains after midnight that end the day. Absent when the list stops before it. */
  overnight?: readonly ScheduledService[];
  retired?: readonly ScheduledService[];
  /** Dates the listed runs cover. */
  listed?: { from: string; to: string };
  /** HHMM time that lists the trains before these. None at the start of the day. */
  earlier?: string;
  /** HHMM time that lists the trains after these. None at the end of the day. */
  later?: string;
  /** Day type of the list `later` opens, when it is the next night's. */
  laterDays?: DayPattern;
  /** First day Darwin counts: the figures of a train whose older journeys did not load start here. */
  darwinFrom?: string;
  stations: readonly Station[];
}) {
  const [pending, setPending] = useState(false);
  const [chosen, setChosen] = useState(() => {
    const linked = query.serviceKey;
    const match = linked
      ? [...services, ...(overnight ?? []), ...retired].find((service) =>
          matchesServiceKey(service, linked),
        )
      : undefined;
    if (match) {
      return serviceKey(match);
    }
    const shown = [...services, ...(overnight ?? [])];
    const only = shown.length === 1 ? shown[0] : undefined;
    return only ? serviceKey(only) : undefined;
  });
  const earlierDays = useEarlierDaysState();
  if (!query.from || !query.to) {
    return null;
  }
  const from = query.from;
  const to = query.to;
  const night = overnight ?? [];
  const listedTrains = [...services, ...night];
  const waiting = (service: ScheduledService) =>
    earlierDays !== undefined &&
    !earlierDays.done &&
    listedTrains.includes(service) &&
    !earlierDays.trains.has(serviceKey(service));
  const loading = listedTrains.some(waiting);
  /** Listed trains still without older journeys once HSP has stopped trying. */
  const notLoaded = (service: ScheduledService) =>
    earlierDays !== undefined &&
    earlierDays.done &&
    earlierDays.missing.has(serviceKey(service));
  const notLoadedCount = listedTrains.filter(notLoaded).length;
  const notLoadedNote = olderJourneysNote({
    missing: notLoadedCount,
    listed: listedTrains.length,
    ...(darwinFrom ? { since: darwinFrom } : {}),
  });
  // Rows are marked only when some trains have their older journeys: the line above covers all.
  const markRows = notLoadedCount < listedTrains.length;
  const row = (
    service: ScheduledService,
    nightPart?: "early" | "overnight",
  ) => (
    <ServiceRow
      key={serviceKey(service)}
      service={service}
      through={throughServiceLabel(service, from.crs, to.crs, (crs) =>
        stationName(crs, stations),
      )}
      searched={query.days}
      earlierDays={earlierDays?.trains.get(serviceKey(service))}
      waiting={waiting(service)}
      notLoaded={
        markRows && notLoaded(service)
          ? olderJourneysRowNote(darwinFrom)
          : undefined
      }
      night={nightPart ? nightNote(nightPart, query.days) : undefined}
      chosen={chosen === serviceKey(service)}
      onChoose={() => setChosen(serviceKey(service))}
    />
  );

  return (
    <form
      className={styles.services}
      method="get"
      action="/"
      onSubmit={() => setPending(true)}
    >
      <input type="hidden" name="from" value={query.fromText} />
      <input type="hidden" name="to" value={query.toText} />
      <input type="hidden" name="time" value={query.time} />
      <input type="hidden" name="days" value={query.days} />
      <input type="hidden" name="period" value={query.period} />
      <input type="hidden" name="calculate" value="1" />
      {/* The summary above already names the search. The heading stays for screen readers
          and as the focus target when returning from a train. */}
      <h2 id="trains-heading" className="visually-hidden" tabIndex={-1}>
        {trainListHeading(
          query.time,
          listedTrains.map((service) => service.publicDeparture),
        )}
      </h2>
      <p>
        {listIntro({
          periodDays: query.period,
          listed,
        })}
      </p>
      {/* One line for the whole list. The rows keep only a placeholder for their figure. */}
      {loading ? (
        <p className="meta" role="status">
          Loading older journeys…
          {earlierDays?.busy
            ? " The data provider is busy, so this may take a few minutes."
            : ""}
        </p>
      ) : null}
      {notLoadedNote ? (
        <p className="meta" role="status">
          {notLoadedNote}
        </p>
      ) : null}
      {earlier ? (
        <TimeShift
          href={listHref(query, formatClock(earlier))}
          direction="earlier"
        >
          Earlier trains
        </TimeShift>
      ) : null}
      {listedTrains.length === 0 ? (
        <p className="card" role="status">
          {emptyTrains({
            from: from.name,
            to: to.name,
            time: query.time,
            earlier: Boolean(earlier),
            overnight: overnight !== undefined,
          })}
        </p>
      ) : null}
      {listedTrains.length > 0 || retired.length > 0 ? (
        <fieldset>
          <legend className="visually-hidden">Choose one train</legend>
          {services.map((service) =>
            row(
              service,
              inEarlyHours(service.publicDeparture) ? "early" : undefined,
            ),
          )}
          {night.map((service) => row(service, "overnight"))}
          {retired.length > 0 ? (
            <details
              className={`${styles.serviceGroup} ${styles.retiredServices}`}
              open={retired.some((service) => chosen === serviceKey(service))}
            >
              <summary className="meta">
                {retired.length}{" "}
                {retired.length === 1
                  ? "train no longer runs"
                  : "trains no longer run"}
              </summary>
              {retired.map((service) => row(service))}
            </details>
          ) : null}
        </fieldset>
      ) : null}
      {later ? (
        <TimeShift
          href={listHref(query, formatClock(later), laterDays)}
          direction="later"
        >
          Later trains
        </TimeShift>
      ) : null}
      {listedTrains.length > 0 || retired.length > 0 ? (
        <div className={styles.calculateBar}>
          <button
            type="submit"
            className="primary"
            disabled={!chosen || pending}
          >
            {pending ? "Loading…" : "Show arrival history"}
          </button>
        </div>
      ) : null}
    </form>
  );
}

function ServiceRow({
  service,
  through,
  searched,
  earlierDays,
  waiting,
  notLoaded,
  night,
  chosen,
  onChoose,
}: {
  service: ScheduledService;
  through: string;
  searched: ParsedQuery["days"];
  /** HSP's counts for the days before Darwin, once they arrive. */
  earlierDays: TrainEarlierDays | undefined;
  /** HSP has not answered for this train yet. */
  waiting: boolean;
  /** Note on a train whose older journeys did not load. */
  notLoaded: string | undefined;
  /** Note on a train in the small hours: which night it belongs to. */
  night: string | undefined;
  chosen: boolean;
  onChoose: () => void;
}) {
  const score = waiting
    ? undefined
    : listScore(listPunctuality(service.punctuality, earlierDays));
  const journeys =
    service.rids.length +
    (earlierDays ? earlierDaysTotal(earlierDays).runs : 0);
  const severe = score ? formatSevereJourneys(score.severe, score.runs) : "";
  return (
    <label className={`card ${styles.service}`}>
      <input
        type="radio"
        name="service"
        value={serviceKey(service)}
        checked={chosen}
        onChange={onChoose}
        required
      />
      <span className={styles.serviceTimes}>
        <strong>{formatClock(service.publicDeparture)}</strong>
        <span className={styles.serviceLine} aria-hidden="true" />
        <strong>{formatClock(service.publicArrival)}</strong>
      </span>
      <span className={styles.serviceDuration}>
        {formatDuration(service.publicDeparture, service.publicArrival)}
      </span>
      {score ? (
        <span className={styles.serviceScore}>
          <span
            className={`${styles.onTimeValue} tier-${scoreTier(score.onTimePercent, score.runs)}`}
          >
            {score.onTimePercent}%
          </span>
          <span className={styles.onTimeLabel}>on time</span>
        </span>
      ) : waiting ? (
        <span
          className={`${styles.serviceScore} ${styles.serviceScoreWaiting}`}
        >
          <span className="score-placeholder" aria-hidden="true" />
          <span className="visually-hidden">On-time share loading</span>
        </span>
      ) : null}
      {severe ? <span className={styles.serviceSevere}>{severe}</span> : null}
      <span className={`meta ${styles.serviceDetail}`}>
        {[
          operatorName(service.operatorCode),
          formatServiceFacts(
            waiting ? undefined : journeys,
            usualDays(service),
            searched,
          ),
        ]
          .filter(Boolean)
          .join(" · ")}
      </span>
      {night ? (
        <span className={`meta ${styles.serviceDetail}`}>{night}</span>
      ) : null}
      {notLoaded ? (
        <span className={`meta ${styles.serviceDetail}`}>{notLoaded}</span>
      ) : null}
      {through ? (
        <span className={`meta ${styles.serviceDetail}`}>{through}</span>
      ) : null}
      {scheduleNotes(service).map((note, index) => (
        <span
          key={`${index}:${note}`}
          className={`meta ${styles.serviceDetail} ${styles.includedTime}`}
        >
          {note}
        </span>
      ))}
    </label>
  );
}

function TimeShift({
  href,
  direction,
  children,
}: {
  href: string;
  direction: "earlier" | "later";
  children: string;
}) {
  return (
    <a
      className={`${styles.timeShift}${direction === "later" ? ` ${styles.later}` : ""}`}
      href={href}
    >
      <svg
        className={styles.timeShiftChevron}
        viewBox="0 0 24 12"
        aria-hidden="true"
      >
        <path
          d="M2.5 9.5 12 2.5 21.5 9.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <span>{children}</span>
    </a>
  );
}
