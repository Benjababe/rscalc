/** Small table/stat building blocks shared by the three result pages. */

import type { ReactNode } from "react";

import { formatDuration, hoursSince, STALE_SNAPSHOT_HOURS } from "./format";
import { Pagination, type PagedRows } from "./paging";

export function Th(props: {
  label: string;
  onClick: () => void;
  active: boolean;
  desc: boolean;
  right?: boolean;
  title?: string;
}): JSX.Element {
  // `aria-sort` belongs on every sortable header, with "none" for the columns
  // that are not currently sorting.
  const ariaSort = props.active
    ? props.desc
      ? "descending"
      : "ascending"
    : "none";
  return (
    <th
      scope="col"
      className={props.right ? "right sortable" : "sortable"}
      aria-sort={ariaSort}
      title={props.title}
    >
      <button type="button" onClick={props.onClick}>
        {props.label}
        {props.active && (
          <span className="arrow">{props.desc ? "▾" : "▴"}</span>
        )}
      </button>
    </th>
  );
}

export function Stat(props: {
  label: string;
  value: string;
  accent?: boolean;
  title?: string;
}): JSX.Element {
  return (
    <div
      className={props.accent ? "stat accent" : "stat"}
      title={props.title}
    >
      <span className="label">{props.label}</span>
      <strong>{props.value}</strong>
    </div>
  );
}

/**
 * Flags a price snapshot that is old enough to mislead.
 *
 * Renders nothing for fresh or unparseable timestamps: silence is only ever
 * "not obviously stale", never a claim that the prices are current.
 */
export function StaleWarning({ iso }: { iso: string }): JSX.Element | null {
  const hours = hoursSince(iso);
  if (hours === null || hours < STALE_SNAPSHOT_HOURS) return null;
  const age = formatDuration(hours * 3600);
  return (
    <span
      className="stale-flag"
      title={`These prices were fetched ${age} ago. Run pnpm refresh to rebuild the snapshot.`}
    >
      {age} old
    </span>
  );
}

/**
 * The result region: a row count and page range, the scrollable table, the
 * pager, or an empty state that offers a way back.
 *
 * The count and the empty state used to live inside `.tablewrap`, where the
 * "top 300 of N" notice could only be read by scrolling to the bottom.
 */
export function Results(props: {
  /** Accessible name for the scroll region. */
  label: string;
  /** Plural noun for the row count, e.g. "opportunities". */
  noun: string;
  paged: PagedRows<unknown>;
  emptyText: ReactNode;
  onClearFilters: () => void;
  /** The table is showing a previous filter while the new one computes. */
  busy?: boolean;
  children: ReactNode;
}): JSX.Element {
  const total = props.paged.total;
  return (
    <>
      <div className="result-bar">
        <span className="result-count">
          {props.paged.start === 0 ? (
            <>
              <strong>0</strong> {props.noun}
            </>
          ) : (
            <>
              <strong>
                {props.paged.start.toLocaleString()}–
                {props.paged.end.toLocaleString()}
              </strong>{" "}
              of {total.toLocaleString()} {props.noun}
            </>
          )}
        </span>
      </div>

      {total === 0 ? (
        <div className="empty-panel">
          <p>{props.emptyText}</p>
          <button
            type="button"
            className="preset"
            onClick={props.onClearFilters}
          >
            Clear filters
          </button>
        </div>
      ) : (
        <>
          <div
            className="tablewrap"
            role="region"
            tabIndex={0}
            aria-label={props.label}
            aria-busy={props.busy === true}
          >
            {props.children}
          </div>

          {props.paged.pageCount > 1 && (
            <Pagination
              page={props.paged.page}
              pageCount={props.paged.pageCount}
              pageSize={props.paged.pageSize}
              onPage={props.paged.setPage}
              onPageSize={props.paged.setPageSize}
            />
          )}
        </>
      )}
    </>
  );
}
