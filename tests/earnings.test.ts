import { describe, expect, it } from 'vitest';

import {
  type SkillActivityRow,
  buildEarnings,
  sellableAcrossWorlds,
  shopRowFromOpportunity,
  shopRowFromSink,
} from '../src/domain/earnings.js';
import type { ShopAccessEntry, SkillActivity } from '../src/types.js';
import type {
  Opportunity,
  ProcessOpportunity,
  ShopSinkOpportunity,
} from '../src/types.js';

/** Bob's Brilliant Axes: sells at 100.0%, buys at 60.0%, ±2.0% per unit. */
function opportunity(overrides: Partial<Opportunity> = {}): Opportunity {
  return {
    itemId: 1,
    itemName: 'Steel axe',
    shopPage: "Bob's Brilliant Axes.",
    shopName: "Bob's Brilliant Axes",
    soldBy: 'Bob',
    location: 'Lumbridge',
    members: false,
    shopTypes: ['Axe shops'],

    firstUnitCost: 120,
    lastUnitCost: 120,
    totalCost: 360,

    sellPrice: 900,
    taxPerUnit: 18,
    netSellPerUnit: 882,

    units: 3,
    avgCost: 120,
    margin: 762,
    marginPct: 635,
    totalProfit: 2286,

    baseStock: 3,
    infiniteStock: false,
    restockTicks: 100,
    stackable: true,
    bankTiles: 10,
    nearestBank: 'Lumbridge bank',

    itemValue: 200,
    sellMultiplier: 1000,
    buyMultiplier: 600,
    delta: 20,

    geBuyLimit: 100,
    volume4h: 30,
    sellablePer4h: 3,
    // The artifact's placeholder equals gp/4h and must never be read as an
    // hourly rate: it is four times the real number.
    gpPer4h: 12_345,
    worldsToFill4h: 10,
    gpPerHour: 12_345,
    ...overrides,
  };
}

/** Grum's Gold Exchange, as `data/shop-sinks.json` records it. */
function sink(overrides: Partial<ShopSinkOpportunity> = {}): ShopSinkOpportunity {
  return {
    itemId: 1660,
    itemName: 'Ruby necklace',
    shopPage: "Grum's Gold Exchange.",
    shopName: "Grum's Gold Exchange",
    soldBy: "Grum's Gold Exchange.",
    location: 'Port Sarim',
    members: false,
    shopTypes: ['Shops'],

    itemValue: 2175,
    buyMultiplier: 700,
    delta: 20,
    baseStock: 0,
    infiniteStock: false,

    geBuyPrice: 902,
    shopFirstUnitPrice: 1522,
    shopLastUnitPrice: 913,
    shopAvgPrice: 1217.7333333333333,

    units: 3000,
    totalCost: 2_706_000,
    totalRevenue: 3_653_200,
    profit: 947_200,
    margin: 315.73333333333335,
    marginPct: 35.003695491500366,

    geBuyLimit: 18_000,
    volume4h: 165_564,
    purchaseCap4h: 18_000,
    unitsPerWorld: 15,
    worlds: 200,
    worldLimited: true,
    budgetLimited: false,
    priceLimited: true,
    atFloor: false,

    deltaPct: 2,
    priceDropPerUnit: 43.5,

    geTiles: 286.6,
    tripSeconds: 346.92,
    timeSeconds: 2400,
    gpPerHour: 1_420_800,
    ...overrides,
  };
}

/** Blood runes at the Blood Altar, as `data/process.json` records them. */
function recipe(overrides: Partial<ProcessOpportunity> = {}): ProcessOpportunity {
  return {
    recipeId: 'blood rune|1|||1|Blood Altar|Blood tiara|members|runecraft:77|pure essencex1:',
    output: {
      itemId: 565,
      itemName: 'Blood rune',
      quantity: 1,
      price: 334,
      volume4h: 5_242_088,
      geBuyLimit: 25_000,
    },
    inputs: [
      {
        itemId: 7936,
        itemName: 'Pure essence',
        quantity: 1,
        price: 2,
        volume4h: 4_281_663,
        geBuyLimit: 30_000,
      },
    ],
    method: null,
    facility: 'Blood Altar',
    tools: 'Blood tiara',
    members: true,
    skills: [{ name: 'Runecraft', level: 77 }],
    source: 'https://oldschool.runescape.wiki/w/Blood_rune',

    itemCost: 2,
    feeGp: 0,
    spend: 2,
    grossRevenue: 334,
    tax: 6,
    netRevenue: 328,
    profit: 326,
    marginPct: 16_300,

    ticks: 1,
    secondsPerAction: 0.6,
    marketActions4h: 30_000,
    timeActions4h: 24_000,
    actions4h: 24_000,
    gpPer4h: 7_824_000,
    gpPerHour: 1_956_000,
    ...overrides,
  };
}

