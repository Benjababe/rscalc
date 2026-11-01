/**
 * The filter toolbar, shared by the three result pages.
 *
 * Every page had its own copy of this card: the mode switch, the search box,
 * the freshness line and the chip row. Only the mode labels, the chips and the
 * column picker differ, so those come in as props and children. The "top N"
 * count and the empty state live in `Results`.
 */

import type { ReactNode } from "react";

import { formatSourceDateTime, formatTime } from "./format";
import { CopyLink } from "./CopyLink";
import { useSearchShortcut } from "./searchShortcut";
import { StaleWarning } from "./ui";

export interface ModeOption<T extends string> {
  id: T;
  label: string;
  title?: string;
}

export function FilterToolbar<T extends string>(props: {
  /** Group label for the mode switch, e.g. "Sell mode". */
  modeGroupLabel: string;
  modes: readonly ModeOption<T>[];
  mode: T;
  onMode: (mode: T) => void;
  query: string;
  onQuery: (query: string) => void;
  placeholder: string;
  /** Accessible label for the search box. */
  searchLabel: string;
  pricesAsOf: string;
  generatedAt: string;
  filtersActive: boolean;
  onClearFilters: () => void;
  /** Pushed to the right of the chip row, normally the column picker. */
  actions?: ReactNode;
  /** Filter chips. */
  children: ReactNode;
}): JSX.Element {
  const searchRef = useSearchShortcut();

  return (
    <section className="toolbar" aria-label="Filters">
      <div className="toolbar-row">
        <div className="modes" role="group" aria-label={props.modeGroupLabel}>
          {props.modes.map((option) => (
            <button
              key={option.id}
              type="button"
              className={option.id === props.mode ? "mode active" : "mode"}
              onClick={() => props.onMode(option.id)}
              aria-pressed={option.id === props.mode}
              title={option.title}
            >
              {option.label}
            </button>
          ))}
        </div>

        <div className="search-field">
          <input
            ref={searchRef}
            className="search"
            type="search"
            placeholder={props.placeholder}
            value={props.query}
            onChange={(event) => props.onQuery(event.target.value)}
            aria-label={props.searchLabel}
            aria-keyshortcuts="/ Control+K Meta+K"
          />
          {/* Discoverability: the shortcut is useless if nobody knows it. */}
          <kbd className="search-hint" aria-hidden="true">
            /
          </kbd>
        </div>

        <div className="asof">
          <span className="label">GE prices as of</span>
          <strong title={formatSourceDateTime(props.pricesAsOf)}>
            {formatTime(props.pricesAsOf)}
          </strong>
          <span
            className="label"
            title={formatSourceDateTime(props.generatedAt)}
          >
            built {formatTime(props.generatedAt)}
          </span>
          <StaleWarning iso={props.pricesAsOf} />
        </div>
      </div>

      <div className="toolbar-row chips">
        {props.children}

        {props.filtersActive && (
          <button
            type="button"
            className="chip-clear"
            onClick={props.onClearFilters}
          >
            Clear filters
          </button>
        )}

        <span className="toolbar-spacer" />

        <CopyLink />
        {props.actions}
      </div>
    </section>
  );
}

/** A checkbox chip in the filter row. */
export function FilterCheck(props: {
  label: string;
  title?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}): JSX.Element {
  return (
    <label className="toggle" title={props.title}>
      <input
        type="checkbox"
        checked={props.checked}
        onChange={(event) => props.onChange(event.target.checked)}
      />
      {props.label}
    </label>
  );
}

/** A chip that carries a numeric threshold. */
export function FilterNumber(props: {
  label: string;
  title: string;
  ariaLabel: string;
  value: number;
  step: number;
  onChange: (value: number) => void;
}): JSX.Element {
  return (
    <label className="toggle" title={props.title}>
      {props.label}
      <input
        className="num"
        type="number"
        min={0}
        step={props.step}
        value={props.value}
        onChange={(event) =>
          props.onChange(Math.max(0, Number(event.target.value) || 0))
        }
        aria-label={props.ariaLabel}
      />
    </label>
  );
}
