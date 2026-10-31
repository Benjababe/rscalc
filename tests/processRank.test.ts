import { describe, expect, it } from 'vitest';
import { rankProcess, secondsPerAction } from '../src/engine/processRank.js';
import type { RawRecipe } from '../src/api/wikiRecipes.js';
import type {
  MarketQuote,
  MarketSnapshot,
  ProcessOpportunity,
  ProcessRanking,
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

function first(result: ProcessRanking): ProcessOpportunity {
  const opportunity = result.opportunities[0];
  if (opportunity === undefined) throw new Error('expected an opportunity');
  return opportunity;
}

const FLAX = quote({ id: 1, name: 'Flax' });
const BOW_STRING = quote({
  id: 2,
  name: 'Bow string',
  limit: 13_000,
  high: 30,
  low: 20,
  highVolume24h: 1200,
  lowVolume24h: 600,
});

describe('secondsPerAction', () => {
  it('converts ticks at 0.6s each', () => {
    expect(secondsPerAction(1)).toBeCloseTo(0.6);
    expect(secondsPerAction(5)).toBeCloseTo(3);
  });

  it('treats a zero-tick action as eight actions per tick, like Module:Recipe', () => {
    expect(secondsPerAction(0)).toBeCloseTo(0.075);
  });

  it('never invents a time when ticks are unknown', () => {
    expect(secondsPerAction(null)).toBeNull();
    expect(secondsPerAction(Number.NaN)).toBeNull();
    expect(secondsPerAction(-1)).toBeNull();
  });
});

describe('rankProcess', () => {
  it('prices the pessimistic mode as instant buy high / instant sell low', () => {
    const result = rankProcess([recipe()], market([FLAX, BOW_STRING]), {
      mode: 'pessimistic',
    });
    const opp = first(result);

    expect(opp.inputs).toHaveLength(1);
    expect(opp.inputs[0]?.price).toBe(10);
    expect(opp.output.price).toBe(20);
    expect(opp.spend).toBe(10);
    expect(opp.netRevenue).toBe(20);
    expect(opp.profit).toBe(10);
    expect(opp.tax).toBe(0);

    // Flax 4h = 6000/6 = 1000 units, but its 100 buy limit binds.
    // Bow string 4h = 600/6 = 100 units, so the market cap is 100 actions.
    expect(opp.marketActions4h).toBe(100);
    expect(opp.secondsPerAction).toBeCloseTo(1.8);
    expect(opp.timeActions4h).toBe(8000);
    expect(opp.actions4h).toBe(100);
    expect(opp.gpPer4h).toBe(1000);
    expect(opp.gpPerHour).toBe(250);
  });

  it('prices the patient mode as resting buy low / resting sell high', () => {
    const result = rankProcess([recipe()], market([FLAX, BOW_STRING]), {
      mode: 'patient',
    });
    const opp = first(result);

    expect(opp.inputs[0]?.price).toBe(8);
    expect(opp.output.price).toBe(30);
    expect(opp.spend).toBe(8);
    expect(opp.netRevenue).toBe(30);
    expect(opp.profit).toBe(22);
    expect(opp.marketActions4h).toBe(100);
    expect(opp.gpPer4h).toBe(2200);
    expect(opp.gpPerHour).toBe(550);
  });

  it('charges GE tax on the output leg only', () => {
    const result = rankProcess(
      [recipe()],
      market([
        FLAX,
        quote({
          id: 2,
          name: 'Bow string',
          high: 100,
          low: 100,
          highVolume24h: 1200,
          lowVolume24h: 600,
        }),
      ]),
      { mode: 'pessimistic' },
    );
    const opp = first(result);

    expect(opp.grossRevenue).toBe(100);
    expect(opp.tax).toBe(2);
    expect(opp.netRevenue).toBe(98);
    expect(opp.profit).toBe(88);
  });

  it('treats Coins as a fee rather than a GE input', () => {
    const leather = recipe({
      id: 'leather',
      page: 'Leather',
      method: 'Normal tanner',
      ticks: 1,
      materials: [
        { name: 'Cowhide', quantity: 1, note: null },
        { name: 'Coins', quantity: 3, note: null },
      ],
      output: { name: 'Leather', quantity: 1, note: null },
      facilities: 'Tannery',
      members: false,
      skills: [],
    });

    const result = rankProcess(
      [leather],
      market([
        quote({ id: 3, name: 'Cowhide', high: 10, low: 9 }),
        quote({
          id: 4,
          name: 'Leather',
          high: 40,
          low: 30,
          highVolume24h: 1200,
          lowVolume24h: 600,
        }),
      ]),
      { mode: 'patient' },
    );
    const opp = first(result);

    expect(opp.inputs).toHaveLength(1);
    expect(opp.inputs[0]?.itemName).toBe('Cowhide');
    expect(opp.feeGp).toBe(3);
    expect(opp.spend).toBe(12);
    expect(opp.netRevenue).toBe(40);
    expect(opp.profit).toBe(28);
  });

  it('caps inputs by the GE buy limit and the 24h volume', () => {
    const limited = quote({
      id: 1,
      name: 'Flax',
      limit: 10,
      highVolume24h: 6000,
    });
    const result = rankProcess([recipe()], market([limited, BOW_STRING]), {
      mode: 'pessimistic',
    });
    expect(first(result).marketActions4h).toBe(10);
  });

  it('caps the sale by output volume, never by the output buy limit', () => {
    const scarce = quote({
      id: 2,
      name: 'Bow string',
      limit: 1,
      high: 30,
      low: 20,
      lowVolume24h: 60,
      highVolume24h: 1200,
    });
    const result = rankProcess([recipe()], market([FLAX, scarce]), {
      mode: 'pessimistic',
    });
    const opp = first(result);

    // 60/6 = 10 units of 4h demand; the output's buy limit of 1 is irrelevant
    // because the buy limit caps purchases, not sales.
    expect(opp.marketActions4h).toBe(10);
  });

  it('leaves gp/hour unknown when the wiki publishes no ticks', () => {
    const result = rankProcess(
      [recipe({ ticks: null })],
      market([FLAX, BOW_STRING]),
      { mode: 'pessimistic' },
    );
    const opp = first(result);

    expect(opp.secondsPerAction).toBeNull();
    expect(opp.timeActions4h).toBeNull();
    expect(opp.actions4h).toBe(100);
    expect(opp.gpPerHour).toBeNull();
  });

  it('caps the time plan and gp/hour at the player actions/hour rate', () => {
    const richFlax = quote({
      id: 1,
      name: 'Flax',
      limit: 100_000,
      highVolume24h: 6_000_000,
      lowVolume24h: 6_000_000,
    });
    const richBowString = quote({
      id: 2,
      name: 'Bow string',
      high: 30,
      low: 20,
      highVolume24h: 6_000_000,
      lowVolume24h: 6_000_000,
    });

    const result = rankProcess(
      [recipe({ ticks: 1 })],
      market([richFlax, richBowString]),
      { mode: 'pessimistic', maxActionsPerHour: 500 },
    );
    const opp = first(result);

    // 1 tick = 6,000/h raw -> 24,000 actions/4h. The 500/h cap allows 2,000.
    expect(opp.timeActions4h).toBe(2_000);
    expect(opp.actions4h).toBe(2_000);
    expect(opp.gpPer4h).toBe(20_000);
    expect(opp.gpPerHour).toBe(5_000);
    expect(result.filters.maxActionsPerHour).toBe(500);
  });

  it('does not speed a slow recipe up with a high cap', () => {
    const richFlax = quote({
      id: 1,
      name: 'Flax',
      limit: 100_000,
      highVolume24h: 6_000_000,
      lowVolume24h: 6_000_000,
    });
    const richBowString = quote({
      id: 2,
      name: 'Bow string',
      high: 30,
      low: 20,
      highVolume24h: 6_000_000,
      lowVolume24h: 6_000_000,
    });

    const result = rankProcess(
      [recipe({ ticks: 5 })],
      market([richFlax, richBowString]),
      { mode: 'pessimistic', maxActionsPerHour: 100_000 },
    );
    const opp = first(result);

    // 5 ticks = 3s -> 1,200/h raw -> 4,800/4h, below the 100,000/h cap.
    expect(opp.timeActions4h).toBe(4_800);
    expect(opp.gpPerHour).toBe(12_000);
  });

  it('records a cap but never invents a rate for unknown ticks', () => {
    const result = rankProcess([recipe({ ticks: null })], market([FLAX, BOW_STRING]), {
      mode: 'pessimistic',
      maxActionsPerHour: 500,
    });
    const opp = first(result);

    expect(opp.timeActions4h).toBeNull();
    expect(opp.gpPerHour).toBeNull();
    expect(result.filters.maxActionsPerHour).toBe(500);
  });

  it('excludes Cooking, chance/average notes and fractional quantities', () => {
    const cooking = recipe({
      id: 'cooking',
      skills: [{ name: 'Cooking', level: 1 }],
    });
    const chance = recipe({
      id: 'chance',
      output: {
        name: 'Bow string',
        quantity: 1,
        note: '50% chance without ring of forging',
      },
    });
    const fractional = recipe({
      id: 'fractional',
      output: { name: 'Bow string', quantity: 28.8, note: null },
    });

    const result = rankProcess(
      [cooking, chance, fractional],
      market([FLAX, BOW_STRING]),
      { mode: 'pessimistic' },
    );

    expect(result.opportunities).toHaveLength(0);
  });

  it('aggregates repeated materials before applying the supply cap', () => {
    const duplicate = recipe({
      id: 'duplicate-flax',
      materials: [
        { name: 'Flax', quantity: 1, note: null },
        { name: 'Flax', quantity: 1, note: null },
      ],
    });
    const oneFlax = quote({
      id: 1,
      name: 'Flax',
      limit: 1,
      highVolume24h: 6000,
    });
    const richBowString = quote({
      id: 2,
      name: 'Bow string',
      high: 120,
      low: 100,
      highVolume24h: 1200,
      lowVolume24h: 600,
    });

    const result = rankProcess([duplicate], market([oneFlax, richBowString]), {
      mode: 'pessimistic',
    });

    // One flax in supply cannot fund an action that consumes two. Checking the
    // two mat slots independently would wrongly report one action.
    expect(result.opportunities).toHaveLength(0);
  });

  it('excludes recipes with an unpriced input', () => {
    const unknown = recipe({
      id: 'unknown',
      materials: [{ name: 'Mystery dust', quantity: 1, note: null }],
    });
    const result = rankProcess([unknown], market([BOW_STRING]), {
      mode: 'pessimistic',
    });
    expect(result.opportunities).toHaveLength(0);
  });

  it('includes skill-less facility work such as tanning', () => {
    const tanning = recipe({
      id: 'tanning',
      materials: [{ name: 'Cowhide', quantity: 1, note: null }],
      output: { name: 'Leather', quantity: 1, note: null },
      facilities: 'Tannery',
      skills: [],
    });

    const result = rankProcess(
      [tanning],
      market([
        quote({ id: 3, name: 'Cowhide', high: 10, low: 9 }),
        quote({
          id: 4,
          name: 'Leather',
          high: 40,
          low: 30,
          highVolume24h: 1200,
          lowVolume24h: 600,
        }),
      ]),
      { mode: 'patient' },
    );

    expect(result.opportunities).toHaveLength(1);
    // An explicit skill filter means "only these skills", so facility-only work
    // drops out even though it is included in the default ranking.
    const filtered = rankProcess(
      [tanning],
      market([
        quote({ id: 3, name: 'Cowhide', high: 10, low: 9 }),
        quote({
          id: 4,
          name: 'Leather',
          high: 40,
          low: 30,
          highVolume24h: 1200,
          lowVolume24h: 600,
        }),
      ]),
      { mode: 'patient', skills: ['herblore'] },
    );
    expect(filtered.opportunities).toHaveLength(0);
  });

  it('filters free-to-play recipes when members-only is asked', () => {
    const freeToPlay = recipe({ members: false });

    const included = rankProcess([freeToPlay], market([FLAX, BOW_STRING]), {
      mode: 'pessimistic',
    });
    expect(included.opportunities).toHaveLength(1);

    const membersOnly = rankProcess([freeToPlay], market([FLAX, BOW_STRING]), {
      mode: 'pessimistic',
      membersOnly: true,
    });
    expect(membersOnly.opportunities).toHaveLength(0);
  });

  it('sorts known-time rows before unknown-time rows, then by gp/4h', () => {
    const known = recipe({
      id: 'known',
      ticks: 1,
      output: { name: 'Bow string', quantity: 1, note: null },
    });
    const unknown = recipe({
      id: 'unknown-time',
      ticks: null,
      output: { name: 'Bow string', quantity: 1, note: null },
    });

    const result = rankProcess([unknown, known], market([FLAX, BOW_STRING]), {
      mode: 'pessimistic',
    });

    expect(result.opportunities.map((entry) => entry.recipeId)).toEqual([
      'known',
      'unknown-time',
    ]);
    expect(result.opportunities[0]?.gpPerHour).not.toBeNull();
    expect(result.opportunities[1]?.gpPerHour).toBeNull();
  });

  it('applies the limit after sorting', () => {
    const result = rankProcess([recipe()], market([FLAX, BOW_STRING]), {
      mode: 'pessimistic',
      limit: 0,
    });
    expect(result.count).toBe(0);
    expect(result.opportunities).toHaveLength(0);
  });
});