/** The same blood rune, as `data/skilling.json` records it. */
function activity(
  overrides: Partial<SkillActivity> = {},
): SkillActivity {
  return {
    ...recipe(),
    kind: 'transform',
    outputName: 'Blood rune',
    noBurnLevel: null,
    ...overrides,
  };
}

function skillRow(
  overrides: Partial<SkillActivity> = {},
  skill = 'Runecraft',
): SkillActivityRow {
  return { skill, activity: activity(overrides) };
}

function earnings(
  input: {
    shopRuns?: readonly Opportunity[];
    shopDumps?: readonly ShopSinkOpportunity[];
    recipes?: readonly ProcessOpportunity[];
    skilling?: readonly SkillActivityRow[];
  },
  options: Parameters<typeof buildEarnings>[1] = {},
) {
  return buildEarnings(
    {
      shopRuns: input.shopRuns ?? [],
      shopDumps: input.shopDumps ?? [],
      recipes: input.recipes ?? [],
      skilling: input.skilling ?? [],
    },
    options,
  );
}

const REGICIDE: ShopAccessEntry = {
  shopPage: "Bob's Brilliant Axes.",
  requirement: 'Regicide',
  kind: 'quest',
  source: 'https://oldschool.runescape.wiki/w/Regicide',
};

describe('buildEarnings: shop runs', () => {
  it('re-plans the row instead of trusting the artifact placeholder', () => {
    const result = earnings({ shopRuns: [opportunity()] });

    expect(result.methods).toHaveLength(1);
    const [method] = result.methods;
    // Ten worlds of three units: 200 + 204 + 208 gp each = 6,120 gp spent,
    // 30 × 882 gp net = 26,460 gp back over a 4h sell window.
    expect(method?.capitalGp).toBe(6120);
    expect(method?.profitGp).toBe(20_340);
    expect(method?.timeSeconds).toBe(14_400);
    expect(method?.gpPerHour).toBe(5085);
    // The old placeholder (12,345) would have overstated the rate by 2.4×.
    expect(method?.gpPerHour).not.toBe(12_345);
  });

  it('sizes to the gold it is given', () => {
    const result = earnings({ shopRuns: [opportunity()] }, { goldGp: 1000 });
    const [method] = result.methods;

    // 1,000 gp covers one full world (612 gp) and one unit of the next (200 gp).
    expect(method?.capitalGp).toBe(812);
    expect(method?.profitGp).toBe(2716);
    // Four units are 4/30 of the 4h slice the GE would absorb.
    expect(method?.timeSeconds).toBe(1920);
    expect(method?.gpPerHour).toBe(5092.5);
  });

  it('is hop-bound, not market-bound, when the market is deep', () => {
    const row = opportunity({
      volume4h: 300_000,
      sellablePer4h: 3,
      stackable: true,
    });
    const [method] = earnings({ shopRuns: [row] }).methods;

    // 200 worlds × 3 units = 600 units. The GE absorbs that in 28.8 s, so the
    // 200 ten-second hops are the bottleneck.
    expect(method?.profitGp).toBe(406_800);
    expect(method?.timeSeconds).toBe(2000);
    expect(method?.gpPerHour).toBe(732_240);
  });

  it('drops a row whose bank time cannot be computed, and counts it', () => {
    const row = opportunity({
      volume4h: 300_000,
      stackable: false,
      bankTiles: null,
    });
    const result = earnings({ shopRuns: [row] });

    // 600 units need 22 bank trips, and the wiki map gives no distance.
    expect(result.methods).toHaveLength(0);
    expect(result.unranked).toBe(1);
    // The artifact still carries a (placeholder) hourly number; it is not used.
    expect(row.gpPerHour).toBe(12_345);
  });

  it('counts a row with no sell-side volume as unexecutable, not unaffordable', () => {
    const result = earnings(
      { shopRuns: [opportunity({ volume4h: 0 })] },
      { goldGp: 1_000_000 },
    );
    expect(result.methods).toHaveLength(0);
    expect(result.unexecutable).toBe(1);
    expect(result.unaffordable).toBe(0);
  });

  it('counts a row the gold cannot fund', () => {
    const result = earnings({ shopRuns: [opportunity()] }, { goldGp: 1 });
    expect(result.methods).toHaveLength(0);
    expect(result.unaffordable).toBe(1);
  });

  it('carries the curated access requirement and its citation', () => {
    const access = new Map([[REGICIDE.shopPage, REGICIDE]]);
    const [method] = earnings({ shopRuns: [opportunity()] }, { access }).methods;

    expect(method?.requirements).toEqual(['Regicide']);
    expect(method?.requirementSource).toBe(REGICIDE.source);
    expect(method?.locked).toBe(true);
    expect(method?.where).toBe("Bob's Brilliant Axes");
    expect(method?.detail).toBe('Lumbridge');
  });

  it('treats a shop missing from the access table as unknown, not locked', () => {
    const [method] = earnings({ shopRuns: [opportunity()] }).methods;
    expect(method?.requirements).toEqual([]);
    expect(method?.locked).toBe(false);
  });
});

