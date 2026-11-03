"use client";

import { useState } from "react";
import {
  formatClock,
  formatDate,
  formatDuration,
  formatServiceFacts,
  formatSevereJourneys,
  listIntro,
  listScore,
  operatorName,
  throughServiceLabel,
  trainListHeading,
} from "@/features/format";
import { stationName, type Station } from "@/server/stations";
import { scheduleNotes, usualDays } from "@/features/timetable-changes";
import { listHref } from "@/features/search-href";
import {
  lastRunDate,
  matchesServiceKey,
  serviceKey,
  type ScheduledService,
} from "@/server/services/map";
import type { ParsedQuery } from "@/server/query";

export function ServiceList({
  query,
  services,
  retired = [],
  listed,
  earlier,
  later,
  stations,
  sample = false,
}: {
  query: ParsedQuery;
  services: readonly ScheduledService[];
  retired?: readonly ScheduledService[];
  /** Dates the listed runs cover. */
  listed?: { from: string; to: string };
  /** HHMM time that lists the trains before these. None at the start of the day. */
  earlier?: string;
  /** HHMM time that lists the trains after these. None at the end of the day. */
  later?: string;
  stations: readonly Station[];
  sample?: boolean;
}) {
  const [pending, setPending] = useState(false);
  const [chosen, setChosen] = useState(() => {
    const linked = query.serviceKey;
    const match = linked
      ? [...services, ...retired].find((service) =>
          matchesServiceKey(service, linked),
        )
      : undefined;
    if (match) {
      return serviceKey(match);
    }
    const only = services.length === 1 ? services[0] : undefined;
    return only ? serviceKey(only) : undefined;
  });
  if (!query.from || !query.to) {
    return null;
  }
  const from = query.from;
  const to = query.to;
  const lastRetired = retired
    .map(lastRunDate)
    .filter((date): date is string => date !== undefined)
    .sort()
    .at(-1);
  const row = (service: ScheduledService) => (
    <ServiceRow
      key={serviceKey(service)}
      service={service}
      through={throughServiceLabel(service, from.crs, to.crs, (crs) =>
        stationName(crs, stations),
      )}
      searched={query.days}
      chosen={chosen === serviceKey(service)}
      onChoose={() => setChosen(serviceKey(service))}
    />
  );

  return (
    <form
      className="services"
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
      <h2 id="trains-heading" tabIndex={-1}>
        {trainListHeading(
          query.time,
          services.map((service) => service.publicDeparture),
        )}
      </h2>
      <p>
        {listIntro({
          periodDays: query.period,
          listed,
          sample,
        })}
      </p>
      {earlier ? (
        <TimeShift
          href={listHref(query, formatClock(earlier))}
          direction="earlier"
        >
          Earlier trains
        </TimeShift>
      ) : null}
      {services.length === 0 ? (
        <p className="card" role="status">
          {emptyTrains(from.name, to.name, query.time, Boolean(earlier))}
        </p>
      ) : null}
      {services.length > 0 || retired.length > 0 ? (
        <fieldset>
          <legend className="visually-hidden">Choose one train</legend>
          {services.map(row)}
          {retired.length > 0 ? (
            <details
              className="service-group retired-services"
              open={retired.some((service) => chosen === serviceKey(service))}
            >
              <summary className="meta">
                {retired.length}{" "}
                {retired.length === 1
                  ? "train no longer runs"
                  : "trains no longer run"}
                {lastRetired ? `. Last ran ${formatDate(lastRetired)}.` : "."}
              </summary>
              {retired.map(row)}
            </details>
          ) : null}
        </fieldset>
      ) : null}
      {later ? (
        <TimeShift href={listHref(query, formatClock(later))} direction="later">
          Later trains
        </TimeShift>
      ) : null}
      {services.length > 0 || retired.length > 0 ? (
        <div className="calculate-bar">
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
  chosen,
  onChoose,
}: {
  service: ScheduledService;
  through: string;
  searched: ParsedQuery["days"];
  chosen: boolean;
  onChoose: () => void;
}) {
  const score = listScore(service.punctuality);
  const severe = score ? formatSevereJourneys(score.severe) : "";
  return (
    <label className="card service">
      <input
        type="radio"
        name="service"
        value={serviceKey(service)}
        checked={chosen}
        onChange={onChoose}
        required
      />
      <span className="service-times">
        <strong>{formatClock(service.publicDeparture)}</strong>
        <span className="service-line" aria-hidden="true" />
        <strong>{formatClock(service.publicArrival)}</strong>
      </span>
      <span className="service-duration">
        {formatDuration(service.publicDeparture, service.publicArrival)}
      </span>
      {score ? (
        <span className="service-score">
          <span className="on-time-value">{score.onTimePercent}%</span>
          <span className="on-time-label">on time</span>
        </span>
      ) : null}
      {severe ? <span className="service-severe">{severe}</span> : null}
      <span className="meta service-detail">
        {operatorName(service.operatorCode)} ·{" "}
        {formatServiceFacts(service.rids.length, usualDays(service), searched)}
      </span>
      {through ? <span className="meta service-detail">{through}</span> : null}
      {scheduleNotes(service).map((note, index) => (
        <span
          key={`${index}:${note}`}
          className="meta service-detail included-time"
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
    <a className={`time-shift ${direction}`} href={href}>
      <svg
        className="time-shift-chevron"
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

function emptyTrains(
  from: string,
  to: string,
  time: string,
  earlier: boolean,
): string {
  return earlier
    ? `No more direct trains from ${from} to ${to} after ${time}. Journeys with a change are not included.`
    : `No direct trains from ${from} to ${to} in the recorded timetable. Journeys with a change are not included.`;
}
