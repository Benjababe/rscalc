import { describe, expect, it } from 'vitest';
import {
  DEFAULT_GOLD,
  parseBudgetState,
  serialiseBudgetState,
} from '../web/src/storage.js';

const DEFAULTS = { gold: DEFAULT_GOLD, view: 'budget' } as const;

describe('parseBudgetState', () => {
  it('returns defaults for missing or malformed data', () => {
    expect(parseBudgetState(null)).toEqual(DEFAULTS);
    expect(parseBudgetState('not json')).toEqual(DEFAULTS);
    expect(parseBudgetState('null')).toEqual(DEFAULTS);
    expect(parseBudgetState('{}')).toEqual(DEFAULTS);
  });

  it('rejects invalid gold values', () => {
    for (const raw of ['{"gold":"lots"}', '{"gold":-1}', '{"gold":null}']) {
      expect(parseBudgetState(raw).gold).toBe(DEFAULT_GOLD);
    }
  });

  it('floors fractional gold', () => {
    expect(parseBudgetState('{"gold":1234.9}').gold).toBe(1234);
  });

  it('keeps a valid view and falls back on an unknown one', () => {
    expect(parseBudgetState('{"gold":0,"view":"shop"}')).toEqual({
      gold: 0,
      view: 'shop',
    });
    expect(parseBudgetState('{"gold":5000,"view":"budget"}')).toEqual({
      gold: 5000,
      view: 'budget',
    });
    expect(parseBudgetState('{"gold":5000,"view":"wat"}').view).toBe('budget');
  });

  it('round-trips a saved state', () => {
    const state = { gold: 7_500_000, view: 'shop' as const };
    expect(parseBudgetState(serialiseBudgetState(state))).toEqual(state);
  });
});
