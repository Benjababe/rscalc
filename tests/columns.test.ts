import { describe, expect, it } from 'vitest';

import {
  parseVisibleColumns,
  serialiseVisibleColumns,
  type ColumnDef,
} from '../web/src/columns.js';

const COLUMNS: readonly ColumnDef[] = [
  { key: 'item', label: 'Item', width: 100, required: true },
  { key: 'shop', label: 'Shop', width: 100 },
  { key: 'profit', label: 'Profit', width: 100 },
];

describe('parseVisibleColumns', () => {
  it('shows every column when nothing is stored', () => {
    expect([...parseVisibleColumns(null, COLUMNS)]).toEqual([
      'item',
      'shop',
      'profit',
    ]);
  });

  it('falls back to every column for corrupt storage', () => {
    expect([...parseVisibleColumns('not json', COLUMNS)]).toEqual([
      'item',
      'shop',
      'profit',
    ]);
    expect([...parseVisibleColumns('{"item":true}', COLUMNS)]).toEqual([
      'item',
      'shop',
      'profit',
    ]);
  });

  it('drops unknown keys and restores required columns', () => {
    const visible = parseVisibleColumns(
      JSON.stringify(['shop', 'removed-column']),
      COLUMNS,
    );
    expect([...visible].sort()).toEqual(['item', 'shop']);
  });

  it('never returns an empty set', () => {
    expect([...parseVisibleColumns(JSON.stringify([]), COLUMNS)]).toEqual([
      'item',
    ]);
  });
});

describe('serialiseVisibleColumns', () => {
  it('stores visible keys in column order', () => {
    expect(
      serialiseVisibleColumns(new Set(['profit', 'item']), COLUMNS),
    ).toBe('["item","profit"]');
  });

  it('drops keys that no longer exist', () => {
    expect(
      serialiseVisibleColumns(
        new Set(['item', 'removed-column']),
        COLUMNS,
      ),
    ).toBe('["item"]');
  });
});
