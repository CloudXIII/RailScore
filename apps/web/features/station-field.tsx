"use client";

import { useId, useState, type KeyboardEvent } from "react";
import { searchStations, stationLabel, type Station } from "@/server/stations";

export function StationField({
  name,
  label,
  value,
  onChange,
  autoFocus = false,
  stations,
}: {
  name: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoFocus?: boolean;
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
    <div className="station-field">
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
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="words"
        spellCheck={false}
        enterKeyHint="next"
        required
        autoFocus={autoFocus}
        onChange={(event) => {
          onChange(event.target.value);
          setActive(0);
          setOpen(true);
        }}
        onFocus={(event) => event.currentTarget.select()}
        onBlur={() => setOpen(false)}
        onKeyDown={onKeyDown}
      />
      {showList ? (
        <ul
          role="listbox"
          id={listId}
          className="station-list"
          aria-label={label}
        >
          {matches.length === 0 ? (
            <li className="station-empty">No stations match.</li>
          ) : (
            matches.map((station) => (
              <li
                key={station.crs}
                id={`${listId}-${station.crs}`}
                role="option"
                aria-selected={station === current}
                className="station-option"
                // Keeps focus in the input so blur does not close the list before the click lands.
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setActive(matches.indexOf(station))}
                onClick={() => choose(station)}
              >
                <span>{station.name}</span>
                <span className="station-code">{station.crs}</span>
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  );
}
