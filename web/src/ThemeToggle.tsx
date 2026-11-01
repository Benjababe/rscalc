/**
 * The light/dark switch button.
 *
 * Icon-only to stay compact in the header, so the accessible name lives in
 * `aria-label` and the state in `aria-pressed` — a button whose *name* changed on
 * every click would be announced as an entirely different control.
 *
 * The icons are inline SVG rather than ☾/☀ text: the crescent glyph renders at a
 * different weight and baseline in every font stack, and some platforms swap it
 * for an emoji. `currentColor` keeps them in step with the button's own colour.
 */

import type { Theme } from "./theme";

/** Solid crescent: reads better than an outline at 18px. */
function MoonIcon(): JSX.Element {
  return (
    <svg
      data-icon="moon"
      viewBox="0 0 24 24"
      width="18"
      height="18"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z"
        fill="currentColor"
      />
    </svg>
  );
}

/** Outlined sun, so the two states differ in character as well as in shape. */
function SunIcon(): JSX.Element {
  return (
    <svg
      data-icon="sun"
      viewBox="0 0 24 24"
      width="18"
      height="18"
      aria-hidden="true"
      focusable="false"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
    >
      <circle cx="12" cy="12" r="4.2" />
      <path d="M12 2.5v2.2M12 19.3v2.2M4.6 4.6l1.6 1.6M17.8 17.8l1.6 1.6M2.5 12h2.2M19.3 12h2.2M4.6 19.4l1.6-1.6M17.8 6.2l1.6-1.6" />
    </svg>
  );
}

export function ThemeToggle(props: {
  theme: Theme;
  onToggle: () => void;
}): JSX.Element {
  const light = props.theme === "light";
  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={props.onToggle}
      aria-pressed={light}
      aria-label="Light theme"
      title={light ? "Switch to the dark theme" : "Switch to the light theme"}
    >
      {light ? <SunIcon /> : <MoonIcon />}
    </button>
  );
}
