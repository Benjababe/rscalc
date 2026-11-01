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

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';

import { SkillingPage } from '../web/src/Skilling.js';

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

beforeEach(() => {
  window.localStorage.clear();
  window.history.replaceState(null, '', '/#/skilling');
});

afterEach(() => {
  cleanup();
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

  it('states what could not be priced', () => {
    render(<SkillingPage />);

    expect(screen.getByText('Unpriced')).toBeTruthy();
    // The caveats live in a <details>, where they are still in the document.
    expect(
      screen.getByText(/High-alch and shop sale are not\s+modelled/i),
    ).toBeTruthy();
  });
});
