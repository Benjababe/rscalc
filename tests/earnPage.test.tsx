// @vitest-environment jsdom
/**
 * Rendering tests for the gp-earning leaderboard.
 *
 * These pin the behaviour that is easy to break without noticing: the default
 * ranking, the method-family filter, the search box, a header click re-sorting,
 * the deep links back to the detail pages, and the honesty line that reports
 * what could not be ranked. The numbers themselves are covered by
 * `tests/earnings.test.ts`.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';

import { EarnPage } from '../web/src/Earn.js';

function rows(): HTMLElement[] {
  return [...document.querySelectorAll('tbody tr')] as HTMLElement[];
}

function rowNames(): string[] {
  return rows().map(
    (row) => row.querySelector('td.item')?.textContent?.trim() ?? '',
  );
}

function kindBadges(): string[] {
  return rows().map(
    (row) => row.querySelector('.kind-badge')?.textContent?.trim() ?? '',
  );
}

function searchBox(): HTMLInputElement {
  return screen.getByRole<HTMLInputElement>('searchbox');
}

/** The "gp / hour" column, in row order, as numbers. */
function hourlyRates(): number[] {
  return rows().map((row) => {
    const cells = [...row.querySelectorAll('td')];
    // #, method, type, where, gp/hour, ...
    return Number(cells[4]?.textContent?.replace(/[^0-9]/g, '') ?? '0');
  });
}

beforeEach(() => {
  window.localStorage.clear();
  window.history.replaceState(null, '', '/');
});

afterEach(() => {
  cleanup();
});

describe('Earn page', () => {
  it('renders a ranked page of money makers', async () => {
    render(<EarnPage />);

    await waitFor(() => expect(rows().length).toBeGreaterThan(0));

    expect(rows().length).toBe(100);
    expect(rowNames()[0]).toBeTruthy();

    // Descending by gp/hour by default.
    const rates = hourlyRates();
    for (let i = 1; i < rates.length; i += 1) {
      expect(rates[i]).toBeLessThanOrEqual(rates[i - 1] ?? 0);
    }
  });

  it('shows all three method families in one list by default', async () => {
    render(<EarnPage />);
    await waitFor(() => expect(rows().length).toBe(100));

    const kinds = new Set(kindBadges());
    expect(kinds.size).toBeGreaterThan(1);
    for (const kind of kinds) {
      expect(['Shop run', 'Sell to shop', 'Processing']).toContain(kind);
    }
  });

  it('narrows to one method family', async () => {
    render(<EarnPage />);
    await waitFor(() => expect(rows().length).toBe(100));

    fireEvent.click(screen.getByRole('button', { name: 'Processing' }));

    await waitFor(() => expect(kindBadges().length).toBeGreaterThan(0));
    expect(kindBadges().every((kind) => kind === 'Processing')).toBe(true);
  });

  it('filters by item, shop or input', async () => {
    render(<EarnPage />);
    await waitFor(() => expect(rows().length).toBe(100));

    fireEvent.change(searchBox(), { target: { value: 'astral' } });

    await waitFor(() =>
      expect(
        rows().every((row) =>
          row.textContent?.toLowerCase().includes('astral'),
        ),
      ).toBe(true),
    );
    expect(rows().length).toBeLessThan(100);
  });

  it('re-sorts on a header click and reports aria-sort', async () => {
    render(<EarnPage />);
    await waitFor(() => expect(rows().length).toBe(100));

    const capitalHeader = screen
      .getAllByRole('columnheader')
      .find((header) => header.textContent?.trim().startsWith('Capital'));
    expect(capitalHeader).toBeTruthy();

    fireEvent.click(within(capitalHeader as HTMLElement).getByRole('button'));
    await waitFor(() =>
      expect(capitalHeader?.getAttribute('aria-sort')).toBe('descending'),
    );

    const sorted = screen
      .getAllByRole('columnheader')
      .filter((header) =>
        ['ascending', 'descending'].includes(
          header.getAttribute('aria-sort') ?? '',
        ),
      );
    expect(sorted).toHaveLength(1);
    expect(sorted[0]).toBe(capitalHeader);
  });

  it('links each row to the calculator that explains it', async () => {
    render(<EarnPage />);
    await waitFor(() => expect(rows().length).toBe(100));

    const link = rows()[0]?.querySelector('td.item a');
    const href = link?.getAttribute('href') ?? '';
    expect(href.startsWith('#/')).toBe(true);
    expect(href).toContain('q=');
  });

  it('carries the price mode into the detail link', async () => {
    render(<EarnPage />);
    await waitFor(() => expect(rows().length).toBe(100));

    fireEvent.click(screen.getByRole('button', { name: 'Patient (GE high)' }));

    await waitFor(() => {
      const href = rows()[0]?.querySelector('td.item a')?.getAttribute('href');
      expect(href).toContain('mode=patient');
    });
  });

  it('reports what could not be ranked instead of hiding it', async () => {
    render(<EarnPage />);
    await waitFor(() => expect(rows().length).toBe(100));

    expect(screen.getByText(/not ranked because the wiki data/i)).toBeTruthy();
    expect(screen.getByText(/Nothing is estimated to fill the gap/i)).toBeTruthy();
  });

  it('shows an empty state with a working clear-filters button', async () => {
    render(<EarnPage />);
    await waitFor(() => expect(rows().length).toBe(100));

    fireEvent.change(searchBox(), { target: { value: 'zzzzzzzz' } });

    const panel = await screen.findByText(
      'No method earns at this gold with these filters. Try clearing the method filter, lowering your gold, or raising Max worlds.',
    );
    expect(rows()).toHaveLength(0);

    fireEvent.click(
      within(panel.parentElement as HTMLElement).getByRole('button'),
    );

    await waitFor(() => expect(rows().length).toBe(100));
    expect(searchBox().value).toBe('');
  });
});
