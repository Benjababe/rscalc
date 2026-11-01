// @vitest-environment jsdom
/**
 * The shared results table: columns, sorting and the native column toggle.
 *
 * These tests are about the table's own responsibilities, because that is what the
 * pages delegate now — a page declares columns and stops thinking about visibility,
 * widths, `aria-sort`, the rank column or where the picker lives.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';

import { DataTable, type DataColumn } from '../web/src/DataTable.js';
import type { PagedRows } from '../web/src/paging.js';

interface Row {
  id: string;
  name: string;
  profit: number;
}

const ROWS: Row[] = [
  { id: 'a', name: 'Silk', profit: 10 },
  { id: 'b', name: 'Cake', profit: -5 },
];

function paged(rows: Row[]): PagedRows<Row> {
  return {
    total: rows.length,
    page: 1,
    pageCount: 1,
    start: rows.length === 0 ? 0 : 1,
    end: rows.length,
    pageSize: 100,
    pageRows: rows,
    setPage: () => undefined,
    setPageSize: () => undefined,
  };
}

function columns(): DataColumn<Row>[] {
  return [
    {
      key: 'name',
      label: 'Item',
      width: 200,
      required: true,
      sortKey: 'itemName',
      cell: (row) => row.name,
    },
    {
      key: 'profit',
      label: 'Profit',
      width: 90,
      sortKey: 'profit',
      align: 'right',
      cell: (row) => row.profit,
    },
  ];
}

function renderTable(overrides: {
  columns?: DataColumn<Row>[];
  allColumns?: DataColumn<Row>[];
  rows?: Row[];
  sortKey?: string;
  tableId?: string;
  onToggle?: (key: string) => void;
} = {}): { onToggle: (key: string) => void } {
  const onToggle = vi.fn();
  const cols = overrides.columns ?? columns();
  render(
    <DataTable<Row>
      tableId={overrides.tableId ?? 'test-table'}
      label="Test rows"
      caption="Test rows, ranked by profit"
      noun="rows"
      columns={cols}
      allColumns={overrides.allColumns}
      paged={paged(overrides.rows ?? ROWS)}
      sort={{
        key: overrides.sortKey ?? 'profit',
        descending: true,
        toggle: overrides.onToggle ?? onToggle,
      }}
      rowKey={(row) => row.id}
      rank
      emptyText="Nothing here."
      onClearFilters={() => undefined}
    />,
  );
  return { onToggle: overrides.onToggle ?? onToggle };
}

function headers(): string[] {
  // The active sort header carries an arrow glyph inside its button.
  return [...document.querySelectorAll('thead th')].map((cell) =>
    (cell.textContent ?? '').replace(/[▾▴]/g, '').trim(),
  );
}

function footerColumnsButton(): HTMLElement | null {
  // The picker must live in the table's own bar, not in the page toolbar.
  const bar = document.querySelector('.result-bar');
  return bar === null ? null : within(bar as HTMLElement).queryByText('Columns');
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe('DataTable', () => {
  it('renders the rank column, the declared headers and a row per item', () => {
    renderTable();

    expect(headers()).toEqual(['#', 'Item', 'Profit']);
    expect(document.querySelectorAll('tbody tr')).toHaveLength(2);
    // The rank is numbered from the start of the whole list, not the page.
    expect(document.querySelector('tbody tr td')?.textContent).toBe('1');
  });

  it('marks the sorted header and leaves the others alone', () => {
    renderTable({ sortKey: 'profit' });

    const cells = [...document.querySelectorAll('thead th')];
    expect(cells[1]?.getAttribute('aria-sort')).toBe('none');
    expect(cells[2]?.getAttribute('aria-sort')).toBe('descending');
  });

  it('toggles a sort key when its header is clicked', () => {
    const { onToggle } = renderTable();

    const button = within(document.querySelectorAll('thead th')[1] as HTMLElement).getByRole(
      'button',
    );
    fireEvent.click(button);
    expect(onToggle).toHaveBeenCalledWith('itemName');
  });

  it('offers the column picker natively, in the result bar', () => {
    renderTable();
    expect(footerColumnsButton()).not.toBeNull();
  });

  it('hides a column when it is unchecked and never the required one', () => {
    renderTable();

    const picker = footerColumnsButton()?.closest('details');
    if (picker === null || picker === undefined) throw new Error('no picker');
    const options = [...picker.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')];
    // `Item` is required, `Profit` is not.
    expect(options[0]?.disabled).toBe(true);
    expect(options[1]?.disabled).toBe(false);

    fireEvent.click(options[1] as HTMLInputElement);
    expect(headers()).toEqual(['#', 'Item']);

    fireEvent.click(options[1] as HTMLInputElement);
    expect(headers()).toEqual(['#', 'Item', 'Profit']);
  });

  it('remembers the hidden column for the table id', () => {
    renderTable();
    const picker = footerColumnsButton()?.closest('details');
    if (picker === null || picker === undefined) throw new Error('no picker');
    const profitBox = picker.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')[1];
    fireEvent.click(profitBox as HTMLInputElement);
    cleanup();

    // Remount with the same table id: the stored visibility is reused.
    renderTable({ sortKey: 'profit' });
    expect(headers()).toEqual(['#', 'Item']);

    const restored = footerColumnsButton()?.closest('details');
    const reset =
      restored === null || restored === undefined
        ? null
        : within(restored as HTMLElement).getByText('Show all');
    if (reset !== null) fireEvent.click(reset);
    expect(headers()).toEqual(['#', 'Item', 'Profit']);
  });

  it('keeps the picker listing every column, including hidden modes', () => {
    // A table whose rendered columns are only part of `allColumns` (a mode switch)
    // must still offer the other mode's columns in the picker.
    const extra: DataColumn<Row> = {
      key: 'spare',
      label: 'Spare',
      width: 80,
      cell: () => '—',
    };
    renderTable({ columns: columns(), allColumns: [...columns(), extra] });

    const picker = footerColumnsButton()?.closest('details');
    if (picker === null || picker === undefined) throw new Error('no picker');
    expect(within(picker as HTMLElement).getByText('Spare')).toBeTruthy();
    // But it is not rendered, because it is not in `columns`.
    expect(headers()).toEqual(['#', 'Item', 'Profit']);
  });

  it('shows the empty state with a way back when there are no rows', () => {
    renderTable({ rows: [] });

    expect(screen.getByText('Nothing here.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Clear filters' })).toBeTruthy();
    expect(document.querySelector('table')).toBeNull();
  });
});
