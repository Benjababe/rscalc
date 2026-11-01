import { describe, expect, it } from 'vitest';

import { hoursSince, STALE_SNAPSHOT_HOURS } from '../web/src/format.js';

const NOW = Date.parse('2026-11-01T12:00:00.000Z');

describe('hoursSince', () => {
  it('counts whole hours between the snapshot and now', () => {
    expect(hoursSince('2026-11-01T11:00:00.000Z', NOW)).toBe(1);
    expect(hoursSince('2026-10-31T12:00:00.000Z', NOW)).toBe(24);
    expect(hoursSince('2026-10-30T06:30:00.000Z', NOW)).toBe(53);
  });

  it('floors a partial hour', () => {
    expect(hoursSince('2026-11-01T11:59:00.000Z', NOW)).toBe(0);
    expect(hoursSince('2026-11-01T11:59:59.000Z', NOW)).toBe(0);
  });

  it('reports a future timestamp as negative, never as stale', () => {
    expect(hoursSince('2026-11-01T13:00:00.000Z', NOW)).toBe(-1);
  });

  it('returns null for a timestamp it cannot parse', () => {
    expect(hoursSince('not a date', NOW)).toBeNull();
    expect(hoursSince('', NOW)).toBeNull();
  });

  it('keeps the stale threshold at a day', () => {
    expect(STALE_SNAPSHOT_HOURS).toBe(24);
  });
});
