import { describe, expect, it } from 'vitest';
import {
  BUDGET_STORAGE_KEY,
  DEFAULT_GOLD,
  parseBudgetState,
  readStoredBudget,
  serialiseBudgetState,
  writeStoredBudget,
  type KeyValueStore,
} from '../web/src/storage.js';

const DEFAULTS = { gold: DEFAULT_GOLD, view: 'budget' } as const;

function memoryStore(initial: string | null = null): {
  store: KeyValueStore;
  read: () => string | null;
} {
  let value = initial;
  return {
    store: {
      getItem: (key) => (key === BUDGET_STORAGE_KEY ? value : null),
      setItem: (key, next) => {
        if (key === BUDGET_STORAGE_KEY) value = next;
      },
    },
    read: () => value,
  };
}

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

describe('readStoredBudget / writeStoredBudget', () => {
  it('reads the persisted state', () => {
    const { store } = memoryStore('{"gold":5000,"view":"shop"}');
    expect(readStoredBudget(store)).toEqual({ gold: 5000, view: 'shop' });
  });

  it('falls back to defaults for missing or malformed data', () => {
    expect(readStoredBudget(null)).toEqual(DEFAULTS);
    expect(readStoredBudget(memoryStore().store)).toEqual(DEFAULTS);
    expect(readStoredBudget(memoryStore('not json').store)).toEqual(DEFAULTS);
  });

  it('preserves the view when gold is written', () => {
    const { store, read } = memoryStore('{"gold":100,"view":"shop"}');
    writeStoredBudget({ gold: 250, view: 'shop' }, store);
    expect(read()).toBe('{"gold":250,"view":"shop"}');
    expect(readStoredBudget(store)).toEqual({ gold: 250, view: 'shop' });
  });

  it('never throws when storage is unavailable', () => {
    const broken: KeyValueStore = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    expect(readStoredBudget(broken)).toEqual(DEFAULTS);
    expect(() =>
      writeStoredBudget({ gold: 1, view: 'budget' }, broken),
    ).not.toThrow();
    expect(() =>
      writeStoredBudget({ gold: 1, view: 'budget' }, null),
    ).not.toThrow();
  });
});
