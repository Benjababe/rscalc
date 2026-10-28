import { describe, expect, it } from 'vitest';
import {
  buyTotalCost,
  planPurchase,
  sellTotalRevenue,
  shopUnitBuyPrice,
  shopUnitSellPrice,
  trunc,
  type ShopRow,
} from '../src/domain/shopPrice.js';

/**
 * The rows below are taken from the OSRS Wiki's own worked examples so that a
 * 10x unit error in `delta` or the multipliers cannot pass silently.
 *
 *  - https://oldschool.runescape.wiki/w/Shop#Pricing  (steel axe at Bob's)
 *  - https://oldschool.runescape.wiki/w/Module:Shop_calculator  (debug block)
 */

/** Bob's Brilliant Axes: Sells at 100.0%, Buys at 60.0%, Change per 2.0%. */
const BOBS_AXE: ShopRow = {
  itemValue: 200, // steel axe value
  sellMultiplier: 1000, // 100.0%
  buyMultiplier: 600, // 60.0%
  delta: 20, // 2.0%
  baseStock: 3,
};

describe('trunc', () => {
  it('truncates toward zero with the Lua epsilon guard', () => {
    expect(trunc(1.9)).toBe(1);
    expect(trunc(-1.9)).toBe(-1);
    // Without the +1e-6 guard, 0.1*3 = 0.30000000000000004 style inputs drift.
    expect(trunc(0.1 * 3)).toBe(0);
    expect(trunc(49.999)).toBe(49);
    // The epsilon deliberately pulls values that are a hair above an integer
    // down onto it, matching Lua's guard.
    expect(trunc(49.999999)).toBe(50);
    expect(trunc(50)).toBe(50);
  });
});

describe('buying from a shop', () => {
  it("matches the wiki's steel axe worked example", () => {
    // "If a player were to buy a steel axe from Bob with 3 in stock, it would
    //  cost 200 coins. If 4 steel axes were in stock, the price would be 196."
    expect(shopUnitBuyPrice(BOBS_AXE, 3)).toBe(200);
    expect(shopUnitBuyPrice(BOBS_AXE, 4)).toBe(196);
  });

  it('gets more expensive as stock falls below equilibrium', () => {
    const at2 = shopUnitBuyPrice(BOBS_AXE, 2);
    const at1 = shopUnitBuyPrice(BOBS_AXE, 1);
    const at0 = shopUnitBuyPrice(BOBS_AXE, 0);
    expect(at2).toBe(204); // 200 * (1 + 0.02)
    expect(at1).toBe(208); // 200 * (1 + 0.04)
    expect(at0).toBe(0); // cannot buy from empty stock
  });

  it('uses DIVISION when overstocked, not subtraction', () => {
    // 200 / (1*0.02 + 1.00) = 196.07 -> 196
    expect(shopUnitBuyPrice(BOBS_AXE, 4)).toBe(196);
    // 200 / (2*0.02 + 1.00) = 192.30 -> 192
    expect(shopUnitBuyPrice(BOBS_AXE, 5)).toBe(192);
    // Subtraction would give 200 - 4*4 = 184 here; division gives 175.
    // This is the assertion that actually distinguishes the two formulas.
    expect(shopUnitBuyPrice(BOBS_AXE, 10)).toBe(175);
    expect(shopUnitBuyPrice(BOBS_AXE, 10)).not.toBe(200 - 7 * 4);
  });

  it("reproduces Module:Shop_calculator debug case 1 (expects 4920)", () => {
    const row: ShopRow = {
      itemValue: 80,
      sellMultiplier: 1000, // 100.0%
      buyMultiplier: 550,
      delta: 10, // 1.0%
      baseStock: 600,
    };
    expect(buyTotalCost(row, 50, 601)).toBe(4920);
  });

  it('reproduces Module:Shop_calculator debug case 2 (expects 57)', () => {
    const row: ShopRow = {
      itemValue: 50,
      sellMultiplier: 1000,
      buyMultiplier: 600,
      delta: 30, // 3.0%
      baseStock: 10,
    };
    expect(buyTotalCost(row, 1, 5)).toBe(57);
  });

  it('clamps to the module upper bound of value*(sellsAt+5)', () => {
    // A wildly understocked row must not exceed +500% of value on top of the
    // shop's own sell multiplier: 200 * (1.0 + 5) = 1200.
    const oneUnit: ShopRow = { ...BOBS_AXE, delta: 50, baseStock: 1000 };
    expect(shopUnitBuyPrice(oneUnit, 1)).toBe(trunc(200 * 6));
    expect(shopUnitBuyPrice(oneUnit, 1)).toBe(1200);
    // And an empty shop is not purchasable at all.
    expect(shopUnitBuyPrice(oneUnit, 0)).toBe(0);
  });

  it('cannot buy more units than are in stock', () => {
    expect(buyTotalCost(BOBS_AXE, 10, 3)).toBe(
      buyTotalCost(BOBS_AXE, 3, 3),
    );
  });
});

