/**
 * Expected value: the §3.1 rule in code.
 *
 * The tests are about the *refusals* as much as the maths, because the whole point
 * of the rule is that a number is only published when the wiki publishes the
 * distribution behind it. Anything unreadable — a ranged quantity, a rarity that
 * is not a probability, a table summing above one roll — must produce no row.
 */

import { describe, expect, it } from 'vitest';

import {
  analyseDistribution,
  parseRarity,
  priceDistribution,
} from '../src/domain/ev.js';
import { rankEvActivities } from '../src/engine/skilling.js';
import type { ThievingSource } from '../src/api/wikiThieving.js';
import type { MarketQuote, MarketSnapshot } from '../src/types.js';

describe('parseRarity', () => {
  it('reads the forms the drop tables use', () => {
    expect(parseRarity('Always')).toBe(1);
    expect(parseRarity('5/20')).toBe(0.25);
    expect(parseRarity('1/5.65')).toBeCloseTo(0.17699, 4);
    expect(parseRarity('1/256,211')).toBeCloseTo(1 / 256_211, 10);
    expect(parseRarity('Never')).toBe(0);
  });

  it('refuses anything that is not a probability', () => {
    expect(parseRarity('3/2')).toBeNull();
    expect(parseRarity('rare')).toBeNull();
    expect(parseRarity('')).toBeNull();
  });
});

describe('analyseDistribution', () => {
  it('accepts a table that sums to one roll', () => {
    const analysis = analyseDistribution([
      { item: 'Bread', quantity: 1, chance: 0.25 },
      { item: 'Cake', quantity: 1, chance: 0.65 },
    ]);
    expect(analysis.rejected).toBeNull();
    expect(analysis.distribution?.totalChance).toBeCloseTo(0.9);
  });

  it('refuses a ranged quantity instead of averaging it', () => {
    // `1-4` has no published weights, so there is no expectation to compute.
    const analysis = analyseDistribution([
      { item: 'Potato seed', quantity: 2.5, chance: 0.5 },
    ]);
    expect(analysis.rejected).toBe('ranged-quantity');
    expect(analysis.distribution).toBeNull();
  });

  it('refuses a table whose chances exceed one roll', () => {
    const analysis = analyseDistribution([
      { item: 'Silk', quantity: 1, chance: 0.8 },
      { item: 'Coins', quantity: 5, chance: 0.8 },
    ]);
    expect(analysis.rejected).toBe('over-one');
  });

  it('refuses an empty table and a non-positive quantity', () => {
    expect(analyseDistribution([]).rejected).toBe('no-drops');
    expect(
      analyseDistribution([{ item: 'Coins', quantity: 0, chance: 1 }]).rejected,
    ).toBe('non-positive-quantity');
  });
});

describe('priceDistribution', () => {
  const table = {
    drops: [
      { item: 'Coins', quantity: 30, chance: 1 },
      { item: 'Cake', quantity: 1, chance: 0.5 },
    ],
    totalChance: 1.5,
  };

  it('values coins at face value and items at their price', () => {
    const priced = priceDistribution(table, (item) =>
      item === 'Coins' ? 1 : 100,
    );
    if (priced === null) throw new Error('expected a priced table');
    expect(priced.lines[0]?.expectedGp).toBe(30);
    expect(priced.lines[1]?.expectedGp).toBe(50);
    expect(priced.perAction).toBe(80);
  });

  it('refuses the whole table when one outcome has no market', () => {
    // Dropping the expensive outcome would understate the row, which is worse
    // than publishing nothing.
    expect(
      priceDistribution(table, (item) => (item === 'Cake' ? null : 1)),
    ).toBeNull();
  });
});

function quote(overrides: Partial<MarketQuote> = {}): MarketQuote {
  return {
    id: 1,
    name: 'Silk',
    members: true,
    value: 30,
    stackable: null,
    limit: 100,
    high: 60,
    low: 50,
    avgHighPrice24h: 60,
    avgLowPrice24h: 50,
    highVolume24h: 6000,
    lowVolume24h: 3000,
    highTime: null,
    lowTime: null,
    ...overrides,
  };
}

function market(quotes: MarketQuote[]): MarketSnapshot {
  return {
    generatedAt: '2026-01-01T00:00:00.000Z',
    pricesAsOf: '2026-01-01T00:00:00.000Z',
    itemCount: quotes.length,
    quotes: Object.fromEntries(quotes.map((entry) => [String(entry.id), entry])),
  };
}

