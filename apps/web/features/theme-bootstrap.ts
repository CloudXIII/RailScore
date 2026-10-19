/** Preference stored in localStorage. */
export const THEME_PREFERENCE_KEY = "railscore-theme";

/**
 * Runs before first paint so full page loads keep the chosen colours.
 * Must stay a plain string for an inline script in the root layout.
 */
export const themeBootstrapScript = [
  "(function(){try{",
  `var k=${JSON.stringify(THEME_PREFERENCE_KEY)};`,
  "var t=localStorage.getItem(k);",
  'var pref=t==="light"||t==="dark"||t==="system"?t:"system";',
  'var dark=pref==="dark"||(pref!=="light"&&matchMedia("(prefers-color-scheme: dark)").matches);',
  'var theme=dark?"dark":"light";',
  "var root=document.documentElement;",
  "root.dataset.theme=theme;",
  "root.dataset.themePreference=pref",
  "}catch(e){}})();",
].join("");
