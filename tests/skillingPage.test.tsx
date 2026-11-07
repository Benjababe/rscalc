// @vitest-environment jsdom
/**
 * Rendering tests for the skilling page.
 *
 * They pin the decisions the page is built on rather than the numbers (those are
 * covered by `tests/skilling.test.ts` against the artifact):
 *
 *  - it opens in **instant** mode, not patient;
 *  - `kind` is visible and filterable, so a one-off upgrade cannot pass as a
 *    repeatable action;
 *  - **Cooking rows stay hidden until a level is entered**, because below a food's
 *    no-burn level its margin is a gamble, not a number;
 *  - the coverage line reports what could not be priced instead of shrinking
 *    quietly.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';

import { SkillingPage } from '../web/src/Skilling.js';
import { PAGE_ARTIFACTS, loadDataset, resetDataset } from '../web/src/dataset.js';
import { stubDatasetFetch } from './support/datasetFetch.js';

function rows(): HTMLElement[] {
  return [...document.querySelectorAll('tbody tr')] as HTMLElement[];
}

function activityNames(): string[] {
  return rows().map(
    (row) => row.querySelector('td.item a')?.textContent?.trim() ?? '',
  );
}

function kindBadges(): string[] {
  return rows().map(
    (row) => row.querySelector('.kind-badge')?.textContent?.trim() ?? '',
  );
}

function modeButton(label: RegExp): HTMLElement {
  return screen.getByRole('button', { name: label });
}

function cookingLevelInput(): HTMLInputElement {
  return screen.getByRole<HTMLInputElement>('spinbutton', {
    name: 'Cooking level',
  });
}

function actionsPerHourInput(): HTMLInputElement {
  return screen.getByRole<HTMLInputElement>('spinbutton', {
    name: 'Actions per hour',
  });
}

/** The gp/hour cell of every rendered row, as text. */
function hourlyCells(): string[] {
  return rows().map((row) => row.querySelectorAll('td')[7]?.textContent?.trim() ?? '');
}

beforeEach(async () => {
  window.localStorage.clear();
  window.history.replaceState(null, '', '/#/skilling');
  // The page fetches its artifacts from the server now; answer from data/*.json.
  stubDatasetFetch();
  await loadDataset(PAGE_ARTIFACTS['skilling']);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  resetDataset();
});

