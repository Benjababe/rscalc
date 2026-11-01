/**
 * The light/dark switch.
 *
 * The theme is explicit rather than inherited from the operating system: the
 * site opens dark, and stays dark until the player asks otherwise. A `data-theme`
 * attribute on `<html>` is what the stylesheet keys off (`:root[data-theme=
 * "light"]`), so there is no media query to lose to the OS setting.
 *
 * The chosen theme is remembered in `localStorage` under its own key, separate
 * from the budget/view preferences.
 */

import { useEffect, useState } from "react";

import { browserStore, type KeyValueStore } from "./storage";

export type Theme = "dark" | "light";

export const THEME_STORAGE_KEY = "rscalc.theme";
export const DEFAULT_THEME: Theme = "dark";

/** The canvas colour each theme paints, for the browser's own chrome. */
const THEME_COLOR: Record<Theme, string> = {
  dark: "#14161a",
  light: "#f5f6f8",
};

/** Anything that is not "light" is dark, so a corrupt entry stays usable. */
export function parseTheme(raw: string | null): Theme {
  return raw === "light" ? "light" : DEFAULT_THEME;
}

export function nextTheme(theme: Theme): Theme {
  return theme === "dark" ? "light" : "dark";
}

export function readStoredTheme(store: KeyValueStore | null): Theme {
  if (store === null) return DEFAULT_THEME;
  try {
    return parseTheme(store.getItem(THEME_STORAGE_KEY));
  } catch {
    return DEFAULT_THEME;
  }
}

export function writeStoredTheme(theme: Theme, store: KeyValueStore | null): void {
  if (store === null) return;
  try {
    store.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Private mode or a full quota: the theme still applies for this visit.
  }
}

/**
 * Apply a theme to the document.
 *
 * Also keeps `<meta name="theme-color">` in step, which is what colours the
 * browser's address bar on mobile rather than the page itself.
 */
export function applyTheme(theme: Theme): void {
  if (typeof document === "undefined") return;
  document.documentElement.dataset["theme"] = theme;
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", THEME_COLOR[theme]);
}

export interface ThemeState {
  theme: Theme;
  toggle: () => void;
}

export function useTheme(): ThemeState {
  const [theme, setTheme] = useState<Theme>(() =>
    readStoredTheme(browserStore()),
  );

  useEffect(() => {
    applyTheme(theme);
    writeStoredTheme(theme, browserStore());
  }, [theme]);

  return { theme, toggle: () => setTheme(nextTheme) };
}
