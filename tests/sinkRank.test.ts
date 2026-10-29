import { describe, expect, it } from 'vitest';
import {
  rankSinks,
  targetBuyPrice,
  volume24hForBuyMode,
} from '../src/engine/sinkRank.js';
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
    bankTiles: 10,
    nearestBank: 'Lumbridge Castle bank',
    geTiles: 10,
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
    stackable: false,
    limit: 100,
    high: 100,
    low: 90,
    avgHighPrice24h: 100,
    avgLowPrice24h: 90,
    highVolume24h: 6000,
    lowVolume24h: 3000,
    highTime: null,
    lowTime: null,
    ...overrides,
  };
}

function catalog(
  entries: ShopEntry[],
  gePoint: ShopCatalog['gePoint'] = { x: 3165, y: 3490, mapID: 0 },
): ShopCatalog {
  return {
    generatedAt: '2026-01-01T00:00:00.000Z',
    source: 'test',
    gePoint,
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

describe('buy-side mode mapping', () => {
  it('pays the high price for an instant buy and the low price for a patient one', () => {
    expect(targetBuyPrice(quote(), 'pessimistic')).toBe(100);
    expect(targetBuyPrice(quote(), 'patient')).toBe(90);
  });

  it('rejects missing or zero prices', () => {
    expect(targetBuyPrice(quote({ high: null }), 'pessimistic')).toBeNull();
    expect(targetBuyPrice(quote({ low: 0 }), 'patient')).toBeNull();
  });

  it('uses the volume on the side of the book the buy takes from', () => {
    // An instant buy is filled by sellers hitting the high side; a resting low
    // offer is filled by instant sellers.
    expect(volume24hForBuyMode(quote(), 'pessimistic')).toBe(6000);
    expect(volume24hForBuyMode(quote(), 'patient')).toBe(3000);
  });
});

describe('rankSinks', () => {
  it('produces a GE -> shop opportunity repeated across worlds', () => {
    const result = rankSinks(catalog([entry()]), market([quote()]), {
      mode: 'pessimistic',
    });

    expect(result.count).toBe(1);
    const opp = result.opportunities[0];
    expect(opp?.itemName).toBe('Steel axe');
    expect(opp?.shopName).toBe("Bob's Brilliant Axes");
    expect(opp?.geBuyPrice).toBe(100);
    expect(opp?.shopFirstUnitPrice).toBe(120);
    expect(opp?.unitsPerWorld).toBe(5);
    expect(opp?.units).toBe(100);
    expect(opp?.worlds).toBe(20);
    expect(opp?.worldLimited).toBe(false);
    expect(opp?.budgetLimited).toBe(false);
    expect(opp?.profit).toBe(1200);
    expect(opp?.geTiles).toBe(10);
    expect(opp?.deltaPct).toBe(2);
    expect(opp?.priceDropPerUnit).toBe(4);
    expect(result.mode).toBe('pessimistic');
  });

  it('prices a patient buy against the low price and its volume side', () => {
    const result = rankSinks(catalog([entry()]), market([quote()]), {
      mode: 'patient',
    });
    const opp = result.opportunities[0];

    expect(opp?.geBuyPrice).toBe(90);
    expect(opp?.unitsPerWorld).toBe(8); // 120, 116, … 92; 88 is not > 90
    expect(opp?.units).toBe(100);
    expect(opp?.worlds).toBe(13); // 12 full worlds + 4 units
    expect(opp?.profit).toBe(1632);
    expect(opp?.volume4h).toBe(500); // floor(3000 / 6)
  });

  it('excludes general stores by category by default', () => {
    const store = entry({
      shopTypes: ['General stores', 'Free-to-play shops'],
    });
    expect(
      rankSinks(catalog([store]), market([quote()]), { mode: 'pessimistic' })
        .count,
    ).toBe(0);
    expect(
      rankSinks(catalog([store]), market([quote()]), {
        mode: 'pessimistic',
        excludeGeneralStores: false,
      }).count,
    ).toBe(1);
  });

  it('requires the shop to publish a buy price', () => {
    // Eblis's ancient staff is listed with a 100% buy multiplier but `buy=N/A`
    // (`hidebuy=y`): the shop does not buy it at all.
    const refused = entry({ buyMultiplier: 1000, storeBuyPrice: null });
    expect(
      rankSinks(catalog([refused]), market([quote()]), { mode: 'pessimistic' })
        .count,
    ).toBe(0);

    const free = entry({ storeBuyPrice: 0 });
    expect(
      rankSinks(catalog([free]), market([quote()]), { mode: 'pessimistic' })
        .count,
    ).toBe(0);
  });

  it('excludes infinite-stock shops unless asked', () => {
    const infinite = entry({
      infiniteStock: true,
      baseStock: null,
      buyMultiplier: 600,
      storeBuyPrice: 120,
    });
    const quoteRow = quote({ high: 100 });
    expect(
      rankSinks(catalog([infinite]), market([quoteRow]), {
        mode: 'pessimistic',
      }).count,
    ).toBe(0);
    expect(
      rankSinks(catalog([infinite]), market([quoteRow]), {
        mode: 'pessimistic',
        includeInfiniteStock: true,
      }).count,
    ).toBe(1);
  });

  it('excludes non-Coins currencies', () => {
    const tokkul = entry({ currency: 'Tokkul' });
    expect(
      rankSinks(catalog([tokkul]), market([quote()]), { mode: 'pessimistic' })
        .count,
    ).toBe(0);
  });

  it('honours membersOnly', () => {
    const shop = entry({ members: false });
    expect(
      rankSinks(catalog([shop]), market([quote()]), {
        mode: 'pessimistic',
        membersOnly: true,
      }).count,
    ).toBe(0);
  });

  it('caps units by the GE buy limit', () => {
    const result = rankSinks(catalog([entry()]), market([quote({ limit: 2 })]), {
      mode: 'pessimistic',
    });
    expect(result.opportunities[0]?.units).toBe(2);
    expect(result.opportunities[0]?.unitsPerWorld).toBe(2);
    expect(result.opportunities[0]?.worlds).toBe(1);
    expect(result.opportunities[0]?.purchaseCap4h).toBe(2);
  });

  it('caps units by the 24h volume slice', () => {
    const result = rankSinks(
      catalog([entry()]),
      market([quote({ highVolume24h: 12 })]), // 2 per 4h
      { mode: 'pessimistic' },
    );
    expect(result.opportunities[0]?.units).toBe(2);
    expect(result.opportunities[0]?.volume4h).toBe(2);
  });

  it('drops rows the GE cannot supply in 4h', () => {
    const result = rankSinks(
      catalog([entry()]),
      market([quote({ highVolume24h: 5 })]), // 0 per 4h after flooring
      { mode: 'pessimistic' },
    );
    expect(result.count).toBe(0);
  });

  it('honours minProfit', () => {
    expect(
      rankSinks(catalog([entry()]), market([quote()]), {
        mode: 'pessimistic',
        minProfit: 1201,
      }).count,
    ).toBe(0);
  });

  it('honours the gold budget', () => {
    const result = rankSinks(catalog([entry()]), market([quote()]), {
      mode: 'pessimistic',
      budgetGp: 1000,
    });
    const opp = result.opportunities[0];

    expect(opp?.units).toBe(10); // 1000 gp / 100 per unit
    expect(opp?.worlds).toBe(2);
    expect(opp?.budgetLimited).toBe(true);
    expect(opp?.totalCost).toBe(1000);
    expect(opp?.profit).toBe(120);
  });

  it('reports profit but an unknown gp/hour when the GE distance is unknown', () => {
    const result = rankSinks(
      catalog([entry({ geTiles: null })], null),
      market([quote()]),
      { mode: 'pessimistic' },
    );
    const opp = result.opportunities[0];
    expect(opp?.units).toBe(100);
    expect(opp?.profit).toBe(1200);
    expect(opp?.geTiles).toBeNull();
    expect(opp?.tripSeconds).toBeNull();
    expect(opp?.gpPerHour).toBeNull();
  });

  it('does not split a noted item into 27-unit loads', () => {
    const flat = entry({
      itemValue: 200,
      buyMultiplier: 1000,
      delta: 0,
      baseStock: 0,
      storeBuyPrice: 200,
    });
    const result = rankSinks(
      catalog([flat]),
      market([quote({ high: 100, limit: 30, highVolume24h: 600 })]),
      { mode: 'pessimistic' },
    );
    const opp = result.opportunities[0];
    expect(opp?.units).toBe(30);
    expect(opp?.unitsPerWorld).toBe(30);
    expect(opp?.worlds).toBe(1);
    expect(opp?.profit).toBe(3000);
  });

  it('includes hop time and stops at the world ceiling', () => {
    const result = rankSinks(
      catalog([entry()]),
      market([
        quote({ limit: 100_000, highVolume24h: 600_000 }),
      ]),
      { mode: 'pessimistic' },
    );
    const opp = result.opportunities[0];

    // 200 worlds × 5 units; travel (15s + 2000s hops) beats GE supply (144s).
    expect(opp?.units).toBe(1000);
    expect(opp?.unitsPerWorld).toBe(5);
    expect(opp?.worlds).toBe(200);
    expect(opp?.worldLimited).toBe(true);
    expect(opp?.timeSeconds).toBe(2015);
    expect(opp?.gpPerHour).toBeCloseTo(21_439.2, 0);
  });

  it('keeps one deterministic row per shop and item', () => {
    const better = entry({ buyMultiplier: 700, storeBuyPrice: 140 });
    const worse = entry({ buyMultiplier: 600, storeBuyPrice: 120 });
    const result = rankSinks(catalog([worse, better]), market([quote()]), {
      mode: 'pessimistic',
    });

    expect(result.count).toBe(1);
    expect(result.opportunities[0]?.buyMultiplier).toBe(700);
  });

  it('sorts by gp/hour with unknown times last, then profit', () => {
    const limitFree = quote({ limit: 100_000, highVolume24h: 600_000 });
    const fast = entry({ shopPage: 'Fast.', shopName: 'Fast', geTiles: 1 });
    const slow = entry({ shopPage: 'Slow.', shopName: 'Slow', geTiles: 500 });
    const unknown = entry({
      shopPage: 'Unknown.',
      shopName: 'Unknown',
      geTiles: null,
    });

    const result = rankSinks(catalog([slow, unknown, fast]), market([limitFree]), {
      mode: 'pessimistic',
    });

    expect(result.opportunities.map((o) => o.shopName)).toEqual([
      'Fast',
      'Slow',
      'Unknown',
    ]);
    expect(result.opportunities[2]?.gpPerHour).toBeNull();
  });

  it('is deterministic across calls', () => {
    const a = rankSinks(catalog([entry()]), market([quote()]), {
      mode: 'patient',
    });
    const b = rankSinks(catalog([entry()]), market([quote()]), {
      mode: 'patient',
    });
    expect(a.opportunities).toEqual(b.opportunities);
  });

  it('caps the returned list with limit', () => {
    const entries = [
      entry({ itemId: 1, itemName: 'A', shopPage: 'A.' }),
      entry({ itemId: 2, itemName: 'B', shopPage: 'B.' }),
    ];
    const quotes = [
      quote({ id: 1, name: 'A' }),
      quote({ id: 2, name: 'B' }),
    ];
    expect(
      rankSinks(catalog(entries), market(quotes), {
        mode: 'pessimistic',
        limit: 1,
      }).count,
    ).toBe(1);
  });

  it('echoes the filters, hop assumptions and prices timestamp', () => {
    const result = rankSinks(catalog([entry()]), market([quote()]), {
      mode: 'pessimistic',
      minProfit: 5,
      minVolume4h: 2,
    });
    expect(result.pricesAsOf).toBe('2026-01-01T00:00:00.000Z');
    expect(result.filters).toEqual({
      excludeGeneralStores: true,
      includeInfiniteStock: false,
      membersOnly: false,
      minProfit: 5,
      minVolume4h: 2,
      hopSeconds: 10,
      maxWorlds: 200,
      budgetGp: 0,
    });
  });
});
