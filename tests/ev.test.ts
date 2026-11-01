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
  parseQuantity,
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

  it('accepts a marked midpoint but not an unmarked fraction', () => {
    // Operator decision (§3.1): a published range is priced at its midpoint, but the
    // line has to say so. An unmarked 2.5 is still refused — that is an invented
    // fraction with no range behind it.
    const marked = analyseDistribution([
      {
        item: 'Potato seed',
        quantity: 2.5,
        chance: 0.5,
        assumedQuantity: true,
        quantityRange: { min: 1, max: 4 },
      },
    ]);
    expect(marked.rejected).toBeNull();
    expect(marked.distribution?.drops[0]?.quantity).toBe(2.5);

    const unmarked = analyseDistribution([
      { item: 'Potato seed', quantity: 2.5, chance: 0.5 },
    ]);
    expect(unmarked.rejected).toBe('ranged-quantity');
    expect(unmarked.distribution).toBeNull();
  });

  it('refuses a table whose rolled chances exceed one roll', () => {
    const analysis = analyseDistribution([
      { item: 'Silk', quantity: 1, chance: 0.8 },
      { item: 'Coins', quantity: 5, chance: 0.8 },
    ]);
    expect(analysis.rejected).toBe('over-one');
  });

  it('does not treat several guaranteed lines as one roll', () => {
    // A polar kebbit always drops bones, fur and meat together: three `Always`
    // lines are a set, not competing outcomes.
    const analysis = analyseDistribution([
      { item: 'Bones', quantity: 1, chance: 1 },
      { item: 'Polar kebbit fur', quantity: 1, chance: 1 },
      { item: 'Raw beast meat', quantity: 1, chance: 1 },
    ]);
    expect(analysis.rejected).toBeNull();
    expect(analysis.distribution?.guaranteed).toBe(3);
  });

  it('allows a guaranteed line beside one probability roll', () => {
    const analysis = analyseDistribution([
      { item: 'Bones', quantity: 1, chance: 1 },
      { item: 'Red chinchompa tuft', quantity: 1, chance: 0.02 },
    ]);
    expect(analysis.rejected).toBeNull();
  });

  it('refuses an empty table and a non-positive quantity', () => {
    expect(analyseDistribution([]).rejected).toBe('no-drops');
    expect(
      analyseDistribution([{ item: 'Coins', quantity: 0, chance: 1 }]).rejected,
    ).toBe('non-positive-quantity');
  });
});

describe('parseQuantity', () => {
  it('reads an exact quantity, a comma group and a range', () => {
    expect(parseQuantity('3')).toEqual({
      quantity: 3,
      assumedQuantity: false,
      quantityRange: null,
    });
    expect(parseQuantity('1,000')?.quantity).toBe(1000);
    // A range is the midpoint, and it says so.
    expect(parseQuantity('500-750')).toEqual({
      quantity: 625,
      assumedQuantity: true,
      quantityRange: { min: 500, max: 750 },
    });
    // Wiki annotations are dropped before parsing.
    expect(parseQuantity('1-3 (noted)')).toEqual({
      quantity: 2,
      assumedQuantity: true,
      quantityRange: { min: 1, max: 3 },
    });
  });

  it('refuses a word, a degenerate or an inverted range', () => {
    // `Varies` has no numbers, so there is no midpoint to take.
    expect(parseQuantity('Varies')).toBeNull();
    expect(parseQuantity('')).toBeNull();
    expect(parseQuantity('5-5')).toEqual({
      quantity: 5,
      assumedQuantity: false,
      quantityRange: null,
    });
    expect(parseQuantity('10-2')).toBeNull();
    expect(parseQuantity('0-5')).toBeNull();
  });
});

describe('priceDistribution', () => {
  const table = {
    drops: [
      { item: 'Coins', quantity: 30, chance: 1 },
      { item: 'Cake', quantity: 1, chance: 0.5 },
    ],
    totalChance: 1.5,
    guaranteed: 1,
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

  it('counts an outcome with no market as 0 gp, and says so', () => {
    // Operator decision (§3.1b): the item is worth something, this site just cannot
    // price it, so the row is a floor rather than absent. Nothing is dropped.
    const priced = priceDistribution(table, (item) => (item === 'Cake' ? null : 1));
    if (priced === null) throw new Error('expected a priced table');

    const cake = priced.lines.find((line) => line.item === 'Cake');
    expect(cake?.expectedGp).toBe(0);
    expect(cake?.unpriced).toBe(true);
    // Coins still contribute, so the mean is the priced part.
    expect(priced.perAction).toBe(30);

    const coins = priced.lines.find((line) => line.item === 'Coins');
    expect(coins?.unpriced).toBe(false);
  });

  it('refuses a table where nothing has a market', () => {
    // A mean of 0 here would say the loot is worthless, when the truth is that the
    // site knows no prices for any of it.
    expect(priceDistribution(table, () => null)).toBeNull();
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
    successChance: 1,
    dropsConditionalOnSuccess: false,
    drops: [{ item: 'Silk', quantity: 1, chance: 1 }],
    droppedLines: 0,
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

  it('publishes a row with no rate when the action time is not published', () => {
    // Fishing publishes no attempt interval. The per-attempt profit is sourced, the
    // hour is not, so the row carries numbers and a null rate (§4).
    const result = rankEvActivities(
      [source({ secondsPerAction: null })],
      market([quote()]),
      { skill: 'Thieving', mode: 'pessimistic' },
    );

    const row = result.activities[0];
    if (row === undefined) throw new Error('expected a rate-less EV row');
    expect(row.profit).toBe(49);
    expect(row.gpPerHour).toBeNull();
    expect(row.timeActions4h).toBeNull();
    expect(row.effectiveSecondsPerAction).toBeNull();
  });

  it('scales the expectation by the published success chance', () => {
    // A `Man` pickpocket always gives 3 coins *when it succeeds*; a failed attempt
    // yields nothing and stuns you, so the row is 3 x p rather than 3.
    const result = rankEvActivities(
      [
        source({
          secondsPerAction: 2.61,
          successChance: 0.5,
          dropsConditionalOnSuccess: true,
          drops: [{ item: 'Coins', quantity: 6, chance: 1 }],
        }),
      ],
      market([]),
      { skill: 'Thieving', mode: 'pessimistic' },
    );

    const row = result.activities[0];
    if (row === undefined) throw new Error('expected a pickpocket row');
    expect(row.profit).toBe(3);
    // The distribution shows the chance *per attempt*, not per success.
    expect(row.distribution?.[0]?.chance).toBeCloseTo(0.5);
  });

  it('refuses a success chance outside zero to one', () => {
    const result = rankEvActivities(
      [source({ successChance: 1.2 })],
      market([quote()]),
      { skill: 'Thieving', mode: 'pessimistic' },
    );
    expect(result.activities).toHaveLength(0);
    expect(result.rejected).toBe(1);
  });

  it('prices a table with an unpriced outcome, marking that line at 0 gp', () => {
    // §3.1b: an item with no GE market contributes 0 and is marked, so the row is a
    // floor. The engine keeps the row and the artifact shows which line is unpriced.
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

    const row = result.activities[0];
    if (row === undefined) throw new Error('expected an EV row');
    const diamonds = row.distribution?.find((line) => line.item === 'Diamonds');
    expect(diamonds?.unpriced).toBe(true);
    expect(diamonds?.expectedGp).toBe(0);
    // The priced half still counts: 0.5 x 49 gp.
    expect(row.profit).toBe(25);
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
