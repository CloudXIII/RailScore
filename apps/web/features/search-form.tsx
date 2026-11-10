"use client";

import { useEffect, useRef, useState } from "react";
import { departureWindowHint, timeSearchLabel } from "@/features/format";
import { keepFieldInView } from "@/features/keep-field-in-view";
import type { ParsedQuery } from "@/shared/search-query";
import type { Station } from "@/shared/stations";
import { StationField } from "@/features/station-field";
import styles from "./search-form.module.css";

const DAY_OPTIONS = [
  { value: "weekdays", label: "Weekdays" },
  { value: "saturday", label: "Saturdays" },
  { value: "sunday", label: "Sundays" },
  { value: "all", label: "All days" },
] as const;

const PERIOD_OPTIONS = [
  { value: 30, label: "30 days" },
  { value: 60, label: "60 days" },
  { value: 90, label: "90 days" },
  { value: 180, label: "180 days" },
  { value: 365, label: "365 days" },
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
      <section
        className={`card ${styles.journeySummary}`}
        aria-label="Your search"
      >
        <p className={styles.journeyRoute}>
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
        <p className={`meta ${styles.journeyMeta}`}>
          {timeSearchLabel(query.time)} · {days} · last {query.period} days
        </p>
      </section>
    );
  }

  return (
    <form
      ref={formRef}
      className={`card ${styles.planner}`}
      method="get"
      action="/"
      autoComplete="off"
    >
      <div className={styles.stations}>
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
          className={styles.swap}
          aria-label="Swap departure and destination"
          onClick={() => {
            setFrom(to);
            setTo(from);
          }}
        >
          <span aria-hidden="true">⇅</span>
        </button>
      </div>
      <div className={styles.departAfter}>
        <label htmlFor="departure-time">Earliest departure</label>
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
          {departureWindowHint()}
        </p>
      </div>
      <fieldset className="days">
        <legend>Days</legend>
        <div className={styles.pills}>
          {DAY_OPTIONS.map((option) => (
            <label key={option.value} className={styles.pill}>
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
      <fieldset className="days">
        <legend>History</legend>
        <div className={styles.pills}>
          {PERIOD_OPTIONS.map((option) => (
            <label key={option.value} className={styles.pill}>
              <input
                type="radio"
                name="period"
                value={option.value}
                defaultChecked={query.period === option.value}
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
