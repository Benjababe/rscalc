// @vitest-environment jsdom
/**
 * Rendering tests for the shared controls.
 *
 * The page test covers filtering, sorting and paging against real data. These
 * cover the pieces it cannot reach cheaply: the gold field's shorthand, the
 * copy-link feedback, and the `/` shortcut's guard against stealing keys from a
 * field the player is already typing in.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import { useState } from 'react';

import { CopyLink } from '../web/src/CopyLink.js';
import { GoldInput } from '../web/src/GoldInput.js';
import { FilterToolbar } from '../web/src/FilterToolbar.js';
import { ThemeToggle } from '../web/src/ThemeToggle.js';
import { THEME_STORAGE_KEY, parseTheme } from '../web/src/theme.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('GoldInput', () => {
  function renderGold(onChange = vi.fn()): {
    input: HTMLInputElement;
    onChange: ReturnType<typeof vi.fn>;
  } {
    render(<GoldInput value={1_000_000} onChange={onChange} />);
    return {
      input: screen.getByLabelText<HTMLInputElement>('Gold available'),
      onChange,
    };
  }

  it('shows the current amount with separators', () => {
    expect(renderGold().input.value).toBe('1,000,000');
  });

  it('commits the shorthand while typing', () => {
    const { input, onChange } = renderGold();
    fireEvent.change(input, { target: { value: '2.5m' } });
    expect(onChange).toHaveBeenCalledWith(2_500_000);
  });

  it('leaves the draft alone so the field does not fight the player', () => {
    const { input } = renderGold();
    fireEvent.change(input, { target: { value: '2.5m' } });
    expect(input.value).toBe('2.5m');
  });

  it('does not commit text it cannot read', () => {
    const { input, onChange } = renderGold();
    fireEvent.change(input, { target: { value: 'abc' } });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('restores the committed amount on blur after junk input', () => {
    const { input } = renderGold();
    fireEvent.change(input, { target: { value: '9z9' } });
    fireEvent.blur(input);
    expect(input.value).toBe('1,000,000');
  });
});

describe('CopyLink', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/#/ge-to-shop?q=rune');
  });

  function stubClipboard(writeText: (text: string) => Promise<void>): void {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
  }

  afterEach(() => {
    // Remove the own property so the prototype getter applies again.
    Reflect.deleteProperty(navigator, 'clipboard');
  });

  it('copies the current URL and reports success', async () => {
    const written: string[] = [];
    stubClipboard((text) => {
      written.push(text);
      return Promise.resolve();
    });

    render(<CopyLink />);
    fireEvent.click(screen.getByRole('button'));

    await screen.findByText('Copied');
    expect(written).toEqual([window.location.href]);
    expect(window.location.href).toContain('q=rune');
  });

  it('reports a refused clipboard instead of failing silently', async () => {
    stubClipboard(() => Promise.reject(new Error('denied')));

    render(<CopyLink />);
    fireEvent.click(screen.getByRole('button'));

    await screen.findByText('Copy failed');
  });

  it('copes with no clipboard at all', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: undefined,
    });

    render(<CopyLink />);
    fireEvent.click(screen.getByRole('button'));

    await screen.findByText('Copy failed');
  });
});

describe('the / shortcut', () => {
  /** The toolbar owns the shortcut; render it with no chips and read the input. */
  function renderToolbar(): HTMLInputElement {
    render(
      <FilterToolbar
        modeGroupLabel="Sell mode"
        modes={[{ id: 'pessimistic', label: 'Instant' }]}
        mode="pessimistic"
        onMode={() => {}}
        query=""
        onQuery={() => {}}
        placeholder="Filter"
        searchLabel="Filter"
        pricesAsOf="2026-11-01T00:00:00.000Z"
        generatedAt="2026-11-01T00:00:00.000Z"
        filtersActive={false}
        onClearFilters={() => {}}
      >
        <span />
      </FilterToolbar>,
    );
    return screen.getByRole<HTMLInputElement>('searchbox');
  }

  it('moves focus to the search box from the page body', () => {
    const input = renderToolbar();
    expect(document.activeElement).not.toBe(input);

    fireEvent.keyDown(document.body, { key: '/' });

    expect(document.activeElement).toBe(input);
  });

  it('does not steal the key while the player is typing in a field', () => {
    const input = renderToolbar();
    const number = document.createElement('input');
    number.type = 'number';
    document.body.append(number);
    number.focus();

    fireEvent.keyDown(number, { key: '/' });

    expect(document.activeElement).toBe(number);
    expect(document.activeElement).not.toBe(input);
    number.remove();
  });

  it('leaves Ctrl+K working and a bare k alone', () => {
    const input = renderToolbar();

    fireEvent.keyDown(document.body, { key: 'k' });
    expect(document.activeElement).not.toBe(input);

    fireEvent.keyDown(document.body, { key: 'k', ctrlKey: true });
    expect(document.activeElement).toBe(input);
  });
});

describe('ThemeToggle', () => {
  /** The header owns the theme state; this mirrors what `App` does. */
  function Harness(): JSX.Element {
    const [theme, setTheme] = useState<'dark' | 'light'>(
      parseTheme(window.localStorage.getItem(THEME_STORAGE_KEY)),
    );
    function toggle(): void {
      const next = theme === 'dark' ? 'light' : 'dark';
      window.localStorage.setItem(THEME_STORAGE_KEY, next);
      document.documentElement.dataset['theme'] = next;
      setTheme(next);
    }
    return <ThemeToggle theme={theme} onToggle={toggle} />;
  }

  beforeEach(() => {
    window.localStorage.clear();
    delete document.documentElement.dataset['theme'];
  });

  it('opens dark, so the light state is not pressed', () => {
    render(<Harness />);
    const button = screen.getByRole('button', { name: 'Light theme' });
    expect(button.getAttribute('aria-pressed')).toBe('false');
    expect(button.querySelector('svg')?.getAttribute('data-icon')).toBe('moon');
  });

  it('switches to light and remembers it', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Light theme' }));

    expect(document.documentElement.dataset['theme']).toBe('light');
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');
    const button = screen.getByRole('button', { name: 'Light theme' });
    expect(button.getAttribute('aria-pressed')).toBe('true');
    expect(button.querySelector('svg')?.getAttribute('data-icon')).toBe('sun');
  });

  it('switches back to dark', () => {
    render(<Harness />);
    const button = (): HTMLElement =>
      screen.getByRole('button', { name: 'Light theme' });

    fireEvent.click(button());
    fireEvent.click(button());

    expect(document.documentElement.dataset['theme']).toBe('dark');
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
  });
});

describe('parseTheme', () => {
  it('defaults to dark for anything unexpected', () => {
    expect(parseTheme(null)).toBe('dark');
    expect(parseTheme('')).toBe('dark');
    expect(parseTheme('system')).toBe('dark');
    expect(parseTheme('LIGHT')).toBe('dark');
  });

  it('only accepts the stored "light"', () => {
    expect(parseTheme('light')).toBe('light');
    expect(parseTheme('dark')).toBe('dark');
  });
});
