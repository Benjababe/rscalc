/**
 * Shared column visibility for the result tables.
 *
 * Each table declares its columns once with a stable key, label and width. The
 * picker stores the visible keys in localStorage under
 * `rscalc.columns.<table>`; an old or corrupt entry falls back to showing every
 * column. Required columns (the item/output identity) cannot be hidden, and a
 * table never renders with no columns at all.
 */

import { useEffect, useState } from "react";

import { browserStore, type KeyValueStore } from "./storage";

export interface ColumnDef {
  /** Stable key used in storage and in the conditional cell rendering. */
  key: string;
  label: string;
  /** Preferred column width in px. */
  width: number;
  /** Cannot be unchecked; keeps the table meaningful. */
  required?: boolean;
}

export const COLUMNS_STORAGE_PREFIX = "rscalc.columns.";

function allVisible(columns: readonly ColumnDef[]): Set<string> {
  return new Set(columns.map((column) => column.key));
}

/**
 * Parse a stored visible-column list. Unknown keys are dropped, required
 * columns are added back, and an empty result falls back to the first column.
 */
export function parseVisibleColumns(
  raw: string | null,
  columns: readonly ColumnDef[],
): Set<string> {
  const known = allVisible(columns);
  if (raw === null) return known;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return known;
  }
  if (!Array.isArray(parsed)) return known;

  const visible = new Set(
    parsed.filter(
      (key): key is string => typeof key === "string" && known.has(key),
    ),
  );
  for (const column of columns) {
    if (column.required) visible.add(column.key);
  }
  if (visible.size === 0) {
    const fallback = columns.find((column) => column.required) ?? columns[0];
    if (fallback !== undefined) visible.add(fallback.key);
  }
  return visible;
}

/** Serialise in column order so the stored value is deterministic. */
export function serialiseVisibleColumns(
  visible: ReadonlySet<string>,
  columns: readonly ColumnDef[],
): string {
  const keys: string[] = [];
  for (const column of columns) {
    if (visible.has(column.key)) keys.push(column.key);
  }
  return JSON.stringify(keys);
}

export interface ColumnVisibility {
  visible: Set<string>;
  toggle: (key: string) => void;
  reset: () => void;
}

/**
 * Read and persist the visible-column set for one table.
 *
 * `allColumns` must be a stable module-level array; it is used to validate the
 * stored keys and to restore required columns. The current-mode column list can
 * change (the shop -> GE table has budget and shop column sets); passing the
 * union here keeps hidden columns hidden when the mode changes.
 */
export function useColumnVisibility(
  storageKey: string,
  allColumns: readonly ColumnDef[],
): ColumnVisibility {
  const [store] = useState<KeyValueStore | null>(() => browserStore());
  const [visible, setVisible] = useState<Set<string>>(() => {
    try {
      return parseVisibleColumns(
        store?.getItem(COLUMNS_STORAGE_PREFIX + storageKey) ?? null,
        allColumns,
      );
    } catch {
      return allVisible(allColumns);
    }
  });

  useEffect(() => {
    if (store === null) return;
    try {
      store.setItem(
        COLUMNS_STORAGE_PREFIX + storageKey,
        serialiseVisibleColumns(visible, allColumns),
      );
    } catch {
      // Private mode or a full quota: the table still works without persistence.
    }
  }, [visible, store, storageKey, allColumns]);

  function toggle(key: string): void {
    const column = allColumns.find((candidate) => candidate.key === key);
    if (column === undefined || column.required) return;
    setVisible((previous) => {
      const next = new Set(previous);
      if (next.has(key)) {
        next.delete(key);
        // Never leave the table with no columns.
        if (next.size === 0) return previous;
      } else {
        next.add(key);
      }
      return next;
    });
  }

  function reset(): void {
    setVisible(allVisible(allColumns));
  }

  return { visible, toggle, reset };
}

/**
 * The "Columns" dropdown. Required columns are shown checked and disabled.
 */
export function ColumnPicker({
  columns,
  visible,
  onToggle,
  onReset,
}: {
  columns: readonly ColumnDef[];
  visible: ReadonlySet<string>;
  onToggle: (key: string) => void;
  onReset: () => void;
}): JSX.Element {
  return (
    <details className="column-picker">
      <summary className="column-toggle" title="Show or hide table columns">
        Columns
      </summary>
      <div className="column-panel">
        {columns.map((column) => (
          <label
            key={column.key}
            className="toggle column-option"
            title={
              column.required ? "This column is always shown" : undefined
            }
          >
            <input
              type="checkbox"
              checked={visible.has(column.key)}
              disabled={column.required}
              onChange={() => onToggle(column.key)}
            />
            {column.label}
          </label>
        ))}
        <button type="button" className="preset column-reset" onClick={onReset}>
          Show all
        </button>
      </div>
    </details>
  );
}
