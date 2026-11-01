/**
 * Sort state and the one ordering rule the three result tables share.
 *
 * Every page sorts by a numeric measure and treats an unknown value (no bank
 * distance, no published action rate) as worse than a known one in *both*
 * directions — a `—` must never sort above a real number. The tie-break that
 * makes the order total is page-specific, so it is passed in.
 */

import { useState } from "react";

export interface SortState<K extends string> {
  sortKey: K;
  descending: boolean;
  /** Same column flips the direction; a new column starts descending. */
  toggle: (key: K) => void;
}

export function useSort<K extends string>(
  initialKey: K,
  initialDescending = true,
): SortState<K> {
  const [sortKey, setSortKey] = useState<K>(initialKey);
  const [descending, setDescending] = useState(initialDescending);

  return {
    sortKey,
    descending,
    toggle: (key: K) => {
      if (key === sortKey) {
        setDescending((current) => !current);
      } else {
        setSortKey(key);
        setDescending(true);
      }
    },
  };
}

/**
 * Sort by a numeric measure with unknown values last.
 *
 * `tieBreak` runs whenever the measures are equal (including both unknown), so
 * the caller can keep its order total and deterministic.
 */
export function sortByMeasure<T>(
  rows: readonly T[],
  measure: (row: T) => number | null,
  descending: boolean,
  tieBreak?: (a: T, b: T) => number,
): T[] {
  return [...rows].sort((a, b) => {
    const aValue = measure(a);
    const bValue = measure(b);

    if (aValue === null || bValue === null) {
      if (aValue !== bValue) {
        // Unknown is never better than known, whichever way the column sorts.
        return aValue === null ? 1 : -1;
      }
    } else if (aValue !== bValue) {
      return descending ? bValue - aValue : aValue - bValue;
    }

    return tieBreak === undefined ? 0 : tieBreak(a, b);
  });
}
