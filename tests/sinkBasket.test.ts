import { describe, expect, it } from 'vitest';
import {
  planShopSinkBasket,
  type ShopSinkBasketItem,
  type ShopSinkBasketOptions,
} from '../src/domain/sinkBasket.js';
import type { ShopRow } from '../src/domain/shopPrice.js';

function flatRow(value: number): ShopRow {
  return {
    itemValue: value,
    sellMultiplier: 1000,
    buyMultiplier: 1000,
    delta: 0,
    baseStock: 0,
  };
}

/** Bob's axe: 120, 116, 112, 108, 104 on a fresh world. */
const BOBS_AXE: ShopRow = {
  itemValue: 200,
  sellMultiplier: 1000,
  buyMultiplier: 600,
  delta: 20,
  baseStock: 3,
};

function item(
  id: string,
  row: ShopRow,
  cost: number,
  cap: number,
  members = false,
): ShopSinkBasketItem {
  return {
    id,
    name: id,
    row,
    geCostPerUnit: cost,
    purchaseCap4h: cap,
    members,
  };
}

function options(
  overrides: Partial<ShopSinkBasketOptions> = {},
): ShopSinkBasketOptions {
  return {
    geTiles: 10,
    secondsPerTile: 0.6,
    handoverSeconds: 3,
    hopSeconds: 10,
    ...overrides,
  };
}