describe('selling to a shop', () => {
  it("matches the wiki's steel axe worked example", () => {
    // "sold to ... Bob's Brilliant Axes ... for 120 coins (60%) ... with 4
    //  already in stock would yield 116 coins (58%)"
    expect(shopUnitSellPrice(BOBS_AXE, 3)).toBe(120);
    expect(shopUnitSellPrice(BOBS_AXE, 4)).toBe(116);
  });

  it('pays more when the shop is understocked', () => {
    expect(shopUnitSellPrice(BOBS_AXE, 2)).toBe(124);
    expect(shopUnitSellPrice(BOBS_AXE, 0)).toBe(132);
  });

  it('never pays less than 10% of value', () => {
    const flooded: ShopRow = { ...BOBS_AXE };
    // 200 * 0.10 = 20 is the hard floor no matter how overstocked.
    for (const stock of [20, 50, 500, 5000]) {
      expect(shopUnitSellPrice(flooded, stock)).toBeGreaterThanOrEqual(20);
    }
  });

  it("reproduces Module:Shop_calculator debug case 3 (expects 1210)", () => {
    const row: ShopRow = {
      itemValue: 80,
      sellMultiplier: 1000,
      buyMultiplier: 550, // 55.0%
      delta: 10, // 1.0%
      baseStock: 600,
    };
    expect(sellTotalRevenue(row, 50, 600)).toBe(1210);
  });

  it('decreasing revenue per unit as the shop fills up', () => {
    const first = shopUnitSellPrice(BOBS_AXE, 3);
    const after = sellTotalRevenue(BOBS_AXE, 5, 3) - sellTotalRevenue(BOBS_AXE, 4, 3);
    expect(after).toBeLessThan(first);
  });
});

describe('infinite stock shops', () => {
  const infinite: ShopRow = {
    itemValue: 100,
    sellMultiplier: 1000,
    buyMultiplier: 600,
    delta: 10,
    baseStock: 0,
    infiniteStock: true,
  };

  it('stays at the equilibrium price regardless of stock', () => {
    expect(shopUnitBuyPrice(infinite, 0)).toBe(100);
    expect(shopUnitBuyPrice(infinite, 9999)).toBe(100);
  });

  it('caps a single purchase at 10', () => {
    expect(buyTotalCost(infinite, 50, 0)).toBe(1000);
  });
});

describe('planPurchase', () => {
  it('buys up to the marginal unit that is still profitable', () => {
    // Bob's axe costs 200, 204, 208 as stock drains 3 -> 2 -> 1.
    const plan = planPurchase(BOBS_AXE, 205);
    expect(plan.units).toBe(2); // 200 and 204 fit; 208 does not
    expect(plan.totalCost).toBe(404);
    expect(plan.lastUnitCost).toBe(204);
    expect(plan.stoppedAtMargin).toBe(true);
  });

  it('buys nothing when even the first unit is unprofitable', () => {
    const plan = planPurchase(BOBS_AXE, 199);
    expect(plan.units).toBe(0);
    expect(plan.profit).toBe(0);
  });

  it('buys the whole stock when everything is profitable', () => {
    const plan = planPurchase(BOBS_AXE, 10_000);
    expect(plan.units).toBe(3);
    expect(plan.totalCost).toBe(200 + 204 + 208);
    expect(plan.stoppedAtMargin).toBe(false);
  });

  it('respects an explicit maxUnits cap', () => {
    const plan = planPurchase(BOBS_AXE, 10_000, { maxUnits: 2 });
    expect(plan.units).toBe(2);
  });
});