describe('skilling page', () => {
  it('puts the filters above the coverage strip', () => {
    render(<SkillingPage />);

    const toolbar = document.querySelector('.toolbar');
    const stats = document.querySelector('.stats');
    if (toolbar === null || stats === null) {
      throw new Error('expected a toolbar and a coverage strip');
    }
    // Filters are the first thing on the page; the info boxes sit under them.
    expect(
      toolbar.compareDocumentPosition(stats) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('opens in instant mode', () => {
    render(<SkillingPage />);

    expect(modeButton(/Instant/i).getAttribute('aria-pressed')).toBe('true');
    expect(modeButton(/Patient/i).getAttribute('aria-pressed')).toBe('false');
  });

  it('renders activities with their kind, ranked by gp per hour', () => {
    render(<SkillingPage />);

    expect(rows().length).toBeGreaterThan(0);
    const first = rows()[0];
    if (first === undefined) throw new Error('expected a rendered row');
    expect(within(first).getByText(/Make|Upgrade|Cost/)).toBeTruthy();
    // The default sort is gp/hour descending.
    const rates = rows().map((row) => {
      const cells = [...row.querySelectorAll('td')];
      const text = cells[cells.length - 1]?.textContent ?? '';
      return text === '—' ? null : Number(text.replace(/[^0-9]/g, ''));
    });
    const known = rates.filter((value): value is number => value !== null);
    expect(known.length).toBeGreaterThan(1);
    for (let i = 1; i < known.length; i += 1) {
      expect((known[i - 1] ?? 0) >= (known[i] ?? 0)).toBe(true);
    }
  });

  it('hides cooking rows until a level is entered', () => {
    render(<SkillingPage />);

    // No level: monkfish needs 90 Cooking to stop burning, so it is not priced.
    expect(activityNames().some((name) => name.startsWith('Monkfish'))).toBe(
      false,
    );
    expect(screen.getByText(/hidden because your level is below/i)).toBeTruthy();
  });

  it('prices cooking rows once the level covers their no-burn level', () => {
    render(<SkillingPage />);

    fireEvent.change(cookingLevelInput(), { target: { value: '90' } });

    const skillSelect = screen.getByRole<HTMLSelectElement>('combobox', {
      name: 'Skill filter',
    });
    fireEvent.change(skillSelect, { target: { value: 'Cooking' } });

    const names = activityNames();
    expect(names.some((name) => name.startsWith('Monkfish'))).toBe(true);
    // Every visible cooking row must be safe at 90.
    for (const row of rows()) {
      const cells = [...row.querySelectorAll('td')];
      const levelCell = cells[3]?.textContent ?? '';
      const safe = /safe (\d+)/.exec(levelCell);
      if (safe !== null) expect(Number(safe[1])).toBeLessThanOrEqual(90);
    }
  });

  it('filters by kind, so upgrades are not ranked with repeatable actions', () => {
    render(<SkillingPage />);

    const kindSelect = screen.getByRole<HTMLSelectElement>('combobox', {
      name: 'Kind filter',
    });
    fireEvent.change(kindSelect, { target: { value: 'upgrade' } });

    const badges = new Set(kindBadges());
    expect(badges).toEqual(new Set(['Upgrade']));
  });

  it('switches to the patient ranking', () => {
    render(<SkillingPage />);

    fireEvent.click(modeButton(/Patient/i));

    expect(modeButton(/Patient/i).getAttribute('aria-pressed')).toBe('true');
    expect(modeButton(/Instant/i).getAttribute('aria-pressed')).toBe('false');
  });

  it('matches on inputs as well as outcomes', async () => {
    render(<SkillingPage />);

    fireEvent.change(screen.getByRole('searchbox'), {
      target: { value: 'dragonstone bracelet' },
    });

    // The query is deferred so typing stays responsive; the table follows.
    await waitFor(() => {
      const matching = rows();
      expect(matching.length).toBeGreaterThan(0);
      // Rows that make the bracelet, and rows that consume it as an input.
      const viaOutput = activityNames().filter((name) =>
        /^Dragonstone bracelet/.test(name),
      );
      const viaInput = matching.filter((row) =>
        (row.querySelectorAll('td')[4]?.textContent ?? '').includes(
          'Dragonstone bracelet',
        ),
      );
      expect(viaOutput.length + viaInput.length).toBeGreaterThan(0);
      expect(viaOutput.length).toBeGreaterThan(0);
    });
  });

  it('prices a rate-less row at the actions per hour the player enters', () => {
    render(<SkillingPage />);

    // Fishing publishes no attempt interval, so before the input its row has no rate.
    const skillSelect = screen.getByRole<HTMLSelectElement>('combobox', {
      name: 'Skill filter',
    });
    fireEvent.change(skillSelect, { target: { value: 'Fishing' } });

    expect(hourlyCells().every((cell) => cell.startsWith('—'))).toBe(true);

    fireEvent.change(actionsPerHourInput(), { target: { value: '400' } });

    const priced = hourlyCells().filter((cell) => cell !== '—');
    expect(priced.length).toBeGreaterThan(0);
    // Marked as the player's own figure, never as a sourced one.
    expect(rows().some((row) => row.textContent?.includes('your rate'))).toBe(true);
    expect(screen.getByText(/priced at your/i)).toBeTruthy();
  });

  it('leaves rows with a published rate on the wiki figure', () => {
    render(<SkillingPage />);

    const skillSelect = screen.getByRole<HTMLSelectElement>('combobox', {
      name: 'Skill filter',
    });
    fireEvent.change(skillSelect, { target: { value: 'Smithing' } });

    const before = hourlyCells();
    fireEvent.change(actionsPerHourInput(), { target: { value: '600' } });

    expect(hourlyCells()).toEqual(before);
    expect(rows().some((row) => row.textContent?.includes('your rate'))).toBe(false);
  });

  it('names the facility, so a minigame row is identifiable and searchable', () => {
    render(<SkillingPage />);

    fireEvent.change(screen.getByRole('searchbox'), {
      target: { value: 'blast furnace' },
    });

    const names = activityNames();
    expect(names.length).toBeGreaterThan(0);
    // Every hit is a smithing bar priced at the Blast Furnace, and says so.
    for (const row of rows()) {
      expect(row.textContent).toContain('at Blast Furnace');
      expect(row.textContent).toContain('Smithing');
    }
    expect(names.some((name) => name.startsWith('Steel bar'))).toBe(true);
  });

  it('lists every skill with its row count, including a cost-only one', () => {
    render(<SkillingPage />);

    const skillSelect = screen.getByRole<HTMLSelectElement>('combobox', {
      name: 'Skill filter',
    });
    const options = [...skillSelect.options].map((option) => option.textContent ?? '');

    // Alphabetical, not scan order and not by row count: the two are easy to confuse
    // because the artifact's scan order roughly follows size.
    const names = options
      .filter((label) => label !== 'All skills' && label.includes('('))
      .map((label) => label.replace(/\s*\(.*\)$/, ''));
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));

    // Sailing prices no income at all — every row is a training cost — so without a
    // count it looks absent from a list sorted by gp/hour.
    const sailing = options.find((label) => label.startsWith('Sailing ('));
    expect(sailing).toBeTruthy();
    expect(sailing).not.toBe('Sailing (0)');
    expect(options.some((label) => label.startsWith('Smithing ('))).toBe(true);

    fireEvent.change(skillSelect, { target: { value: 'Sailing' } });
    expect(rows().length).toBeGreaterThan(0);
    for (const row of rows()) {
      expect(row.textContent).toContain('Sailing');
      expect(within(row).getByText('Cost')).toBeTruthy();
    }
  });

  it('states what could not be priced', () => {
    render(<SkillingPage />);

    expect(screen.getByText('Unpriced')).toBeTruthy();
    // The caveats live in a <details>, where they are still in the document.
    expect(
      screen.getByText(/High-alch and shop sale are not\s+modelled/i),
    ).toBeTruthy();
  });
});
