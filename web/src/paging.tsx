/**
 * Row paging for the result tables.
 *
 * The pages plan a budget for every filtered row but only render one page, so
 * the DOM stays small while every opportunity is reachable — the previous fixed
 * 300-row cut silently dropped the rest.
 *
 * The arithmetic is exported and React-free so an off-by-one that hides the
 * last row of every list is caught by a test rather than by a player.
 */

import { useRef, useState } from "react";

/** Rows per page offered in the picker. */
export const PAGE_SIZES = [50, 100, 250] as const;

export const DEFAULT_PAGE_SIZE = 100;

/** Total pages for a row count; a non-empty list always has at least one. */
export function pageCountFor(total: number, pageSize: number): number {
  if (total <= 0 || pageSize <= 0) return 1;
  return Math.ceil(total / pageSize);
}

/** Clamp a 1-based page number into the pages that actually exist. */
export function clampPage(page: number, pageCount: number): number {
  if (Number.isNaN(page)) return 1;
  return Math.min(Math.max(1, Math.floor(page)), Math.max(1, pageCount));
}

export interface PageBounds {
  /** Clamped 1-based page number. */
  page: number;
  pageCount: number;
  /** 1-based index of the first row on this page; 0 when there are no rows. */
  start: number;
  /** 1-based index of the last row on this page; 0 when there are no rows. */
  end: number;
}

/** The row range shown on a page, clamped to the rows that exist. */
export function pageBounds(
  total: number,
  page: number,
  pageSize: number,
): PageBounds {
  const pageCount = pageCountFor(total, pageSize);
  const current = clampPage(page, pageCount);
  if (total <= 0) return { page: current, pageCount, start: 0, end: 0 };
  const offset = (current - 1) * pageSize;
  return {
    page: current,
    pageCount,
    start: offset + 1,
    end: Math.min(total, offset + pageSize),
  };
}

/**
 * Page numbers to render: always the first and last, with a window around the
 * current page and `"gap"` markers where pages were skipped.
 */
export function pageWindow(
  page: number,
  pageCount: number,
): Array<number | "gap"> {
  const pages = Math.max(1, Math.floor(pageCount));
  const current = clampPage(page, pages);
  if (pages <= 5) {
    return Array.from({ length: pages }, (_, index) => index + 1);
  }

  let from = current - 1;
  let to = current + 1;
  if (current <= 3) {
    from = 2;
    to = 4;
  } else if (current >= pages - 2) {
    from = pages - 3;
    to = pages - 1;
  }

  const out: Array<number | "gap"> = [1];
  if (from > 2) out.push("gap");
  for (let value = from; value <= to; value += 1) out.push(value);
  if (to < pages - 1) out.push("gap");
  out.push(pages);
  return out;
}

export interface PagedRows<T> {
  /** Total rows across every page. */
  total: number;
  page: number;
  pageCount: number;
  /** 1-based first and last row index on this page (0 when empty). */
  start: number;
  end: number;
  pageSize: number;
  pageRows: readonly T[];
  setPage: (page: number) => void;
  setPageSize: (size: number) => void;
}

export function usePagedRows<T>(rows: readonly T[]): PagedRows<T> {
  const [pageSize, setPageSizeState] = useState(DEFAULT_PAGE_SIZE);
  const [page, setPageState] = useState(1);
  const seenRows = useRef(rows);

  // A new row array means the filters or the sort changed, so start over from
  // the top rather than landing mid-list. Adjusting state during render (rather
  // than in an effect) avoids painting the stale page first.
  if (seenRows.current !== rows) {
    seenRows.current = rows;
    if (page !== 1) setPageState(1);
  }

  const bounds = pageBounds(rows.length, page, pageSize);

  return {
    ...bounds,
    total: rows.length,
    pageSize,
    pageRows:
      bounds.start === 0 ? rows : rows.slice(bounds.start - 1, bounds.end),
    setPage: (next: number) => setPageState(Math.max(1, Math.floor(next))),
    setPageSize: (size: number) => {
      setPageSizeState(size);
      setPageState(1);
    },
  };
}

/** Pager: previous/next, numbered pages, and the rows-per-page picker. */
export function Pagination(props: {
  page: number;
  pageCount: number;
  pageSize: number;
  onPage: (page: number) => void;
  onPageSize: (size: number) => void;
}): JSX.Element {
  const { page, pageCount, pageSize, onPage, onPageSize } = props;
  return (
    <nav className="pagination" aria-label="Result pages">
      <button
        type="button"
        className="page-btn"
        onClick={() => onPage(page - 1)}
        disabled={page <= 1}
      >
        ‹ Prev
      </button>

      <ol className="page-list">
        {pageWindow(page, pageCount).map((item, index) =>
          item === "gap" ? (
            <li key={`gap-${index}`} className="page-gap" aria-hidden="true">
              …
            </li>
          ) : (
            <li key={item}>
              <button
                type="button"
                className={item === page ? "page-btn current" : "page-btn"}
                onClick={() => onPage(item)}
                aria-current={item === page ? "page" : undefined}
                aria-label={`Page ${item}`}
              >
                {item}
              </button>
            </li>
          ),
        )}
      </ol>

      <button
        type="button"
        className="page-btn"
        onClick={() => onPage(page + 1)}
        disabled={page >= pageCount}
      >
        Next ›
      </button>

      <label className="page-size">
        <span className="label">Rows</span>
        <select
          className="select"
          value={pageSize}
          onChange={(event) => onPageSize(Number(event.target.value))}
          aria-label="Rows per page"
        >
          {PAGE_SIZES.map((size) => (
            <option key={size} value={size}>
              {size}
            </option>
          ))}
        </select>
      </label>
    </nav>
  );
}
