"use client";

import { useEffect, useRef, useState } from "react";
import { departureWindowHint, timeSearchLabel } from "@/features/format";
import { keepFieldInView } from "@/features/keep-field-in-view";
import type { ParsedQuery } from "@/server/query";
import type { Station } from "@/server/stations";
import { StationField } from "@/features/station-field";

const DAY_OPTIONS = [
  { value: "weekdays", label: "Weekdays" },
  { value: "saturday", label: "Saturdays" },
  { value: "sunday", label: "Sundays" },
  { value: "all", label: "All days" },
] as const;

export function SearchForm({
  query,
  collapsed,
  stations,
}: {
  query: ParsedQuery;
  collapsed: boolean;
  stations: readonly Station[];
}) {
  const [editing, setEditing] = useState(!collapsed);
  /** True only after Change, so the home screen does not open the keyboard. */
  const [openedFromChange, setOpenedFromChange] = useState(false);
  const [from, setFrom] = useState(query.fromText);
  const [to, setTo] = useState(query.toText);
  const [time, setTime] = useState(query.time);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (!openedFromChange || !editing) {
      return;
    }
    formRef.current?.scrollIntoView({ block: "start" });
  }, [openedFromChange, editing]);

  if (!editing && query.from && query.to) {
    const days = DAY_OPTIONS.find(
      (option) => option.value === query.days,
    )?.label;
    return (
      <section className="card journey-summary" aria-label="Your search">
        <p className="journey-route">
          <span>{query.from.name}</span>
          <span>
            <span aria-hidden="true">→ </span>
            <span className="visually-hidden">to </span>
            {query.to.name}
          </span>
        </p>
        <button
          type="button"
          className="link-button"
          onClick={() => {
            setOpenedFromChange(true);
            setEditing(true);
          }}
        >
          Change
        </button>
        <p className="meta journey-meta">
          {timeSearchLabel(query.time)} · {days} · {query.period} days
        </p>
      </section>
    );
  }

  return (
    <form
      ref={formRef}
      className="card planner"
      method="get"
      action="/"
      autoComplete="off"
    >
      <div className="stations">
        <StationField
          name="from"
          label="From"
          value={from}
          onChange={setFrom}
          autoFocus={openedFromChange}
          stations={stations}
        />
        <StationField
          name="to"
          label="To"
          value={to}
          onChange={setTo}
          stations={stations}
        />
        <button
          type="button"
          className="swap"
          aria-label="Swap departure and destination"
          onClick={() => {
            setFrom(to);
            setTo(from);
          }}
        >
          <span aria-hidden="true">⇅</span>
        </button>
      </div>
      <div className="depart-after">
        <label htmlFor="departure-time">Departing from</label>
        <input
          id="departure-time"
          name="time"
          type="time"
          value={time}
          onChange={(event) => setTime(event.target.value)}
          onFocus={(event) => keepFieldInView(event.currentTarget)}
          aria-describedby="departure-window"
          enterKeyHint="go"
          required
        />
        <p className="meta" id="departure-window">
          {departureWindowHint(time)}
        </p>
      </div>
      <fieldset className="days">
        <legend>Days</legend>
        <div className="pills">
          {DAY_OPTIONS.map((option) => (
            <label key={option.value} className="pill">
              <input
                type="radio"
                name="days"
                value={option.value}
                defaultChecked={query.days === option.value}
              />
              <span>{option.label}</span>
            </label>
          ))}
        </div>
      </fieldset>
      {query.errors.length > 0 ? (
        <ul className="errors" role="alert">
          {query.errors.map((error) => (
            <li key={error}>{error}</li>
          ))}
        </ul>
      ) : null}
      <button type="submit" className="primary">
        Find trains
      </button>
    </form>
  );
}
