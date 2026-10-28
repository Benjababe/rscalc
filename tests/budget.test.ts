import { describe, expect, it } from 'vitest';
import { planWithBudget, DEFAULT_HOP_SECONDS } from '../src/domain/budget.js';
import { planPurchase, type ShopRow } from '../src/domain/shopPrice.js';

/**
 * Bob's Brilliant Axes steel axe: sells at 100%, 2% per unit, 3 in stock.
 * Unit prices from full stock are 200, 204, 208.
 */
const AXE: ShopRow = {
  itemValue: 200,
  sellMultiplier: 1000,
  buyMultiplier: 600,
  delta: 20,
  baseStock: 3,
};

const CLEAR_ONE_WORLD = 200 + 204 + 208; // 612

describe('planWithBudget', () => {
  it('buys nothing without a budget or a sell price', () => {
    expect(planWithBudget(AXE, 500, 0).units).toBe(0);
    expect(planWithBudget(AXE, 0, 1_000_000).units).toBe(0);
  });

  it('buys nothing when even the first unit is unaffordable', () => {
    const plan = planWithBudget(AXE, 500, 199);
    expect(plan.units).toBe(0);
    expect(plan.worlds).toBe(0);
    expect(plan.gpPerHour).toBe(0);
  });

  it('buys a partial world when the budget cannot clear one', () => {
    // 200 + 204 = 404 fits in 500; adding 208 does not.
    const plan = planWithBudget(AXE, 500, 500);
    expect(plan.units).toBe(2);
    expect(plan.totalCost).toBe(404);
    expect(plan.worlds).toBe(1);
    expect(plan.budgetLimited).toBe(true);
    expect(plan.leftover).toBe(96);
  });

  it('treats each world as a fresh full-stock shop', () => {
    // Exactly one world's worth: 3 units, and the price curve restarts.
    const plan = planWithBudget(AXE, 500, CLEAR_ONE_WORLD);
    expect(plan.units).toBe(3);
    expect(plan.worlds).toBe(1);
    expect(plan.unitsPerWorld).toBe(3);
    expect(plan.costPerWorld).toBe(CLEAR_ONE_WORLD);

    // Two worlds' worth: 6 units at the same per-world cost.
    const two = planWithBudget(AXE, 500, CLEAR_ONE_WORLD * 2);
    expect(two.units).toBe(6);
    expect(two.worlds).toBe(2);
    expect(two.totalCost).toBe(CLEAR_ONE_WORLD * 2);
  });

  it('never buys a unit that is no longer profitable', () => {
    // Net sell 205: only 200 and 204 clear, so a world yields 2 units even
    // though it has 3 in stock and the budget is huge.
    const plan = planWithBudget(AXE, 205, 1_000_000);
    expect(plan.unitsPerWorld).toBe(2);
    expect(plan.marginLimited).toBe(true);
    // And a huge budget just buys more worlds, not more per world.
    expect(plan.units).toBe(2 * plan.worlds);
  });

  it('computes gp/hour from worlds times hop time', () => {
    const plan = planWithBudget(AXE, 500, CLEAR_ONE_WORLD * 2, { hopSeconds: 10 });
    // 6 units * 500 = 3000 revenue, 1224 cost -> 1776 profit.
    expect(plan.profit).toBe(6 * 500 - CLEAR_ONE_WORLD * 2);
    expect(plan.worlds).toBe(2);
    expect(plan.timeSeconds).toBe(20);
    expect(plan.gpPerHour).toBeCloseTo((1776 * 3600) / 20, 6);
  });

  it('falls back to the default hop time', () => {
    const plan = planWithBudget(AXE, 500, CLEAR_ONE_WORLD);
    expect(plan.timeSeconds).toBe(DEFAULT_HOP_SECONDS);
  });

  it('caps total units by sellable throughput', () => {
    // Huge budget, huge world count, but the GE can only absorb 4 units.
    const plan = planWithBudget(AXE, 500, 1_000_000, { maxUnits: 4 });
    expect(plan.units).toBe(4);
    expect(plan.units).toBeLessThanOrEqual(4);
  });

  it('buys nothing when throughput is zero', () => {
    // An item with no recent trades cannot be sold, so it cannot be flipped.
    const plan = planWithBudget(AXE, 500, 1_000_000, { maxUnits: 0 });
    expect(plan.units).toBe(0);
    expect(plan.gpPerHour).toBe(0);
  });

  it('charges selling time when throughput is the binding constraint', () => {
    // 6 units against a 6-per-4h throughput = a full 4h window to offload,
    // which must dominate a 10s hop even though the buying was instant.
    const plan = planWithBudget(AXE, 500, CLEAR_ONE_WORLD * 2, {
      hopSeconds: 10,
      maxUnits: 6,
    });
    expect(plan.units).toBe(6);
    expect(plan.hopSecondsTotal).toBe(20);
    expect(plan.sellSeconds).toBeCloseTo(4 * 3600, 6);
    expect(plan.timeSeconds).toBe(4 * 3600);
    // gp/hour therefore matches the per-4h figure rather than exploding.
    expect(plan.gpPerHour).toBeCloseTo(plan.profit / 4, 6);
  });

  it('uses hop time when selling is faster than buying', () => {
    // 3 units against a deep 100,000-per-4h throughput sells in well under a
    // second, so the 10s world hop is the real cost.
    const plan = planWithBudget(AXE, 500, CLEAR_ONE_WORLD, {
      hopSeconds: 10,
      maxUnits: 100_000,
    });
    expect(plan.sellSeconds).toBeLessThan(plan.hopSecondsTotal);
    expect(plan.timeSeconds).toBe(plan.hopSecondsTotal);
    expect(plan.timeSeconds).toBe(10);
  });

  it('charges selling time when throughput is shallow', () => {
    // 3 units against a 100-per-4h throughput is only 3% of a window, but that
    // is still 432s — far more than a 10s hop.
    const plan = planWithBudget(AXE, 500, CLEAR_ONE_WORLD, {
      hopSeconds: 10,
      maxUnits: 100,
    });
    expect(plan.sellSeconds).toBeCloseTo(432, 6);
    expect(plan.timeSeconds).toBe(plan.sellSeconds);
  });

  it('charging more hop time lowers gp/hour', () => {
    const fast = planWithBudget(AXE, 500, CLEAR_ONE_WORLD * 4, { hopSeconds: 5 });
    const slow = planWithBudget(AXE, 500, CLEAR_ONE_WORLD * 4, { hopSeconds: 30 });
    expect(fast.units).toBe(slow.units);
    expect(fast.gpPerHour).toBeGreaterThan(slow.gpPerHour);
  });

  it('respects maxWorlds', () => {
    const plan = planWithBudget(AXE, 500, 1_000_000, { maxWorlds: 3 });
    expect(plan.worlds).toBe(3);
    expect(plan.units).toBe(9);
    expect(plan.leftover).toBeGreaterThan(0);
  });

  it('agrees with planPurchase on a single world', () => {
    const perWorld = planPurchase(AXE, 500, { startStock: AXE.baseStock });
    const plan = planWithBudget(AXE, 500, perWorld.totalCost);
    expect(plan.unitsPerWorld).toBe(perWorld.units);
    expect(plan.costPerWorld).toBe(perWorld.totalCost);
  });

  it('is deterministic', () => {
    const a = planWithBudget(AXE, 500, 1234, { hopSeconds: 12 });
    const b = planWithBudget(AXE, 500, 1234, { hopSeconds: 12 });
    expect(a).toEqual(b);
  });

  it('stays linear and sane for a very large stock', () => {
    // Bag-of-salt shape: value 10, 0.1% per unit, 5000 in stock.
    const salt: ShopRow = {
      itemValue: 10,
      sellMultiplier: 1000,
      buyMultiplier: 600,
      delta: 1,
      baseStock: 5000,
    };
    const plan = planWithBudget(salt, 44, 1_000_000, { hopSeconds: 10, maxWorlds: 200 });
    expect(plan.unitsPerWorld).toBeGreaterThan(0);
    // The final world is usually partial, so `units` is bounded by the product
    // rather than equal to it: every completed world yields the full amount,
    // and the last visit yields whatever the leftover gold affords.
    expect(plan.units).toBeGreaterThan((plan.worlds - 1) * plan.unitsPerWorld);
    expect(plan.units).toBeLessThanOrEqual(plan.worlds * plan.unitsPerWorld);
    expect(plan.gpPerHour).toBeGreaterThan(0);
    expect(Number.isFinite(plan.gpPerHour)).toBe(true);
  });
});