function source(overrides: Partial<ThievingSource> = {}): ThievingSource {
  return {
    source_pages: 'Silk stall',
    name: 'Silk stall',
    kind: 'Stall',
    level: 20,
    xp: 24,
    secondsPerAction: 4.8,
    drops: [{ item: 'Silk', quantity: 1, chance: 1 }],
    url: 'https://oldschool.runescape.wiki/w/Silk_stall',
    ...overrides,
  };
}

describe('rankEvActivities', () => {
  it('prices a stall at its expectation and keeps the distribution', () => {
    const result = rankEvActivities([source()], market([quote()]), {
      skill: 'Thieving',
      mode: 'pessimistic',
    });

    const row = result.activities[0];
    if (row === undefined) throw new Error('expected an EV row');
    expect(row.kind).toBe('ev');
    // Sell side in pessimistic mode is `low` (50) less the 1 gp tax.
    expect(row.profit).toBe(49);
    expect(row.secondsPerAction).toBe(4.8);
    expect(row.gpPerHour).toBeCloseTo(49 * (3600 / 4.8));
    expect(row.distribution).toHaveLength(1);
  });

  it('refuses a stall whose action time is not published', () => {
    const result = rankEvActivities(
      [source({ secondsPerAction: null })],
      market([quote()]),
      { skill: 'Thieving', mode: 'pessimistic' },
    );

    expect(result.activities).toHaveLength(0);
    expect(result.rejected).toBe(1);
  });

  it('counts a table with an unpriced outcome as unpriced, not free', () => {
    const result = rankEvActivities(
      [
        source({
          drops: [
            { item: 'Silk', quantity: 1, chance: 0.5 },
            { item: 'Diamonds', quantity: 1, chance: 0.5 },
          ],
        }),
      ],
      market([quote()]),
      { skill: 'Thieving', mode: 'pessimistic' },
    );

    expect(result.activities).toHaveLength(0);
    expect(result.unpriced).toBe(1);
  });

  it('charges the bank trip per load, using the page pins', () => {
    const result = rankEvActivities([source()], market([quote()]), {
      skill: 'Thieving',
      mode: 'pessimistic',
      bankTilesByPage: new Map([['Silk stall', 40]]),
      stackableByItem: new Map([['silk', false]]),
      secondsPerTile: 0.6,
      handoverSeconds: 3,
    });

    const row = result.activities[0];
    if (row === undefined) throw new Error('expected an EV row');
    // 2 x 40 x 0.6 + 3 = 51s per trip, spread over 27 non-stackable units.
    expect(row.bankTiles).toBe(40);
    expect(row.effectiveSecondsPerAction).toBeCloseTo(4.8 + 51 / 27);
    // Whole 4h actions, the same convention as the processing engine.
    expect(row.actions4h).toBe(Math.floor(14_400 / (4.8 + 51 / 27)));
    expect(row.gpPerHour).toBe((49 * row.actions4h) / 4);
  });

  it('never banks a table whose every outcome stacks', () => {
    const result = rankEvActivities([source()], market([quote()]), {
      skill: 'Thieving',
      mode: 'pessimistic',
      bankTilesByPage: new Map([['Silk stall', 40]]),
      stackableByItem: new Map([['silk', true]]),
    });

    const row = result.activities[0];
    if (row === undefined) throw new Error('expected an EV row');
    expect(row.effectiveSecondsPerAction).toBe(4.8);
    expect(row.gpPerHour).toBeCloseTo(49 * (3600 / 4.8));
  });

  it('charges no walk when the page publishes no location', () => {
    const result = rankEvActivities([source()], market([quote()]), {
      skill: 'Thieving',
      mode: 'pessimistic',
      bankTilesByPage: new Map([['Silk stall', null]]),
      stackableByItem: new Map([['silk', false]]),
    });

    const row = result.activities[0];
    if (row === undefined) throw new Error('expected an EV row');
    expect(row.bankTiles).toBeNull();
    expect(row.effectiveSecondsPerAction).toBe(4.8);
  });

  it('values a coins-only table at its face value', () => {
    const result = rankEvActivities(
      [source({ drops: [{ item: 'Coins', quantity: 30, chance: 1 }] })],
      market([]),
      { skill: 'Thieving', mode: 'pessimistic' },
    );

    const row = result.activities[0];
    if (row === undefined) throw new Error('expected a coins row');
    expect(row.profit).toBe(30);
  });
});