describe('buildEarnings: shop dumps', () => {
  it('reproduces the detail page plan at the same settings', () => {
    const [method] = earnings({ shopDumps: [sink()] }).methods;

    expect(method?.kind).toBe('shop-dump');
    expect(method?.capitalGp).toBe(2_706_000);
    expect(method?.profitGp).toBe(947_200);
    expect(method?.timeSeconds).toBe(2400);
    expect(method?.gpPerHour).toBe(1_420_800);
  });

  it('drops a flip whose GE distance is unknown', () => {
    const result = earnings({ shopDumps: [sink({ geTiles: null })] });
    expect(result.methods).toHaveLength(0);
    expect(result.unranked).toBe(1);
  });

  it('counts a flip the GE cannot supply', () => {
    const result = earnings(
      { shopDumps: [sink({ purchaseCap4h: 0 })] },
      { goldGp: 1_000_000 },
    );
    expect(result.methods).toHaveLength(0);
    expect(result.unexecutable).toBe(1);
  });

  it('sizes the purchase to the gold budget', () => {
    const [method] = earnings(
      { shopDumps: [sink()] },
      { goldGp: 902 * 100 },
    ).methods;

    expect(method?.capitalGp).toBe(90_200);
    // 100 units sold into a fresh world's falling curve.
    expect(method?.profitGp).toBeGreaterThan(0);
    expect(method?.gpPerHour).toBeGreaterThan(0);
  });
});

describe('buildEarnings: processing', () => {
  it('prices the whole 4h window when gold is uncapped', () => {
    const [method] = earnings({ recipes: [recipe()] }).methods;

    expect(method?.kind).toBe('processing');
    expect(method?.capitalGp).toBe(48_000);
    expect(method?.profitGp).toBe(7_824_000);
    expect(method?.timeSeconds).toBe(14_400);
    expect(method?.gpPerHour).toBe(1_956_000);
    expect(method?.requirements).toEqual(['Runecraft 77']);
    expect(method?.where).toBe('Pure essence ×1');
    expect(method?.detail).toBe('Blood Altar');
  });

  it('keeps the rate and shrinks the run when gold binds', () => {
    const [method] = earnings({ recipes: [recipe()] }, { goldGp: 1000 }).methods;

    expect(method?.capitalGp).toBe(1000);
    expect(method?.profitGp).toBe(163_000);
    expect(method?.timeSeconds).toBe(300);
    expect(method?.gpPerHour).toBe(1_956_000);
  });

  it('drops a recipe with no published tick time', () => {
    const result = earnings({
      recipes: [recipe({ gpPerHour: null, timeActions4h: null })],
    });
    expect(result.methods).toHaveLength(0);
    expect(result.unranked).toBe(1);
  });

  it('never reports a skill level it does not have', () => {
    const [method] = earnings({
      recipes: [recipe({ skills: [{ name: 'Runecraft', level: null }] })],
    }).methods;
    expect(method?.requirements).toEqual(['Runecraft']);
    // Skills are shown, not enforced: they are not shop access locks.
    expect(method?.locked).toBe(false);
  });
});

