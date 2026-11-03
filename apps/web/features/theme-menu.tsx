"use client";

import { useEffect, useId, useRef, useState } from "react";
import { THEME_PREFERENCE_KEY } from "@/features/theme-bootstrap";

type Preference = "light" | "dark" | "system";

const OPTIONS: { value: Preference; label: string }[] = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "System" },
];

function readPreference(): Preference {
  try {
    const stored = localStorage.getItem(THEME_PREFERENCE_KEY);
    if (stored === "light" || stored === "dark" || stored === "system") {
      return stored;
    }
  } catch {
    // Storage can be blocked; fall back to the value set by the head script.
  }
  const fromDom = document.documentElement.dataset.themePreference;
  if (fromDom === "light" || fromDom === "dark" || fromDom === "system") {
    return fromDom;
  }
  return "system";
}

function applyTheme(preference: Preference) {
  const dark =
    preference === "dark" ||
    (preference === "system" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  document.documentElement.dataset.themePreference = preference;
  try {
    localStorage.setItem(THEME_PREFERENCE_KEY, preference);
  } catch {
    // Preference still applies for this visit via data-theme.
  }
}

export function ThemeMenu() {
  const menuId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  // Menu checkmarks only; the button icon is driven by CSS + data-theme-preference.
  const [preference, setPreference] = useState<Preference>("system");

  useEffect(() => {
    const current = readPreference();
    setPreference(current);
    applyTheme(current);

    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      if (readPreference() === "system") applyTheme("system");
    };
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  function choose(next: Preference) {
    setPreference(next);
    applyTheme(next);
    setOpen(false);
  }

  return (
    <div className="theme-menu" ref={rootRef}>
      <button
        type="button"
        className="theme-button"
        aria-label="Colour scheme"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="theme-icons" aria-hidden="true">
          <span className="theme-icon theme-icon-light">
            <LightIcon />
          </span>
          <span className="theme-icon theme-icon-dark">
            <DarkIcon />
          </span>
          <span className="theme-icon theme-icon-system">
            <SystemIcon />
          </span>
        </span>
      </button>
      {open ? (
        <ul id={menuId} className="theme-list" role="menu">
          {OPTIONS.map((option) => (
            <li key={option.value} role="none">
              <button
                type="button"
                role="menuitemradio"
                aria-checked={preference === option.value}
                className="theme-option"
                onClick={() => choose(option.value)}
              >
                <span className="theme-check" aria-hidden="true">
                  {preference === option.value ? "✓" : ""}
                </span>
                {option.label}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function SystemIcon() {
  return (
    <svg viewBox="0 0 24 24">
      <circle
        cx="12"
        cy="12"
        r="8.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      />
      <path d="M12 3.5a8.5 8.5 0 0 0 0 17Z" fill="currentColor" />
    </svg>
  );
}

function DarkIcon() {
  return (
    <svg viewBox="0 0 24 24">
      <path
        d="M16.5 13.5A6.5 6.5 0 0 1 10 4.2 7 7 0 1 0 19.8 14a6.5 6.5 0 0 1-3.3-.5Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function LightIcon() {
  return (
    <svg viewBox="0 0 24 24">
      <circle
        cx="12"
        cy="12"
        r="4"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      />
      <path
        d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}
