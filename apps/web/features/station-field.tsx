"use client";

import { useId, useState, type KeyboardEvent } from "react";
import { keepFieldInView } from "@/features/keep-field-in-view";
import { searchStations, stationLabel, type Station } from "@/shared/stations";
import styles from "./station-field.module.css";

export function StationField({
  name,
  label,
  value,
  onChange,
  autoFocus = false,
  enterKeyHint = "next",
  stations,
}: {
  name: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoFocus?: boolean;
  enterKeyHint?: "next" | "go" | "search" | "done";
  stations: readonly Station[];
}) {
  const inputId = useId();
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  const matches = open ? searchStations(value, stations, 8) : [];
  const showList = open && value.trim().length > 0;
  const current = matches[Math.min(active, matches.length - 1)];

  function choose(station: Station) {
    onChange(stationLabel(station));
    setOpen(false);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(true);
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive((index) =>
        Math.max(0, Math.min(index + step, matches.length - 1)),
      );
    } else if (event.key === "Enter" && showList && current) {
      event.preventDefault();
      choose(current);
    } else if (event.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div className={styles.stationField}>
      <label htmlFor={inputId}>{label}</label>
      <input
        id={inputId}
        name={name}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={showList}
        aria-controls={listId}
        aria-activedescendant={
          showList && current ? `${listId}-${current.crs}` : undefined
        }
        value={value}
        placeholder="Station name or code"
        inputMode="search"
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="words"
        spellCheck={false}
        enterKeyHint={enterKeyHint}
        required
        autoFocus={autoFocus}
        onChange={(event) => {
          onChange(event.target.value);
          setActive(0);
          setOpen(true);
        }}
        onFocus={(event) => {
          event.currentTarget.select();
          keepFieldInView(event.currentTarget);
        }}
        onBlur={() => setOpen(false)}
        onKeyDown={onKeyDown}
      />
      {showList ? (
        <ul
          role="listbox"
          id={listId}
          className={styles.stationList}
          aria-label={label}
        >
          {matches.length === 0 ? (
            <li className={styles.stationEmpty}>No stations match.</li>
          ) : (
            matches.map((station) => (
              <li
                key={station.crs}
                id={`${listId}-${station.crs}`}
                role="option"
                aria-selected={station === current}
                className={styles.stationOption}
                // Keeps focus in the input so blur does not close the list before the click lands.
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setActive(matches.indexOf(station))}
                onClick={() => choose(station)}
              >
                <span>{station.name}</span>
                <span className={styles.stationCode}>{station.crs}</span>
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  );
}
