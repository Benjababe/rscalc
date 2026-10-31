import { describe, expect, it } from 'vitest';

import { formatLocalTime } from '../src/util/time.js';

const ISO = '2026-10-31T16:22:58.328Z';

describe('formatLocalTime', () => {
  it('renders the instant in the requested timezone', () => {
    const london = formatLocalTime(ISO, {
      locale: 'en-GB',
      timeZone: 'Europe/London',
    });
    expect(london).toContain('31 Oct 2026');
    expect(london).toContain('16:22:58');
    expect(london).toContain('GMT');

    const newYork = formatLocalTime(ISO, {
      locale: 'en-US',
      timeZone: 'America/New_York',
    });
    expect(newYork).toContain('12:22:58');
    expect(newYork).toContain('EDT');
  });

  it('leaves an unparseable timestamp unchanged', () => {
    expect(formatLocalTime('not a date')).toBe('not a date');
  });
});
