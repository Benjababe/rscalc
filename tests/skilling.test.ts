import { readFile } from 'fs/promises';
import { describe, expect, it } from 'vitest';
import type { RawRecipe } from '../src/api/wikiRecipes.js';
import {
  NO_PROFIT_FLOOR,
  SKILLING_SKILLS,
  rankSkillActivities,
} from '../src/engine/skilling.js';
import { toBurnIndex } from '../src/domain/cooking.js';
import {
  SkillingPayloadSchema,
  type MarketQuote,
  type MarketSnapshot,
} from '../src/types.js';

function recipe(overrides: Partial<RawRecipe> = {}): RawRecipe {
  return {
    id: 'bow-string',
    page: 'Bow string',
    method: 'Spinning wheel',
    ticks: 3,
    materials: [{ name: 'Flax', quantity: 1, note: null }],
    output: { name: 'Bow string', quantity: 1, note: null },
    facilities: 'Spinning wheel',
    tools: null,
    members: true,
    skills: [{ name: 'Crafting', level: 10 }],
    ...overrides,
  };
}

function quote(overrides: Partial<MarketQuote> = {}): MarketQuote {
  return {
    id: 1,
    name: 'Flax',
    members: true,
    value: 5,
    stackable: null,
    limit: 100,
    high: 10,
    low: 8,
    avgHighPrice24h: 10,
    avgLowPrice24h: 8,
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

const FLAX = quote({ id: 1, name: 'Flax', high: 10, low: 8 });
/** A profitable spin: 30 gp out, 10 gp in. */
const BOW_STRING = quote({ id: 2, name: 'Bow string', high: 30, low: 30 });
/** A loss-making action: the input costs more than the output is worth. */
const WORTHLESS_INPUT = quote({ id: 3, name: 'Ruby', high: 900, low: 900 });
const WORTHLESS_OUTPUT = quote({
  id: 4,
  name: 'Ruby ring',
  high: 700,
  low: 700,
});
const UNPRICED = quote({ id: 5, name: 'Unpriced thing' });

const PROFITABLE = recipe();
const LOSS = recipe({
  id: 'ruby-ring',
  page: 'Ruby ring',
  materials: [{ name: 'Ruby', quantity: 1, note: null }],
  output: { name: 'Ruby ring', quantity: 1, note: null },
  skills: [{ name: 'Crafting', level: 34 }],
});
const NO_TICKS = recipe({
  id: 'no-ticks',
  page: 'No ticks',
  ticks: null,
  skills: [{ name: 'Crafting', level: 20 }],
});
const SMITHING = recipe({
  id: 'bronze-bar',
  page: 'Bronze bar',
  materials: [{ name: 'Flax', quantity: 1, note: null }],
  output: { name: 'Bow string', quantity: 1, note: null },
  skills: [{ name: 'Smithing', level: 1 }],
});
/** Output has no quote, so the action cannot be priced at all. */
const UNPRICED_RECIPE = recipe({
  id: 'unpriced',
  page: 'Unpriced thing',
  output: { name: 'Unpriced thing', quantity: 1, note: null },
});

const MARKET = market([
  FLAX,
  BOW_STRING,
  WORTHLESS_INPUT,
  WORTHLESS_OUTPUT,
  UNPRICED,
]);

describe('rankSkillActivities', () => {
  it('keeps the loss-making side, which the processing artifact drops', () => {
    const result = rankSkillActivities([PROFITABLE, LOSS], MARKET, {
      skill: 'Crafting',
      mode: 'pessimistic',
    });

    const ring = result.ranking.opportunities.find(
      (row) => row.outputName === 'Ruby ring',
    );
    if (ring === undefined) throw new Error('expected the ruby ring row');
    // 900 gp in, 700 gp out minus the 14 gp GE tax = -214 gp per action.
    expect(ring.tax).toBe(14);
    expect(ring.profit).toBe(-214);
    expect(ring.gpPer4h).toBe(-214 * ring.actions4h);
    expect(ring.gpPerHour).toBeLessThan(0);
    expect(result.coverage).toEqual({
      skill: 'Crafting',
      recipes: 2,
      activities: 2,
      profitable: 1,
      lossMaking: 1,
      unknownRate: 0,
      trainOnly: 0,
      upgrades: 0,
      unpriced: 0,
    });
    expect(NO_PROFIT_FLOOR).toBeLessThan(0);
  });

  it('prices only the requested skill', () => {
    const result = rankSkillActivities([PROFITABLE, SMITHING], MARKET, {
      skill: 'Crafting',
      mode: 'pessimistic',
    });

    expect(result.ranking.filters.skills).toEqual(['crafting']);
    expect(result.ranking.opportunities).toHaveLength(1);
    // The smithing recipe names the skill, so it is not part of this coverage.
    expect(result.coverage.recipes).toBe(1);
  });

  it('counts an unpriced recipe instead of inventing a price', () => {
    const result = rankSkillActivities([PROFITABLE, UNPRICED_RECIPE], market([FLAX, BOW_STRING]), {
      skill: 'Crafting',
      mode: 'pessimistic',
    });

    expect(result.coverage.activities).toBe(1);
    expect(result.coverage.unpriced).toBe(1);
  });

  it('keeps a row with no published ticks and reports a null rate', () => {
    const result = rankSkillActivities([NO_TICKS], MARKET, {
      skill: 'Crafting',
      mode: 'pessimistic',
    });

    const row = result.ranking.opportunities[0];
    expect(row?.gpPerHour).toBeNull();
    expect(row?.ticks).toBeNull();
    expect(row?.profit).toBe(20);
    expect(result.coverage.unknownRate).toBe(1);
  });

  it('orders by gp/hour with unknown-rate rows last', () => {
    const result = rankSkillActivities([NO_TICKS, PROFITABLE], MARKET, {
      skill: 'Crafting',
      mode: 'pessimistic',
    });

    expect(result.ranking.opportunities.map((row) => row.outputName)).toEqual([
      'Bow string',
      'Bow string',
    ]);
    expect(result.ranking.opportunities[0]?.gpPerHour).not.toBeNull();
    expect(result.ranking.opportunities[1]?.gpPerHour).toBeNull();
  });
});

/** House furniture: the output is not a GE item at all, so it is a cost. */
const MAHOGANY_PLANK = quote({
  id: 6,
  name: 'Mahogany plank',
  high: 1500,
  low: 1500,
  highVolume24h: 60_000,
  lowVolume24h: 60_000,
  limit: 10_000,
});
const TABLE = recipe({
  id: 'mahogany-table',
  page: 'Mahogany table',
  ticks: 5,
  materials: [{ name: 'Mahogany plank', quantity: 6, note: null }],
  output: { name: 'Mahogany table', quantity: 1, note: null },
  skills: [{ name: 'Construction', level: 50 }],
});

/** A tradeable item with no volume at all: a market problem, not a cost. */
const ILLIQUID_OUTPUT = quote({
  id: 7,
  name: 'Vale offerings',
  high: 100,
  low: 100,
  highVolume24h: 0,
  lowVolume24h: 0,
});
const ILLIQUID = recipe({
  id: 'vale-offerings',
  page: 'Vale offerings',
  materials: [{ name: 'Flax', quantity: 1, note: null }],
  output: { name: 'Vale offerings', quantity: 1, note: null },
  skills: [{ name: 'Construction', level: 50 }],
});

/** Cooking: a raw food, a cooked output, and a published no-burn level. */
const RAW_MONKFISH = quote({
  id: 8,
  name: 'Raw monkfish',
  high: 400,
  low: 400,
  highVolume24h: 60_000,
  lowVolume24h: 60_000,
  limit: 10_000,
});
const MONKFISH = quote({
  id: 9,
  name: 'Monkfish',
  high: 500,
  low: 500,
  highVolume24h: 60_000,
  lowVolume24h: 60_000,
});
const COOK_MONKFISH = recipe({
  id: 'monkfish',
  page: 'Monkfish',
  ticks: 1,
  materials: [{ name: 'Raw monkfish', quantity: 1, note: null }],
  output: { name: 'Monkfish', quantity: 1, note: null },
  skills: [{ name: 'Cooking', level: 62 }],
});
const COOK_MYSTERY = recipe({
  id: 'mystery-fish',
  page: 'Mystery fish',
  ticks: 1,
  materials: [{ name: 'Raw monkfish', quantity: 1, note: null }],
  output: { name: 'Mystery fish', quantity: 1, note: null },
  skills: [{ name: 'Cooking', level: 1 }],
});
const BURN = toBurnIndex([
  { item: 'Monkfish', level: 90, source: 'range' },
  { item: 'Shark', level: null, source: 'range' },
]);

describe('upgrade rows', () => {
  it('moves a curated conversion out of the transform ranking', () => {
    const result = rankSkillActivities([LOSS], MARKET, {
      skill: 'Crafting',
      mode: 'pessimistic',
      upgradeKeys: new Set(['crafting|ruby ring']),
    });

    const row = result.ranking.opportunities[0];
    expect(row?.kind).toBe('upgrade');
    expect(row?.output).not.toBeNull();
    expect(result.coverage.upgrades).toBe(1);
  });

  it('leaves the same row as a transform without the curated key', () => {
    const result = rankSkillActivities([LOSS], MARKET, {
      skill: 'Crafting',
      mode: 'pessimistic',
    });

    expect(result.ranking.opportunities[0]?.kind).toBe('transform');
    expect(result.coverage.upgrades).toBe(0);
  });

  it('matches on skill as well as output name', () => {
    const result = rankSkillActivities([LOSS], MARKET, {
      skill: 'Crafting',
      mode: 'pessimistic',
      upgradeKeys: new Set(['smithing|ruby ring']),
    });

    expect(result.ranking.opportunities[0]?.kind).toBe('transform');
  });
});

describe('cooking rows', () => {
  const market = () => ({
    ...MARKET,
    quotes: {
      ...MARKET.quotes,
      [String(RAW_MONKFISH.id)]: RAW_MONKFISH,
      [String(MONKFISH.id)]: MONKFISH,
    },
  });

  it('prices a cook above its no-burn level and records that level', () => {
    const result = rankSkillActivities([COOK_MONKFISH], market(), {
      skill: 'Cooking',
      mode: 'pessimistic',
      burnLevels: BURN,
      cookingLevel: 90,
    });

    const row = result.ranking.opportunities[0];
    if (row === undefined) throw new Error('expected a cooking row');
    expect(row.noBurnLevel).toBe(90);
    // 500 gp of monkfish less 400 gp of raw monkfish, no tax under 50 gp? No:
    // 500 * 2% = 10 gp tax, so 500 - 10 - 400 = 90 gp per action.
    expect(row.tax).toBe(10);
    expect(row.profit).toBe(90);
  });

  it('drops a cook below its no-burn level instead of pricing a burn chance', () => {
    const result = rankSkillActivities([COOK_MONKFISH], market(), {
      skill: 'Cooking',
      mode: 'pessimistic',
      burnLevels: BURN,
      cookingLevel: 89,
    });

    expect(result.ranking.opportunities).toHaveLength(0);
    expect(result.coverage.unpriced).toBe(1);
  });

  it('keeps every gated row when no level is given, so the page can gate', () => {
    const result = rankSkillActivities([COOK_MONKFISH], market(), {
      skill: 'Cooking',
      mode: 'pessimistic',
      burnLevels: BURN,
    });

    expect(result.ranking.opportunities[0]?.noBurnLevel).toBe(90);
  });

  it('leaves a food with no published no-burn level unpriced', () => {
    const result = rankSkillActivities([COOK_MYSTERY], market(), {
      skill: 'Cooking',
      mode: 'pessimistic',
      burnLevels: BURN,
      cookingLevel: 99,
    });

    expect(result.ranking.opportunities).toHaveLength(0);
    expect(result.coverage.unpriced).toBe(1);
  });

  it('leaves a food that never stops burning unpriced', () => {
    const shark = { ...COOK_MONKFISH, id: 'shark', output: { name: 'Shark', quantity: 1, note: null } };
    const result = rankSkillActivities([shark], market(), {
      skill: 'Cooking',
      mode: 'pessimistic',
      burnLevels: BURN,
      cookingLevel: 99,
    });

    expect(result.ranking.opportunities).toHaveLength(0);
  });

  it('prices nothing when no burn table is supplied', () => {
    const result = rankSkillActivities([COOK_MONKFISH], market(), {
      skill: 'Cooking',
      mode: 'pessimistic',
      cookingLevel: 99,
    });

    expect(result.ranking.opportunities).toHaveLength(0);
  });
});

describe('train rows', () => {
  it('prices an unsellable output as the cost of one action', () => {
    const result = rankSkillActivities([TABLE], market([MAHOGANY_PLANK]), {
      skill: 'Construction',
      mode: 'pessimistic',
    });

    const row = result.ranking.opportunities[0];
    if (row === undefined) throw new Error('expected a construction row');
    expect(row.kind).toBe('train');
    expect(row.output).toBeNull();
    expect(row.outputName).toBe('Mahogany table');
    expect(row.spend).toBe(9000);
    expect(row.profit).toBe(-9000);
    expect(row.grossRevenue).toBe(0);
    expect(row.tax).toBe(0);
    expect(row.gpPer4h).toBe(-9000 * row.actions4h);
    expect(row.gpPerHour).toBeLessThan(0);
    expect(result.coverage.trainOnly).toBe(1);
    expect(result.coverage.profitable).toBe(0);
  });

  it('keeps an illiquid tradeable output unpriced instead of calling it a cost', () => {
    const result = rankSkillActivities(
      [ILLIQUID],
      market([FLAX, ILLIQUID_OUTPUT]),
      { skill: 'Construction', mode: 'pessimistic' },
    );

    expect(result.ranking.opportunities).toHaveLength(0);
    expect(result.coverage.trainOnly).toBe(0);
    expect(result.coverage.unpriced).toBe(1);
  });

  it('only emits train rows for the skills whose outputs cannot be sold', () => {
    // Same shape, but Crafting is a transform skill: an untradeable output there
    // is unpriced, not a "cost of training".
    const result = rankSkillActivities(
      [{ ...TABLE, skills: [{ name: 'Crafting', level: 50 }] }],
      market([MAHOGANY_PLANK]),
      { skill: 'Crafting', mode: 'pessimistic' },
    );

    expect(result.ranking.opportunities).toHaveLength(0);
    expect(result.coverage.trainOnly).toBe(0);
  });
});

describe('committed skilling artifact', () => {
  it('validates, cites every row and reconciles its coverage line', async () => {
    const payload = SkillingPayloadSchema.parse(
      JSON.parse(await readFile('data/skilling.json', 'utf8')),
    );

    expect(payload.skills.length).toBeGreaterThan(0);
    for (const catalog of payload.skills) {
      for (const mode of [catalog.pessimistic, catalog.patient]) {
        for (const row of mode.opportunities) {
          expect(row.source).toMatch(
            /^https:\/\/oldschool\.runescape\.wiki\/w\//,
          );
          expect(row.secondsPerAction === null).toBe(row.gpPerHour === null);
        }
      }

      const { coverage } = catalog;
      const rows = catalog.pessimistic.opportunities;
      expect(coverage.activities).toBe(rows.length);
      expect(coverage.profitable + coverage.lossMaking).toBe(rows.length);
      expect(coverage.trainOnly).toBe(
        rows.filter((row) => row.kind === 'train').length,
      );
      expect(coverage.upgrades).toBe(
        rows.filter((row) => row.kind === 'upgrade').length,
      );
      for (const row of rows) {
        // Only Cooking can be burn-gated, and a priced cooking row must say at
        // which level it is deterministic.
        if (catalog.skill === 'Cooking') {
          expect(row.noBurnLevel).toBeGreaterThanOrEqual(1);
        } else {
          expect(row.noBurnLevel).toBeNull();
        }
        // A train row sells nothing: no output, no revenue, cost only. An
        // upgrade always sells, so it always has an output.
        expect(row.output === null).toBe(row.kind === 'train');
        if (row.kind === 'upgrade') expect(row.output).not.toBeNull();
        if (row.kind === 'train') {
          expect(row.profit).toBe(-row.spend);
          expect(row.gpPer4h).toBeLessThanOrEqual(0);
          expect(row.gpPerHour ?? 0).toBeLessThanOrEqual(0);
        }
      }
      expect(coverage.unknownRate).toBe(
        rows.filter((row) => row.gpPerHour === null).length,
      );
      expect(coverage.unpriced).toBe(coverage.recipes - coverage.activities);
      expect(coverage.unpriced).toBeGreaterThanOrEqual(0);
    }
  });

  it('lists every scanned skill, priced or not', async () => {
    const payload = SkillingPayloadSchema.parse(
      JSON.parse(await readFile('data/skilling.json', 'utf8')),
    );

    const names = payload.skills.map((entry) => entry.skill);
    expect(names).toEqual([...SKILLING_SKILLS]);
    expect(new Set(names).size).toBe(names.length);

    // A scanned skill may legitimately price nothing: Mining, Fishing and
    // Thieving have no gathering recipe in the bucket, so their coverage line is
    // all `unpriced`. That is a finding, not a failure, so the assertion is that
    // the line reconciles — not that every skill earns.
    let priced = 0;
    for (const catalog of payload.skills) {
      const { coverage } = catalog;
      expect(coverage.activities).toBe(
        catalog.pessimistic.opportunities.length,
      );
      expect(coverage.profitable + coverage.lossMaking).toBe(
        coverage.activities,
      );
      expect(coverage.unpriced).toBe(coverage.recipes - coverage.activities);
      priced += coverage.activities;
    }
    expect(priced).toBeGreaterThan(1000);
  });
});
