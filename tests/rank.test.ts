import { describe, expect, it } from 'vitest';
import { rank, toShopRow } from '../src/engine/rank.js';
import type {
  MarketQuote,
  MarketSnapshot,
  ShopCatalog,
  ShopEntry,
} from '../src/types.js';

function entry(overrides: Partial<ShopEntry> = {}): ShopEntry {
  return {
    shopPage: "Bob's Brilliant Axes.",
    shopName: "Bob's Brilliant Axes",
    soldBy: 'Bob',
    itemName: 'Steel axe',
    itemId: 1,
    itemValue: 200,
    members: false,
    location: 'Lumbridge',
    shopTypes: ['Axe shops'],
    sellMultiplier: 1000,
    buyMultiplier: 600,
    delta: 20,
    baseStock: 3,
    infiniteStock: false,
    restockTicks: 100,
    storeSellPrice: 200,
    storeBuyPrice: 120,
    currency: 'Coins',
    ...overrides,
  };
}

function quote(overrides: Partial<MarketQuote> = {}): MarketQuote {
  return {
    id: 1,
    name: 'Steel axe',
    members: false,
    value: 200,
    limit: 100,
    high: 1000,
    low: 900,
    avgHighPrice24h: 1000,
    avgLowPrice24h: 900,
    highVolume24h: 60_000,
    lowVolume24h: 60_000,
    highTime: null,
    lowTime: null,
    ...overrides,
  };
}

function catalog(entries: ShopEntry[]): ShopCatalog {
  return {
    generatedAt: '2026-01-01T00:00:00.000Z',
    source: 'test',
    shopCount: new Set(entries.map((e) => e.shopPage)).size,
    entries,
  };
}

function market(quotes: MarketQuote[]): MarketSnapshot {
  return {
    generatedAt: '2026-01-01T00:00:00.000Z',
    pricesAsOf: '2026-01-01T00:00:00.000Z',
    itemCount: quotes.length,
    quotes: Object.fromEntries(quotes.map((q) => [String(q.id), q])),
  };
}

describe('toShopRow', () => {
  it('builds a finite-stock row', () => {
    expect(toShopRow(entry())).toEqual({
      itemValue: 200,
      sellMultiplier: 1000,
      buyMultiplier: 600,
      delta: 20,
      baseStock: 3,
    });
  });

  it('refuses rows without a base value', () => {
    expect(toShopRow(entry({ itemValue: null }))).toBeNull();
  });

  it('refuses finite-stock rows with no published stock', () => {
    expect(toShopRow(entry({ baseStock: null }))).toBeNull();
  });

  it('builds infinite-stock rows', () => {
    const row = toShopRow(entry({ infiniteStock: true, baseStock: null }));
    expect(row?.infiniteStock).toBe(true);
  });
});

describe('rank', () => {
  it('produces an opportunity for a profitable pair', () => {
    const result = rank(catalog([entry()]), market([quote()]), { mode: 'pessimistic' });
    expect(result.count).toBe(1);
    expect(result.opportunities[0]?.shopName).toBe("Bob's Brilliant Axes");
    expect(result.opportunities[0]?.location).toBe('Lumbridge');
    expect(result.mode).toBe('pessimistic');
  });

  it('sorts by gp per 4h, descending', () => {
    const entries = [
      entry({ itemName: 'A', itemId: 1 }),
      entry({ itemName: 'B', itemId: 2, shopPage: 'Shop B.' }),
    ];
    const quotes = [
      quote({ id: 1, name: 'A', low: 900 }),
      quote({ id: 2, name: 'B', low: 5000 }),
    ];
    const result = rank(catalog(entries), market(quotes), { mode: 'pessimistic' });
    expect(result.opportunities[0]?.itemName).toBe('B');
  });

  it('excludes infinite-stock shops unless asked', () => {
    const entries = [entry({ infiniteStock: true, baseStock: null })];
    expect(rank(catalog(entries), market([quote()]), { mode: 'pessimistic' }).count).toBe(0);
    expect(
      rank(catalog(entries), market([quote()]), {
        mode: 'pessimistic',
        includeInfiniteStock: true,
      }).count,
    ).toBe(1);
  });

  it('excludes non-Coins currencies', () => {
    const entries = [entry({ currency: 'Tokkul' })];
    expect(rank(catalog(entries), market([quote()]), { mode: 'pessimistic' }).count).toBe(0);
  });

  it('honours membersOnly', () => {
    const entries = [entry({ members: false })];
    expect(
      rank(catalog(entries), market([quote()]), { mode: 'pessimistic', membersOnly: true }).count,
    ).toBe(0);
  });

  it('honours minVolume4h', () => {
    const quotes = [quote({ lowVolume24h: 6 })]; // 1 per 4h
    expect(
      rank(catalog([entry()]), market(quotes), {
        mode: 'pessimistic',
        minVolume4h: 5,
      }).count,
    ).toBe(0);
  });

  it('honours minMargin', () => {
    expect(
      rank(catalog([entry()]), market([quote()]), {
        mode: 'pessimistic',
        minMargin: 10_000,
      }).count,
    ).toBe(0);
  });

  it('drops entries whose item is not in the market snapshot', () => {
    const entries = [entry({ itemId: 999 })];
    expect(rank(catalog(entries), market([quote()]), { mode: 'pessimistic' }).count).toBe(0);
  });

  it('is deterministic across calls', () => {
    const args = [catalog([entry()]), market([quote()])] as const;
    const a = rank(args[0], args[1], { mode: 'patient' });
    const b = rank(args[0], args[1], { mode: 'patient' });
    expect(a.opportunities).toEqual(b.opportunities);
  });

  it('caps the returned list with limit', () => {
    const entries = [
      entry({ itemId: 1, itemName: 'A', shopPage: 'A.' }),
      entry({ itemId: 2, itemName: 'B', shopPage: 'B.' }),
    ];
    const quotes = [quote({ id: 1, name: 'A' }), quote({ id: 2, name: 'B' })];
    expect(
      rank(catalog(entries), market(quotes), { mode: 'pessimistic', limit: 1 }).count,
    ).toBe(1);
  });
});
