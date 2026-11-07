// @vitest-environment jsdom
/**
 * Rendering tests for the Shop -> GE page.
 *
 * These pin the behaviour that is easy to break without noticing: a filter
 * hiding rows, a header click re-sorting and reporting `aria-sort`, the column
 * picker from storage, and the empty state offering a way back. Everything the
 * numbers are computed from is covered by the engine tests; this file is about
 * whether those numbers reach the DOM.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

import { readFileSync } from 'node:fs';

import { z } from 'zod';

import { RankingSchema } from '../src/types.js';
import { ShopToGePage } from '../web/src/ShopToGe.js';
import { PAGE_ARTIFACTS, loadDataset, resetDataset } from '../web/src/dataset.js';
import { stubDatasetFetch } from './support/datasetFetch.js';

/**
 * The artifact's two rankings, validated the same way the refresh script validates
 * them, so the row total can be asserted without hard-coding a number that moves
 * whenever the market data is refreshed. `JSON.parse` is `any`, so it goes straight
 * into zod rather than being read by hand.
 */
const ARTIFACT = z
  .object({ pessimistic: RankingSchema, patient: RankingSchema })
  .parse(JSON.parse(readFileSync('data/opportunities.json', 'utf8')));
const RANKING = ARTIFACT.pessimistic;

/** Rows currently in the table body. */
function rows(): HTMLElement[] {
  return [...document.querySelectorAll('tbody tr')] as HTMLElement[];
}

/** The item name shown in each row, in order. */
function rowNames(): string[] {
  return rows().map(
    (row) => row.querySelector('td.item')?.textContent?.trim() ?? '',
  );
}

function searchBox(): HTMLInputElement {
  return screen.getByRole<HTMLInputElement>('searchbox');
}

beforeEach(async () => {
  window.localStorage.clear();
  window.history.replaceState(null, '', '/');
  // The page fetches its artifacts from the server now; answer from data/*.json.
  stubDatasetFetch();
  await loadDataset(PAGE_ARTIFACTS['shop-to-ge']);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  resetDataset();
});

