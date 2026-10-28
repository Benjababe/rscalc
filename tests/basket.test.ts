import { describe, expect, it } from 'vitest';

import {
  GE_OFFER_SLOTS_FREE,
  GE_OFFER_SLOTS_MEMBERS,
  planPurchaseFast,
  planShopBasket,
  type ShopBasketItem,
} from '../src/domain/basket.js';
import { planPurchase, type ShopRow } from '../src/domain/shopPrice.js';

/** Flat-priced row: every unit costs exactly `value`. */
function flat(value: number, baseStock: number): ShopRow {
  return {
    itemValue: value,
    sellMultiplier: 1000,
    buyMultiplier: 600,
    delta: 0,
    baseStock,
  };
}

function basketItem(
  id: string,
  row: ShopRow,
  netSellPerUnit: number,
  overrides: Partial<ShopBasketItem> = {},
): ShopBasketItem {
  return { id, row, netSellPerUnit, ...overrides };
}

describe('planPurchaseFast', () => {
  const axe: ShopRow = {
    itemValue: 200,
    sellMultiplier: 1000,
    buyMultiplier: 600,
    delta: 20,
    baseStock: 3,
  };
  const lowValue: ShopRow = {
    itemValue: 4,
    sellMultiplier: 1000,
    buyMultiplier: 600,
    delta: 1,
    baseStock: 200,
  };
  const flatRow = flat(10, 100);
  const overstocked: ShopRow = {
    itemValue: 100,
    sellMultiplier: 1000,
    buyMultiplier: 600,
    delta: 20,
    baseStock: 5,
  };
  const infinite: ShopRow = {
    itemValue: 10,
    sellMultiplier: 1000,
    buyMultiplier: 600,
    delta: 0,
    baseStock: 0,
    infiniteStock: true,
  };

  it('matches planPurchase across price curves, caps and nets', () => {
    const rows = [axe, lowValue, flatRow, overstocked, infinite];
    const nets = [0, 1, 3, 4, 5, 20, 130, 500];
    const caps = [undefined, 0, 1, 2, 3, 5, 10, 100, 1000];
    const starts = [undefined, 0, 1, 3, 5, 8];

    for (const row of rows) {
      for (const net of nets) {
        for (const maxUnits of caps) {
          for (const startStock of starts) {
            const options = {
              ...(maxUnits !== undefined ? { maxUnits } : {}),
              ...(startStock !== undefined ? { startStock } : {}),
            };
            const fast = planPurchaseFast(row, net, options);
            const slow = planPurchase(row, net, options);
            expect(fast, `${JSON.stringify({ row, net, options })}`).toEqual(slow);
          }
        }
      }
    }
  });

  it('skips a whole block of identical prices without changing the result', () => {
    // The 200-stock, 4 gp rune has the same 4 gp price for every unit.
    expect(planPurchaseFast(lowValue, 5).units).toBe(200);
    expect(planPurchaseFast(lowValue, 5).totalCost).toBe(800);
    expect(planPurchaseFast(lowValue, 5).lastUnitCost).toBe(4);
  });

  it('can require strictly positive marginal profit', () => {
    const flatZeroMargin = flat(10, 100);
    expect(planPurchaseFast(flatZeroMargin, 10).units).toBe(100);
    expect(
      planPurchaseFast(flatZeroMargin, 10, { minUnitProfit: 1 }).units,
    ).toBe(0);

    // Prices 10, 11, 12, 13, 14. Net 12 is profitable at 10 and 11, break-even
    // at 12, so the default takes three units and the strict rule takes two.
    const rising: ShopRow = {
      itemValue: 10,
      sellMultiplier: 1000,
      buyMultiplier: 600,
      delta: 100,
      baseStock: 5,
    };
    expect(planPurchaseFast(rising, 12).units).toBe(3);
    expect(planPurchaseFast(rising, 12, { minUnitProfit: 1 }).units).toBe(2);
  });
});