describe('buildEarnings: the leaderboard', () => {
  it('ranks by gp/hour across families and keeps a total order', () => {
    const result = earnings({
      shopRuns: [opportunity()],
      shopDumps: [sink()],
      recipes: [recipe()],
    });

    expect(result.methods.map((method) => method.kind)).toEqual([
      'processing',
      'shop-dump',
      'shop-run',
    ]);
  });

  it('breaks ties on profit, then kind, then name, then identity', () => {
    const first = opportunity({
      itemName: 'B axe',
      itemId: 2,
      shopPage: 'B shop.',
      shopName: 'B shop',
    });
    const second = opportunity({
      itemName: 'A axe',
      itemId: 3,
      shopPage: 'A shop.',
      shopName: 'A shop',
    });
    const result = earnings({ shopRuns: [first, second] });

    // Identical gp/hour and profit: the name decides, deterministically.
    expect(result.methods.map((method) => method.name)).toEqual([
      'A axe',
      'B axe',
    ]);
  });

  it('does not mutate the payload arrays it is given', () => {
    const rows = [opportunity({ itemName: 'Z axe' }), opportunity({ itemName: 'A axe' })];
    const before = rows.map((row) => row.itemName);
    earnings({ shopRuns: rows });
    expect(rows.map((row) => row.itemName)).toEqual(before);
  });

  it('returns an empty, honest result for no data', () => {
    expect(earnings({})).toEqual({
      methods: [],
      unranked: 0,
      unexecutable: 0,
      unaffordable: 0,
      duplicated: 0,
    });
  });
});

describe('buildEarnings: skilling rows', () => {
  it('ranks a profitable activity and links it to the skilling page', () => {
    const result = earnings({ skilling: [skillRow()] });

    expect(result.methods).toHaveLength(1);
    const row = result.methods[0];
    if (row === undefined) throw new Error('expected a skilling row');
    expect(row.kind).toBe('skilling');
    expect(row.name).toBe('Blood rune');
    expect(row.where).toBe('Pure essence ×1');
    expect(row.gpPerHour).toBe(1_956_000);
    expect(row.target).toEqual({ page: 'skilling', query: 'Blood rune' });
    expect(result.duplicated).toBe(0);
  });

  it('never ranks a cost-to-train row, because it sells nothing', () => {
    const result = earnings({
      skilling: [skillRow({ kind: 'train', profit: -500, gpPerHour: -1000 })],
    });

    expect(result.methods).toHaveLength(0);
    // Not "unranked" and not "unexecutable": it is not a way to earn at all.
    expect(result.unranked).toBe(0);
    expect(result.unexecutable).toBe(0);
  });

  it('drops a row whose recipe the processing family already ranks', () => {
    const result = earnings({
      recipes: [recipe()],
      skilling: [skillRow()],
    });

    expect(result.methods).toHaveLength(1);
    expect(result.methods[0]?.kind).toBe('processing');
    expect(result.duplicated).toBe(1);
  });

  it('counts a row with no published rate as unranked', () => {
    const result = earnings({
      skilling: [skillRow({ gpPerHour: null, secondsPerAction: null, ticks: null })],
    });

    expect(result.methods).toHaveLength(0);
    expect(result.unranked).toBe(1);
  });

  it('sizes the plan to the player gold', () => {
    // One action costs 2 gp, so 1 gp funds nothing.
    const poor = earnings({ skilling: [skillRow()] }, { goldGp: 1 });
    expect(poor.methods).toHaveLength(0);
    expect(poor.unaffordable).toBe(1);

    // 20 gp funds ten actions of the 24,000 the market allows.
    const rich = earnings({ skilling: [skillRow()] }, { goldGp: 20 });
    const row = rich.methods[0];
    if (row === undefined) throw new Error('expected a funded row');
    expect(row.capitalGp).toBe(20);
    expect(row.profitGp).toBe(10 * 326);
  });

  it('treats the no-burn level as a requirement for cooking', () => {
    const result = earnings({
      skilling: [
        skillRow({
          outputName: 'Monkfish',
          noBurnLevel: 90,
          skills: [{ name: 'Cooking', level: 62 }],
        }),
      ],
    });

    const row = result.methods[0];
    if (row === undefined) throw new Error('expected a cooking row');
    expect(row.requirements).toEqual(['Cooking 62', 'Cooking 90 to not burn']);
  });
});

describe('row builders', () => {
  it('rebuilds the shop price curve from an opportunity', () => {
    expect(shopRowFromOpportunity(opportunity())).toEqual({
      itemValue: 200,
      sellMultiplier: 1000,
      buyMultiplier: 600,
      delta: 20,
      baseStock: 3,
      infiniteStock: false,
    });
  });

  it('rebuilds the buy side of the curve from a sink row', () => {
    const row = shopRowFromSink(sink({ baseStock: null }));
    expect(row.buyMultiplier).toBe(700);
    expect(row.baseStock).toBe(0);
    // The sell multiplier is unused on this side, so it is neutral.
    expect(row.sellMultiplier).toBe(1000);
  });

  it('caps shop runs at the GE 4h slice, never the buy limit', () => {
    expect(sellableAcrossWorlds(opportunity({ volume4h: 30, geBuyLimit: 100 }))).toBe(30);
  });
});