describe('Shop -> GE page', () => {
  it('renders a ranked page of opportunities', async () => {
    render(<ShopToGePage />);

    await waitFor(() => expect(rows().length).toBeGreaterThan(0));

    // One page of results, with the range spelled out above the table. The total
    // comes from the artifact rather than a literal: the snapshot moves whenever
    // the market data is refreshed, and a hard-coded count fails for no real reason.
    expect(rows().length).toBe(100);
    const total = RANKING.opportunities.length;
    // Read the count line directly: a `new RegExp` built from a number is avoidable
    // noise, and the element is stable.
    expect(document.querySelector('.result-count')?.textContent).toContain(
      `of ${total.toLocaleString()} opportunities`,
    );
    expect(rowNames()[0]).toBeTruthy();
  });

  it('hides rows that do not match the filter', async () => {
    render(<ShopToGePage />);
    await waitFor(() => expect(rows().length).toBe(100));

    fireEvent.change(searchBox(), { target: { value: 'astral' } });

    await waitFor(() => expect(rows().length).toBeLessThan(100));
    expect(rowNames().every((name) => name.toLowerCase().includes('astral'))).toBe(
      true,
    );
  });

  it('shows an empty state with a working clear-filters button', async () => {
    render(<ShopToGePage />);
    await waitFor(() => expect(rows().length).toBe(100));

    fireEvent.change(searchBox(), { target: { value: 'zzzzzzzz' } });

    const panel = await screen.findByText('No opportunities match these filters.');
    expect(rows()).toHaveLength(0);

    fireEvent.click(within(panel.parentElement as HTMLElement).getByRole('button'));

    await waitFor(() => expect(rows().length).toBe(100));
    expect(searchBox().value).toBe('');
  });

  it('re-sorts on a header click and reports aria-sort', async () => {
    render(<ShopToGePage />);
    await waitFor(() => expect(rows().length).toBe(100));

    const firstBefore = rowNames()[0];

    const marginHeader = screen
      .getAllByRole('columnheader')
      .find((header) => header.textContent?.trim().startsWith('Margin'));
    expect(marginHeader).toBeTruthy();

    // First click sorts by the new column, descending.
    fireEvent.click(within(marginHeader as HTMLElement).getByRole('button'));
    await waitFor(() =>
      expect(marginHeader?.getAttribute('aria-sort')).toBe('descending'),
    );
    const afterFirst = rowNames()[0];
    expect(afterFirst).not.toBe(firstBefore);

    // Clicking the same header flips the direction.
    fireEvent.click(within(marginHeader as HTMLElement).getByRole('button'));
    await waitFor(() =>
      expect(marginHeader?.getAttribute('aria-sort')).toBe('ascending'),
    );
    expect(rowNames()[0]).not.toBe(afterFirst);

    // Exactly one column is sorted at a time. Non-sortable headers carry no
    // aria-sort at all, so only the two sorted states count.
    const sorted = screen
      .getAllByRole('columnheader')
      .filter((header) =>
        ['ascending', 'descending'].includes(header.getAttribute('aria-sort') ?? ''),
      );
    expect(sorted).toHaveLength(1);
    expect(sorted[0]).toBe(marginHeader);
  });

  it('hides a column through the picker', async () => {
    render(<ShopToGePage />);
    await waitFor(() => expect(rows().length).toBe(100));

    const headersBefore = screen.getAllByRole('columnheader').length;
    expect(
      screen.queryByRole('columnheader', { name: 'Tax' }),
    ).toBeTruthy();

    const taxToggle = screen.getByRole('checkbox', { name: 'Tax' });
    fireEvent.click(taxToggle);

    await waitFor(() =>
      expect(screen.getAllByRole('columnheader')).toHaveLength(headersBefore - 1),
    );
    expect(screen.queryByRole('columnheader', { name: 'Tax' })).toBeNull();
  });

  it('keeps the column picker in the table bar, not the filter toolbar', async () => {
    render(<ShopToGePage />);
    await waitFor(() => expect(rows().length).toBe(100));

    const summary = screen.getByText('Columns');
    expect(summary.closest('.result-bar')).not.toBeNull();
    expect(summary.closest('.toolbar')).toBeNull();
  });

  it('remembers a hidden column across a table whose columns change by mode', async () => {
    // The budget view and the shop view show different columns. Hiding one in the
    // budget view must survive a trip through the shop view and back, which is what
    // the table's `allColumns` union is for.
    render(<ShopToGePage />);
    await waitFor(() => expect(rows().length).toBe(100));

    // Entering gold turns on the gold-sized view (the switch is disabled at 0 gp).
    fireEvent.click(screen.getByRole('button', { name: '10m' }));
    await waitFor(() =>
      expect(screen.queryByRole('columnheader', { name: 'Buy' })).toBeTruthy(),
    );

    fireEvent.click(screen.getByRole('checkbox', { name: 'Buy' }));
    await waitFor(() =>
      expect(screen.queryByRole('columnheader', { name: 'Buy' })).toBeNull(),
    );

    const budgetSwitch = screen.getByRole<HTMLInputElement>('checkbox', {
      name: 'Size buys to gold',
    });
    // Shop view: the budget columns are gone and the per-visit ones appear.
    fireEvent.click(budgetSwitch);
    await waitFor(() =>
      expect(
        screen.queryByRole('columnheader', { name: /Qty . visit/ }),
      ).toBeTruthy(),
    );

    // Back to the budget view: the hidden column is still hidden.
    fireEvent.click(budgetSwitch);
    await waitFor(() =>
      expect(
        screen.queryByRole('columnheader', { name: 'Qty / visit' }),
      ).toBeNull(),
    );
    expect(screen.queryByRole('columnheader', { name: 'Buy' })).toBeNull();
  });

  it('pages through the results without repeating a row', async () => {
    render(<ShopToGePage />);
    await waitFor(() => expect(rows().length).toBe(100));

    const firstPageFirst = rowNames()[0];
    const firstPageLast = rowNames()[99];

    fireEvent.click(screen.getByRole('button', { name: 'Next ›' }));

    await waitFor(() => expect(screen.getByText(/^101–200/)).toBeTruthy());
    expect(rows().length).toBe(100);
    expect(rowNames()[0]).not.toBe(firstPageFirst);
    expect(rowNames()[0]).not.toBe(firstPageLast);
    // Row numbering continues across pages rather than restarting at 1.
    expect(rows()[0]?.querySelector('td')?.textContent?.trim()).toBe('101');
  });

  it('switches the 4h window for the rest window when Overnight is on', async () => {
    render(<ShopToGePage />);
    await waitFor(() => expect(rows().length).toBe(100));

    // The default view is the 4h model.
    expect(screen.queryByRole('columnheader', { name: '4h volume' })).toBeTruthy();
    expect(
      screen.queryByRole('columnheader', { name: 'Rest units' }),
    ).toBeNull();

    fireEvent.click(screen.getByRole('checkbox', { name: 'Overnight' }));

    await waitFor(() =>
      expect(
        screen.queryByRole('columnheader', { name: 'Rest units' }),
      ).toBeTruthy(),
    );
    expect(screen.queryByRole('columnheader', { name: '4h volume' })).toBeNull();
    // The hint names both knobs, so the assumption is never implicit.
    const hint = document.querySelector('.budget .hint')?.textContent ?? '';
    expect(hint).toContain('Overnight');
    expect(hint).toContain('60 min');
    expect(hint).toContain('12h');
    // The session and rest fields are enabled now.
    expect(
      screen.getByRole<HTMLInputElement>('spinbutton', {
        name: 'Shopping session in minutes',
      }).disabled,
    ).toBe(false);
  });

  it('sizes an overnight run from the rest window, not the 4h slice', async () => {
    window.localStorage.setItem(
      'rscalc.budget',
      JSON.stringify({ gold: 100_000_000, view: 'budget' }),
    );
    const name = RANKING.opportunities[0]?.itemName ?? '';
    window.history.replaceState(
      null,
      '',
      `/#/shop-to-ge?q=${encodeURIComponent(name)}`,
    );

    render(<ShopToGePage />);
    await waitFor(() => expect(rows().length).toBeGreaterThan(0));

    // The Buy cell is the unit count followed by a "N/world" note in its own
    // span; only the leading text node is the quantity.
    const buyCell = (): number => {
      // With the rank column: #, item, shop, location, unit cost, sell, tax,
      // margin, volume/rest units, then Buy.
      const cell = rows()[0]?.querySelector('td:nth-child(10)');
      const text = cell?.firstChild?.textContent ?? '0';
      return Number(text.replace(/[^0-9]/g, ''));
    };
    const fourHourUnits = buyCell();

    fireEvent.click(screen.getByRole('checkbox', { name: 'Overnight' }));
    await waitFor(() => expect(buyCell()).toBeGreaterThanOrEqual(fourHourUnits));

    // The resting-offer fill is shown, and it is a duration rather than a number
    // of units, so the row explains where the time went.
    expect(
      screen.getByRole('columnheader', { name: /GE fill/ }),
    ).toBeTruthy();
  });

  it('drops the rest window and the fill when the buyers are unlimited', async () => {
    window.localStorage.setItem(
      'rscalc.budget',
      JSON.stringify({ gold: 100_000_000, view: 'budget' }),
    );
    const item = RANKING.opportunities[0];
    const name = item?.itemName ?? '';
    window.history.replaceState(
      null,
      '',
      `/#/shop-to-ge?q=${encodeURIComponent(name)}`,
    );

    render(<ShopToGePage />);
    await waitFor(() => expect(rows().length).toBeGreaterThan(0));

    fireEvent.click(screen.getByRole('checkbox', { name: 'Overnight' }));
    await waitFor(() =>
      expect(
        screen.queryByRole('columnheader', { name: 'Rest units' }),
      ).toBeTruthy(),
    );

    const restField = (): HTMLInputElement =>
      screen.getByRole<HTMLInputElement>('spinbutton', {
        name: 'Rest window in hours',
      });
    expect(restField().disabled).toBe(false);

    fireEvent.click(screen.getByRole('checkbox', { name: 'Unlimited buyers' }));

    // The rest window stops mattering, so it is disabled rather than left
    // looking like it still does something.
    await waitFor(() => expect(restField().disabled).toBe(true));
    expect(
      screen.queryByRole('columnheader', { name: 'Buyers' }),
    ).toBeTruthy();
    // The cap column reads the assumption, and the fill column says there is
    // nothing to wait for.
    const rowText = rows()[0]?.textContent ?? '';
    expect(rowText).toContain('∞');
    expect(rowText).toContain('none');
    // The hint names the assumption instead of the window.
    const hint = document.querySelector('.budget .hint')?.textContent ?? '';
    expect(hint).toContain('unlimited buyers');
    expect(hint).toContain('cannot be repeated');
  });

  it('restores the view described by the URL', async () => {
    window.history.replaceState(null, '', '/#/shop-to-ge?q=astral&members=1');

    render(<ShopToGePage />);
    await waitFor(() => expect(rows().length).toBeGreaterThan(0));

    expect(searchBox().value).toBe('astral');
    expect(
      screen.getByRole<HTMLInputElement>('checkbox', { name: 'Members only' })
        .checked,
    ).toBe(true);
    expect(rowNames().every((name) => name.toLowerCase().includes('astral'))).toBe(
      true,
    );
  });
});