describe('planShopBasket', () => {
  it('shares world hops across stackable items', () => {
    // A and B both reset to full stock each world. Two worlds buy 200 A and
    // 100 B; charging each item its own hops would cost four hops, not two.
    const plan = planShopBasket(
      [
        basketItem('A', flat(10, 100), 20, { maxUnits: 1000, stackable: true }),
        basketItem('B', flat(20, 50), 30, { maxUnits: 1000, stackable: true }),
      ],
      4000,
      { hopSeconds: 10, bankTiles: null },
    );

    expect(plan.units).toBe(300);
    expect(plan.totalCost).toBe(4000);
    expect(plan.profit).toBe(3000);
    expect(plan.worlds).toBe(2);
    expect(plan.hopSecondsTotal).toBe(20);
    expect(plan.leftover).toBe(0);
    expect(plan.budgetLimited).toBe(false);
    expect(plan.worldLimited).toBe(false);
    expect(plan.marginLimited).toBe(false);

    expect(plan.items[0]).toMatchObject({
      id: 'A',
      units: 200,
      totalCost: 2000,
      profit: 2000,
      unitsPerWorld: 100,
      costPerWorld: 1000,
    });
    expect(plan.items[1]).toMatchObject({
      id: 'B',
      units: 100,
      totalCost: 2000,
      profit: 1000,
      unitsPerWorld: 50,
      costPerWorld: 1000,
    });

    // Sell time is scheduled across the default free-to-play 3 slots:
    // A needs 2880s (200/1000 of a 4h window), B needs 1440s.
    expect(plan.stackableSlots).toBe(2);
    expect(plan.nonStackableUnits).toBe(0);
    expect(plan.bankTrips).toBe(0);
    expect(plan.offerSlots).toBe(GE_OFFER_SLOTS_FREE);
    expect(plan.sellSeconds).toBe(2880);
    expect(plan.timeSeconds).toBe(2880);
    expect(plan.gpPerHour).toBeCloseTo(3750, 6);
  });

  it('charges bank trips across the whole non-stackable basket, not per item', () => {
    // 100 + 100 non-stackable units = 8 loads of 27 -> 7 trips, even though
    // each item alone is only 4 loads.
    const plan = planShopBasket(
      [
        basketItem('A', flat(10, 100), 20, { maxUnits: 1000, stackable: false }),
        basketItem('B', flat(10, 100), 20, { maxUnits: 1000, stackable: false }),
      ],
      2000,
      {
        hopSeconds: 10,
        bankTiles: 10,
        secondsPerTile: 0.5,
        bankHandoverSeconds: 3,
      },
    );

    expect(plan.units).toBe(200);
    expect(plan.worlds).toBe(1);
    expect(plan.stackableSlots).toBe(0);
    expect(plan.nonStackableUnits).toBe(200);
    expect(plan.unitsPerLoad).toBe(27);
    expect(plan.bankTrips).toBe(Math.ceil(200 / 27) - 1);
    expect(plan.bankSecondsPerTrip).toBe(2 * 10 * 0.5 + 3);
    expect(plan.bankSecondsTotal).toBe(7 * 13);
    expect(plan.bankTimeKnown).toBe(true);
    expect(plan.timeSeconds).toBe(Math.max(10 + 91, 1440));
    expect(plan.gpPerHour).toBeCloseTo(5000, 6);
  });

  it('reserves one slot per distinct stackable item type', () => {
    // 1 stackable type leaves 26 slots for the 27 non-stackable units, so one
    // bank trip is needed. Without the stackable type they would fit exactly.
    const stackable = basketItem('stack', flat(10, 100), 20, {
      maxUnits: 10,
      stackable: true,
    });

    const withOne = planShopBasket(
      [stackable, basketItem('loose', flat(10, 100), 20, { maxUnits: 27, stackable: false })],
      370,
      { bankTiles: 10 },
    );
    expect(withOne.stackableSlots).toBe(1);
    expect(withOne.unitsPerLoad).toBe(26);
    expect(withOne.nonStackableUnits).toBe(27);
    expect(withOne.bankTrips).toBe(1);

    const withFewer = planShopBasket(
      [stackable, basketItem('loose', flat(10, 100), 20, { maxUnits: 26, stackable: false })],
      360,
      { bankTiles: 10 },
    );
    expect(withFewer.nonStackableUnits).toBe(26);
    expect(withFewer.bankTrips).toBe(0);
  });

  it('treats unknown stackability as non-stackable', () => {
    const plan = planShopBasket(
      [basketItem('unknown', flat(10, 100), 20, { maxUnits: 30, stackable: null })],
      1000,
      { bankTiles: null },
    );
    expect(plan.units).toBe(30);
    expect(plan.stackableSlots).toBe(0);
    expect(plan.nonStackableUnits).toBe(30);
    expect(plan.bankTrips).toBe(1);
    expect(plan.bankTimeKnown).toBe(false);
    expect(plan.gpPerHour).toBeNull();
  });

  it('keeps gp/hour computable when a shop has no bank but nothing needs banking', () => {
    // Lundail's Arena-side Rune Shop has no bank on its map, but every rune is
    // stackable, so a rune-only basket never needs a bank trip.
    const plan = planShopBasket(
      [
        basketItem('fire', flat(4, 200), 5, { maxUnits: 50_000, stackable: true }),
        basketItem('air', flat(4, 200), 5, { maxUnits: 50_000, stackable: true }),
      ],
      2000,
      { hopSeconds: 10, bankTiles: null },
    );

    expect(plan.bankTrips).toBe(0);
    expect(plan.bankTimeKnown).toBe(true);
    expect(plan.gpPerHour).not.toBeNull();
    expect(plan.gpPerHour).toBeGreaterThan(0);
  });

  it('allocates a scarce budget by profit per coin', () => {
    // A: 10 gp, nets 30 -> 20 gp profit per unit, 2.0 profit/gp.
    // B: 100 gp, nets 130 -> 30 gp profit per unit, 0.3 profit/gp.
    // A budget of 200 buys all 10 A first, then one B. Buying B first would
    // spend the same 200 for less total profit.
    const plan = planShopBasket(
      [
        basketItem('A', flat(10, 10), 30, { maxUnits: 10 }),
        basketItem('B', flat(100, 10), 130, { maxUnits: 10 }),
      ],
      200,
    );

    expect(plan.worlds).toBe(1);
    expect(plan.budgetLimited).toBe(true);
    expect(plan.leftover).toBe(0);
    expect(plan.units).toBe(11);
    expect(plan.totalCost).toBe(200);
    expect(plan.profit).toBe(230);
    expect(plan.items[0]).toMatchObject({ id: 'A', units: 10, totalCost: 100, profit: 200 });
    expect(plan.items[1]).toMatchObject({ id: 'B', units: 1, totalCost: 100, profit: 30 });
  });

  it('respects each item throughput cap across worlds', () => {
    const plan = planShopBasket(
      [basketItem('A', flat(10, 100), 20, { maxUnits: 5 })],
      1000,
      { hopSeconds: 10 },
    );

    expect(plan.units).toBe(5);
    expect(plan.worlds).toBe(1);
    expect(plan.leftover).toBe(950);
    expect(plan.budgetLimited).toBe(false);
    expect(plan.worldLimited).toBe(false);
    expect(plan.items[0]).toMatchObject({
      units: 5,
      unitsPerWorld: 5,
      cap: 5,
    });
  });

  it('stops at maxWorlds and reports why', () => {
    const plan = planShopBasket(
      [basketItem('A', flat(10, 100), 20, { maxUnits: Number.POSITIVE_INFINITY })],
      10_000,
      { hopSeconds: 10, maxWorlds: 3 },
    );

    expect(plan.units).toBe(300);
    expect(plan.worlds).toBe(3);
    expect(plan.leftover).toBe(7000);
    expect(plan.budgetLimited).toBe(false);
    expect(plan.worldLimited).toBe(true);
  });

  it('does not call a throughput cap a world limit', () => {
    // 100 units in the first world, 50 in the second, then the cap is gone.
    const plan = planShopBasket(
      [basketItem('A', flat(10, 100), 20, { maxUnits: 150 })],
      10_000,
      { hopSeconds: 10, maxWorlds: 200 },
    );

    expect(plan.units).toBe(150);
    expect(plan.worlds).toBe(2);
    expect(plan.leftover).toBe(8500);
    expect(plan.budgetLimited).toBe(false);
    expect(plan.worldLimited).toBe(false);
  });

  it('hops again when a partial world leaves enough for a fresh first unit', () => {
    // Prices 60, 120, 180. Net 130. With 130 gp the single-item planner buys
    // one unit and stops; hopping to a fresh world buys a second first-unit.
    const row: ShopRow = {
      itemValue: 60,
      sellMultiplier: 1000,
      buyMultiplier: 600,
      delta: 1000,
      baseStock: 3,
    };
    const plan = planShopBasket(
      [basketItem('A', row, 130, { maxUnits: Number.POSITIVE_INFINITY })],
      130,
      { hopSeconds: 10 },
    );

    expect(plan.units).toBe(2);
    expect(plan.worlds).toBe(2);
    expect(plan.totalCost).toBe(120);
    expect(plan.leftover).toBe(10);
    expect(plan.budgetLimited).toBe(true);
    expect(plan.marginLimited).toBe(true);
    expect(plan.items[0]?.unitsPerWorld).toBe(2);
  });

  it('batches sell time across GE offer slots', () => {
    // Ten items, each a full 4h of sell volume. On the free 3 slots the last
    // offer finishes after four windows; on the members' 8 slots, after two.
    const items = Array.from({ length: 10 }, (_, index) =>
      basketItem(`item-${index}`, flat(10, 100), 20, {
        maxUnits: 100,
        stackable: true,
      }),
    );

    const free = planShopBasket(items, 10_000, { hopSeconds: 10 });
    expect(free.units).toBe(1000);
    expect(free.profit).toBe(10_000);
    expect(free.offerSlots).toBe(GE_OFFER_SLOTS_FREE);
    expect(free.sellSeconds).toBe(4 * 4 * 3600);
    expect(free.timeSeconds).toBe(4 * 4 * 3600);
    expect(free.gpPerHour).toBeCloseTo(625, 6);

    const memberItems = items.map((item, index) =>
      index === 0 ? { ...item, members: true } : item,
    );
    const members = planShopBasket(memberItems, 10_000, { hopSeconds: 10 });
    expect(members.offerSlots).toBe(GE_OFFER_SLOTS_MEMBERS);
    expect(members.sellSeconds).toBe(2 * 4 * 3600);
    expect(members.gpPerHour).toBeCloseTo(1250, 6);
  });

  it('honours an explicit offer-slot count', () => {
    const items = Array.from({ length: 4 }, (_, index) =>
      basketItem(`item-${index}`, flat(10, 100), 20, {
        maxUnits: 100,
        stackable: true,
      }),
    );
    const plan = planShopBasket(items, 4000, { hopSeconds: 0, offerSlots: 1 });
    expect(plan.offerSlots).toBe(1);
    expect(plan.sellSeconds).toBe(4 * 4 * 3600);
  });

  it('falls back to safe defaults for non-finite options', () => {
    const plan = planShopBasket(
      [basketItem('A', flat(10, 10), 20, { maxUnits: 10 })],
      200,
      {
        hopSeconds: Number.NaN,
        secondsPerTile: Number.NaN,
        bankHandoverSeconds: Number.NaN,
        unitsPerLoad: Number.NaN,
        maxWorlds: Number.NaN,
        offerSlots: Number.NaN,
      },
    );

    expect(plan.units).toBe(10);
    expect(plan.offerSlots).toBe(GE_OFFER_SLOTS_FREE);
    expect(plan.unitsPerLoad).toBe(27);
    expect(plan.gpPerHour).not.toBeNull();
    expect(Number.isFinite(plan.gpPerHour)).toBe(true);
  });

  it('buys nothing without a budget or with no profitable items', () => {
    const A = basketItem('A', flat(10, 100), 20, { maxUnits: 100 });

    const noBudget = planShopBasket([A], 0);
    expect(noBudget.units).toBe(0);
    expect(noBudget.gpPerHour).toBe(0);
    expect(noBudget.leftover).toBe(0);
    expect(noBudget.items[0]?.units).toBe(0);

    const tooExpensive = planShopBasket([A], 5);
    expect(tooExpensive.units).toBe(0);
    expect(tooExpensive.worlds).toBe(0);
    expect(tooExpensive.gpPerHour).toBe(0);
    expect(tooExpensive.leftover).toBe(5);
    expect(tooExpensive.budgetLimited).toBe(true);

    const unprofitable = planShopBasket(
      [basketItem('A', flat(10, 100), 10, { maxUnits: 100 })],
      1000,
    );
    expect(unprofitable.units).toBe(0);
    expect(unprofitable.gpPerHour).toBe(0);
    expect(unprofitable.marginLimited).toBe(true);

    const empty = planShopBasket([], 1000);
    expect(empty.items).toEqual([]);
    expect(empty.units).toBe(0);
    expect(empty.gpPerHour).toBe(0);
  });

  it('is deterministic', () => {
    const items = [
      basketItem('A', flat(10, 10), 30, { maxUnits: 10 }),
      basketItem('B', flat(100, 10), 130, { maxUnits: 10 }),
    ];
    const a = planShopBasket(items, 200, { hopSeconds: 12, bankTiles: 8 });
    const b = planShopBasket(items, 200, { hopSeconds: 12, bankTiles: 8 });
    expect(a).toEqual(b);
  });
});