describe('planShopSinkBasket', () => {
  it('shares world hops and the GE trip across items', () => {
    const plan = planShopSinkBasket(
      [item('A', flatRow(200), 100, 10), item('B', flatRow(100), 50, 20)],
      2000,
      options(),
    );

    expect(plan.units).toBe(30);
    expect(plan.totalCost).toBe(2000);
    expect(plan.profit).toBe(2000);
    expect(plan.leftover).toBe(0);
    expect(plan.worlds).toBe(1); // not one world per item
    expect(plan.tripSeconds).toBe(15);
    expect(plan.hopSecondsTotal).toBe(10);
    expect(plan.buySeconds).toBe(14_400);
    expect(plan.timeSeconds).toBe(14_400);
    expect(plan.gpPerHour).toBe(500);
    expect(plan.budgetLimited).toBe(false);
    expect(plan.worldLimited).toBe(false);
  });

  it('allocates shared gold by profit per coin', () => {
    // Equal efficiency (1.0); the larger absolute margin wins the tie, so A is
    // taken first. 120 gp buys one 100 gp unit of A and leaves 20.
    const plan = planShopSinkBasket(
      [item('A', flatRow(200), 100, 10), item('B', flatRow(100), 50, 20)],
      120,
      options(),
    );

    expect(plan.units).toBe(1);
    expect(plan.totalCost).toBe(100);
    expect(plan.profit).toBe(100);
    expect(plan.leftover).toBe(20);
    expect(plan.budgetLimited).toBe(true);
    expect(plan.items[0]?.units).toBe(1);
    expect(plan.items[1]?.units).toBe(0);
  });

  it('buys nothing when gold cannot cover the cheapest unit', () => {
    const plan = planShopSinkBasket(
      [item('A', flatRow(200), 100, 10), item('B', flatRow(100), 50, 20)],
      30,
      options(),
    );

    expect(plan.units).toBe(0);
    expect(plan.profit).toBe(0);
    expect(plan.leftover).toBe(30);
    expect(plan.timeSeconds).toBe(0);
    expect(plan.gpPerHour).toBe(0);
    expect(plan.budgetLimited).toBe(true);
  });

  it('uses the longest batch to decide the shared world count', () => {
    // A needs 12/5 = 3 worlds; B needs 3/3 = 1. The basket hops 3 times, not 4.
    const plan = planShopSinkBasket(
      [item('A', BOBS_AXE, 100, 12), item('B', flatRow(100), 50, 3)],
      1350,
      options(),
    );

    expect(plan.units).toBe(15);
    expect(plan.items[0]?.units).toBe(12);
    expect(plan.items[1]?.units).toBe(3);
    expect(plan.worlds).toBe(3);
    expect(plan.hopSecondsTotal).toBe(30);
    expect(plan.tripSeconds).toBe(15);
    expect(plan.totalCost).toBe(1350);
    expect(plan.profit).toBe(306);
    expect(plan.gpPerHour).toBe(76.5);
  });

  it('respects the world ceiling per item', () => {
    const plan = planShopSinkBasket(
      [item('A', BOBS_AXE, 100, 12), item('B', flatRow(100), 50, 3)],
      2000,
      options({ maxWorlds: 1 }),
    );

    expect(plan.items[0]?.units).toBe(5); // one batch
    expect(plan.items[1]?.units).toBe(3);
    expect(plan.worlds).toBe(1);
    expect(plan.worldLimited).toBe(true);
    expect(plan.leftover).toBe(1350);
  });

  it('schedules concurrent GE buys across offer slots', () => {
    const four = [
      item('A', flatRow(200), 100, 10),
      item('B', flatRow(200), 100, 10),
      item('C', flatRow(200), 100, 10),
      item('D', flatRow(200), 100, 10),
    ];

    const free = planShopSinkBasket(four, 4000, options());
    expect(free.units).toBe(40);
    expect(free.offerSlots).toBe(3);
    expect(free.buySeconds).toBe(28_800); // four 4h jobs on three lanes

    const members = planShopSinkBasket(four, 4000, options());
    expect(members.offerSlots).toBe(3); // no members flag
    const membersItems = four.map((entry, index) => ({
      ...entry,
      members: index === 0,
    }));
    const withMembers = planShopSinkBasket(membersItems, 4000, options());
    expect(withMembers.offerSlots).toBe(8);
    expect(withMembers.buySeconds).toBe(14_400);
  });

  it('knows a zero when nothing is bought, even with no GE distance', () => {
    const plan = planShopSinkBasket(
      [item('A', flatRow(200), 100, 10)],
      0,
      options({ geTiles: null }),
    );

    expect(plan.units).toBe(0);
    expect(plan.timeSeconds).toBe(0);
    expect(plan.gpPerHour).toBe(0);
    expect(plan.timeKnown).toBe(false);
  });

  it('reports profit but an unknown rate when the GE distance is unknown', () => {
    const plan = planShopSinkBasket(
      [item('A', flatRow(200), 100, 10)],
      1000,
      options({ geTiles: null }),
    );

    expect(plan.units).toBe(10);
    expect(plan.profit).toBe(1000);
    expect(plan.tripSeconds).toBeNull();
    expect(plan.timeKnown).toBe(false);
    expect(plan.gpPerHour).toBeNull();
  });

  it('reports the per-item batch, prices and price limit', () => {
    const plan = planShopSinkBasket(
      [item('A', BOBS_AXE, 100, 12), item('B', flatRow(100), 50, 3)],
      1350,
      options(),
    );

    const a = plan.items[0];
    expect(a?.unitsPerWorld).toBe(5);
    expect(a?.firstUnitPrice).toBe(120);
    expect(a?.lastUnitPrice).toBe(104);
    expect(a?.priceLimited).toBe(true);
    expect(a?.avgShopPrice).toBeCloseTo((1200 + 156) / 12, 6);

    const b = plan.items[1];
    expect(b?.unitsPerWorld).toBe(3);
    expect(b?.firstUnitPrice).toBe(100);
    expect(b?.priceLimited).toBe(false); // the cap ended it, not the price
    expect(b?.avgShopPrice).toBe(100);
  });

  it('echoes items in input order and totals revenue as cost + profit', () => {
    const plan = planShopSinkBasket(
      [item('A', flatRow(200), 100, 10), item('B', flatRow(100), 50, 20)],
      2000,
      options(),
    );

    expect(plan.items.map((entry) => entry.id)).toEqual(['A', 'B']);
    expect(plan.totalRevenue).toBe(plan.totalCost + plan.profit);
    expect(plan.items[0]?.totalRevenue).toBe(1000 + 1000);
    expect(plan.items[1]?.totalRevenue).toBe(1000 + 1000);
  });
});
