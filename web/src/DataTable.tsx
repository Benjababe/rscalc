/**
 * The one results table every page renders.
 *
 * Before this, each page repeated the same four pieces: a `colgroup` that filtered
 * its columns by visibility, a `<thead>` with a `visible.has(...)` guard around
 * every header, a `<tbody>` with the matching guard around every cell, and a
 * `ColumnPicker` wired into its own toolbar. Three pages had the picker, two had a
 * static `COLUMNS` array with no toggle at all, and adding a column meant editing
 * four places in one file.
 *
 * A page now declares its columns once — key, label, width, which sort key it
 * drives, and how to render the cell — and hands them over:
 *
 *   const columns: DataColumn<Row>[] = [
 *     { key: 'item', label: 'Item', width: 300, required: true,
 *       sortKey: 'itemName', cell: (row) => <ItemCell row={row} /> },
 *     ...
 *   ];
 *
 *   <DataTable
 *     tableId="shop-to-ge"
 *     columns={columns}
 *     rows={pageRows}
 *     paged={paged}
 *     sort={{ key: sortKey, descending, toggle: toggleSort }}
 *     ...
 *   />
 *
 * and the table owns the rest: visibility (persisted per `tableId`), the Columns
 * picker in its own bar, the caption, the widths, the sortable headers with
 * `aria-sort`, the rank column, the row count, the pager and the empty state.
 *
 * Two rules are inherited from the old `columns.tsx`:
 *  - a table never renders with no columns: a `required` column cannot be hidden
 *    and an empty stored set falls back to the required one;
 *  - a mode-switching table passes `allColumns` (the union of both modes' columns)
 *    so hiding a column in one mode does not silently unhide it in the other.
 */

import type { ReactNode } from "react";

import { ColumnPicker, useColumnVisibility } from "./columns";
import type { ColumnDef } from "./columns";
import type { PagedRows } from "./paging";
import { Results, Th } from "./ui";

/** One column: identity, presentation, and how to render a cell. */
export interface DataColumn<Row> extends ColumnDef {
  /** The sort key this header drives. Omit for a header that is not sortable. */
  sortKey?: string;
  /** Tooltip on the header, including the "click to sort" hint. */
  title?: string;
  /** Right-align both the header and its cells. */
  align?: "right";
  /** Extra classes for the header cell, e.g. a column-specific width class. */
  headerClassName?: string;
  /** Extra classes for the body cells, e.g. `"right mono"`. A function lets a
   * cell's class depend on the row (a positive or negative profit). */
  cellClassName?: string | ((row: Row) => string);
  cell: (row: Row, index: number) => ReactNode;
}

export interface TableSort {
  key: string;
  descending: boolean;
  toggle: (key: string) => void;
}

export interface DataTableProps<Row> {
  /** Storage key for the visible-column set, e.g. `shop-to-ge`. */
  tableId: string;
  /** Accessible name for the scroll region. */
  label: string;
  caption: string;
  /** Plural noun for the row count, e.g. "opportunities". */
  noun: string;
  columns: readonly DataColumn<Row>[];
  /**
   * The union of every column the table can show, for a table whose column set
   * depends on a mode. Defaults to `columns`.
   */
  allColumns?: readonly DataColumn<Row>[];
  paged: PagedRows<Row>;
  sort: TableSort;
  /** Draws a leading `#` column numbered from the first row of the whole list. */
  rank?: boolean;
  rowKey: (row: Row) => string;
  emptyText: ReactNode;
  onClearFilters: () => void;
  busy?: boolean;
}

export function DataTable<Row>(props: DataTableProps<Row>): JSX.Element {
  // `allColumns` is what the stored visibility is validated against: a mode switch
  // must not look like "these keys are unknown, show everything again".
  const allColumns = props.allColumns ?? props.columns;
  const { visible, toggle, reset } = useColumnVisibility(props.tableId, allColumns);

  const shown = props.columns.filter((column) => visible.has(column.key));
  const rank = props.rank === true;

  return (
    <Results
      label={props.label}
      noun={props.noun}
      paged={props.paged}
      busy={props.busy}
      emptyText={props.emptyText}
      onClearFilters={props.onClearFilters}
      tools={
        <ColumnPicker
          columns={allColumns}
          visible={visible}
          onToggle={toggle}
          onReset={reset}
        />
      }
    >
      <table className="results-table">
        <caption className="visually-hidden">{props.caption}</caption>
        <colgroup>
          {rank && <col className="num-col" style={{ width: 44 }} />}
          {shown.map((column) => (
            <col
              key={column.key}
              className={column.headerClassName}
              style={{ width: column.width }}
            />
          ))}
        </colgroup>
        <thead>
          <tr>
            {rank && (
              <th scope="col" className="num-col">
                #
              </th>
            )}
            {shown.map((column) =>
              column.sortKey === undefined ? (
                <th
                  key={column.key}
                  scope="col"
                  className={column.headerClassName}
                  title={column.title}
                >
                  {column.label}
                </th>
              ) : (
                <Th
                  key={column.key}
                  label={column.label}
                  onClick={() => props.sort.toggle(column.sortKey ?? "")}
                  active={props.sort.key === column.sortKey}
                  desc={props.sort.descending}
                  right={column.align === "right"}
                  title={column.title}
                />
              ),
            )}
          </tr>
        </thead>
        <tbody>
          {props.paged.pageRows.map((row, index) => (
            <tr key={props.rowKey(row)}>
              {rank && (
                <td className="right mono dim">{props.paged.start + index}</td>
              )}
              {shown.map((column) => (
                <td
                  key={column.key}
                  className={
                    typeof column.cellClassName === "function"
                      ? column.cellClassName(row)
                      : column.cellClassName
                  }
                >
                  {column.cell(row, index)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </Results>
  );
}
