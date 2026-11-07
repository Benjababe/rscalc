import { describe, expect, it } from 'vitest';
import {
  DEFAULT_UNITS_PER_LOAD,
  INVENTORY_SLOTS,
  planWithBudget,
  DEFAULT_HOP_SECONDS,
  type BudgetPlan,
} from '../src/domain/budget.js';
import { planPurchase, type ShopRow } from '../src/domain/shopPrice.js';

/** Assert a plan has a computable time, then hand back its gp/hour. */
function knownGpPerHour(plan: BudgetPlan): number {
  expect(plan.gpPerHour).not.toBeNull();
  return plan.gpPerHour ?? Number.NaN;
}

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
    expect(knownGpPerHour(fast)).toBeGreaterThan(knownGpPerHour(slow));
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
    const plan = planWithBudget(salt, 44, 1_000_000, {
      hopSeconds: 10,
      maxWorlds: 200,
      bankTiles: 20,
    });
    expect(plan.unitsPerWorld).toBeGreaterThan(0);
    // The final world is usually partial, so `units` is bounded by the product
    // rather than equal to it: every completed world yields the full amount,
    // and the last visit yields whatever the leftover gold affords.
    expect(plan.units).toBeGreaterThan((plan.worlds - 1) * plan.unitsPerWorld);
    expect(plan.units).toBeLessThanOrEqual(plan.worlds * plan.unitsPerWorld);
    expect(knownGpPerHour(plan)).toBeGreaterThan(0);
    expect(Number.isFinite(knownGpPerHour(plan))).toBe(true);
  });
});

/**
 * Flat-priced row so unit counts are exact: 10 gp per unit forever, 100 units
 * per world. Only stackability and the bank time vary between these tests.
 */
const FLAT: ShopRow = {
  itemValue: 10,
  sellMultiplier: 1000,
  buyMultiplier: 600,
  delta: 0,
  baseStock: 100,
};

describe('banking non-stackable items', () => {
  it('reserves one of the 28 slots for the coin stack', () => {
    expect(INVENTORY_SLOTS).toBe(28);
    expect(DEFAULT_UNITS_PER_LOAD).toBe(27);
  });

  it('never banks for stackable items', () => {
    const plan = planWithBudget(FLAT, 20, 1_000_000, {
      stackable: true,
      maxWorlds: 1,
    });
    expect(plan.units).toBe(100);
    expect(plan.bankTrips).toBe(0);
    expect(plan.bankSecondsTotal).toBe(0);
    expect(plan.timeSeconds).toBe(plan.hopSecondsTotal);
  });

  it('fits one load without a bank trip', () => {
    // Exactly one load (27 units): you are about to leave to sell them, so no
    // trip back to the shop is needed.
    const plan = planWithBudget(FLAT, 20, DEFAULT_UNITS_PER_LOAD * 10, {
      stackable: false,
    });
    expect(plan.units).toBe(DEFAULT_UNITS_PER_LOAD);
    expect(plan.bankTrips).toBe(0);
  });

  it('charges one trip per extra load', () => {
    const one = planWithBudget(FLAT, 20, (DEFAULT_UNITS_PER_LOAD + 1) * 10, {
      stackable: false,
    });
    expect(one.units).toBe(DEFAULT_UNITS_PER_LOAD + 1);
    expect(one.bankTrips).toBe(1);

    const two = planWithBudget(FLAT, 20, (DEFAULT_UNITS_PER_LOAD * 2 + 1) * 10, {
      stackable: false,
    });
    expect(two.units).toBe(DEFAULT_UNITS_PER_LOAD * 2 + 1);
    expect(two.bankTrips).toBe(2);
  });

  it('counts bank trips across the whole plan, not per world', () => {
    // 2 worlds x 100 units = 200 units = 8 loads -> 7 trips. Counting per world
    // would wrongly give 2 x 3 = 6.
    const plan = planWithBudget(FLAT, 20, 2_000, {
      stackable: false,
      maxWorlds: 2,
    });
    expect(plan.units).toBe(200);
    expect(plan.worlds).toBe(2);
    expect(plan.bankTrips).toBe(Math.ceil(200 / DEFAULT_UNITS_PER_LOAD) - 1);
  });

  it('adds bank time to the buying side, then takes the slower side', () => {
    const plan = planWithBudget(FLAT, 20, 1_000, {
      stackable: false,
      maxWorlds: 1,
      hopSeconds: 10,
      bankTiles: 10,
      secondsPerTile: 0.5,
      bankHandoverSeconds: 0,
    });
    expect(plan.units).toBe(100);
    expect(plan.hopSecondsTotal).toBe(10);
    expect(plan.bankTrips).toBe(3); // ceil(100 / 27) - 1
    expect(plan.bankSecondsPerTrip).toBe(10); // 2 * 10 tiles * 0.5s
    expect(plan.bankSecondsTotal).toBe(30);
    expect(plan.timeSeconds).toBe(40); // 10s of hops + 30s of banking

    // A shallow throughput cap still owns the clock: 4h of GE selling beats
    // 40s of buying even with banking charged.
    const capped = planWithBudget(FLAT, 20, 1_000, {
      stackable: false,
      maxWorlds: 1,
      hopSeconds: 10,
      bankTiles: 10,
      secondsPerTile: 0.5,
      bankHandoverSeconds: 0,
      maxUnits: 100,
    });
    expect(capped.sellSeconds).toBeCloseTo(4 * 3600, 6);
    expect(capped.timeSeconds).toBe(4 * 3600);
  });

  it('treats unknown stackability conservatively', () => {
    // Same shop, same bank distance; only the stacking answer differs.
    const unknown = planWithBudget(FLAT, 20, 1_000_000, {
      maxWorlds: 1,
      bankTiles: 10,
    });
    const nonStackable = planWithBudget(FLAT, 20, 1_000_000, {
      stackable: false,
      maxWorlds: 1,
      bankTiles: 10,
    });
    const stackable = planWithBudget(FLAT, 20, 1_000_000, {
      stackable: true,
      maxWorlds: 1,
      bankTiles: 10,
    });

    expect(unknown).toEqual(nonStackable);
    expect(knownGpPerHour(unknown)).toBeLessThan(knownGpPerHour(stackable));
  });

  it("uses each shop's own bank distance, not a global time", () => {
    const near = planWithBudget(FLAT, 20, 1_000_000, {
      stackable: false,
      maxWorlds: 1,
      bankTiles: 5,
      secondsPerTile: 0.5,
      bankHandoverSeconds: 0,
    });
    const far = planWithBudget(FLAT, 20, 1_000_000, {
      stackable: false,
      maxWorlds: 1,
      bankTiles: 100,
      secondsPerTile: 0.5,
      bankHandoverSeconds: 0,
    });

    expect(near.bankTrips).toBe(far.bankTrips);
    expect(near.bankSecondsPerTrip).toBe(5);
    expect(far.bankSecondsPerTrip).toBe(100);
    expect(knownGpPerHour(near)).toBeGreaterThan(knownGpPerHour(far));
  });

  it('refuses to guess when the bank distance is unknown', () => {
    const plan = planWithBudget(FLAT, 20, 1_000_000, {
      stackable: false,
      maxWorlds: 1,
    });

    expect(plan.units).toBe(100);
    expect(plan.bankTrips).toBe(3);
    expect(plan.bankTimeKnown).toBe(false);
    expect(plan.bankSecondsTotal).toBe(0); // no invented seconds
    expect(plan.gpPerHour).toBeNull();
  });

  it('stays computable when nothing needs banking', () => {
    // Fits in one load: no trip, so an unknown distance cannot matter.
    const small = planWithBudget(FLAT, 20, 10 * DEFAULT_UNITS_PER_LOAD, {
      stackable: false,
    });
    expect(small.bankTrips).toBe(0);
    expect(small.bankTimeKnown).toBe(true);
    expect(small.gpPerHour).not.toBeNull();

    // Stackable: no trip however many units there are.
    const stacked = planWithBudget(FLAT, 20, 1_000_000, {
      stackable: true,
      maxWorlds: 1,
    });
    expect(stacked.bankTrips).toBe(0);
    expect(stacked.bankTimeKnown).toBe(true);
    expect(stacked.gpPerHour).not.toBeNull();
  });

  it('passes the bank-interface handover through', () => {
    const plan = planWithBudget(FLAT, 20, 1_000, {
      stackable: false,
      maxWorlds: 1,
      bankTiles: 10,
      secondsPerTile: 0.5,
      bankHandoverSeconds: 7,
    });
    expect(plan.bankSecondsPerTrip).toBe(17); // 10 + 7
    expect(plan.bankSecondsTotal).toBe(51); // 3 trips
  });

  it('lets the caller override the load size', () => {
    const plan = planWithBudget(FLAT, 20, 300, {
      stackable: false,
      unitsPerLoad: 10,
    });
    expect(plan.units).toBe(30);
    expect(plan.bankTrips).toBe(2);
  });
});

/**
 * Overnight mode: sell into a rest window instead of the 4h slice, and stop
 * buying when the session is up. The fill is still charged, because the capital
 * is committed until the offers fill.
 */
describe('overnight sessions', () => {
  const TWELVE_HOURS = 12 * 3600;

  it('charges the fill, because the capital is committed until it fills', () => {
    const plan = planWithBudget(AXE, 500, CLEAR_ONE_WORLD * 2, {
      hopSeconds: 10,
      maxUnits: 6,
      sellWindowSeconds: TWELVE_HOURS,
    });
    expect(plan.units).toBe(6);
    // 6 units against a 6-unit window is the whole 12h rest.
    expect(plan.sellSeconds).toBeCloseTo(TWELVE_HOURS, 6);
    // Your own time is still reported separately: two 10s hops.
    expect(plan.buySeconds).toBe(20);
    expect(plan.timeSeconds).toBe(TWELVE_HOURS);
    expect(knownGpPerHour(plan)).toBeCloseTo((plan.profit * 3600) / TWELVE_HOURS, 6);
  });

  it('scales the plan with the window without inflating the rate', () => {
    // A 4h window caps at 6 units; a 12h window at 18. Both are the whole
    // window's throughput, so the hourly rate is the same: longer, not better.
    const fourHour = planWithBudget(AXE, 500, 1_000_000, {
      hopSeconds: 10,
      maxUnits: 6,
    });
    const overnight = planWithBudget(AXE, 500, 1_000_000, {
      hopSeconds: 10,
      maxUnits: 18,
      sellWindowSeconds: TWELVE_HOURS,
    });
    expect(fourHour.units).toBe(6);
    expect(overnight.units).toBe(18);
    expect(overnight.profit).toBe(fourHour.profit * 3);
    expect(overnight.sellSeconds).toBeCloseTo(TWELVE_HOURS, 6);
    expect(knownGpPerHour(overnight)).toBeCloseTo(knownGpPerHour(fourHour), 6);
  });

  it('measures the sell time against the window it was capped from', () => {
    const third = planWithBudget(AXE, 500, CLEAR_ONE_WORLD, {
      maxUnits: 9,
      sellWindowSeconds: TWELVE_HOURS,
    });
    expect(third.units).toBe(3);
    expect(third.sellSeconds).toBeCloseTo(TWELVE_HOURS / 3, 6);
    expect(third.timeSeconds).toBe(third.sellSeconds);
  });

  it('stops buying when the session clock is up', () => {
    const plan = planWithBudget(AXE, 500, 1_000_000, {
      hopSeconds: 10,
      sessionSeconds: 25,
      maxUnits: 1_000_000,
      sellWindowSeconds: TWELVE_HOURS,
    });
    // Two 10s hops fit in 25s; the third would be 30s.
    expect(plan.worlds).toBe(2);
    expect(plan.units).toBe(6);
    expect(plan.sessionLimited).toBe(true);
    expect(plan.buySeconds).toBe(20);
    // The cap here is effectively unlimited, so the fill is a rounding error and
    // the session hops are the clock.
    expect(plan.sellSeconds).toBeLessThan(1);
    expect(plan.timeSeconds).toBe(20);
  });

  it('plans nothing when the session cannot fit one visit', () => {
    const plan = planWithBudget(AXE, 500, 1_000_000, {
      hopSeconds: 10,
      sessionSeconds: 5,
      maxUnits: 1_000_000,
    });
    expect(plan.units).toBe(0);
    expect(plan.worlds).toBe(0);
    expect(plan.sessionLimited).toBe(true);
    expect(plan.gpPerHour).toBe(0);
  });

  it('trims the last world instead of overrunning the session', () => {
    // The cap allows a 4th unit, but the second visit does not fit in 15s.
    const plan = planWithBudget(AXE, 500, 1_000_000, {
      hopSeconds: 10,
      maxUnits: 4,
      sessionSeconds: 15,
    });
    expect(plan.units).toBe(3);
    expect(plan.worlds).toBe(1);
    expect(plan.sessionLimited).toBe(true);
  });

  it('buys the partial world that still fits', () => {
    const plan = planWithBudget(AXE, 500, 1_000_000, {
      hopSeconds: 10,
      maxUnits: 4,
      sessionSeconds: 20,
    });
    expect(plan.units).toBe(4);
    expect(plan.worlds).toBe(2);
    expect(plan.sessionLimited).toBe(false);
  });

  it('counts bank trips against the session', () => {
    // One world is 100 units = 3 bank trips: 10s hop + 30s banking = 40s.
    const plan = planWithBudget(FLAT, 20, 1_000_000, {
      stackable: false,
      hopSeconds: 10,
      bankTiles: 10,
      secondsPerTile: 0.5,
      bankHandoverSeconds: 0,
      sessionSeconds: 40,
    });
    expect(plan.worlds).toBe(1);
    expect(plan.units).toBe(100);
    expect(plan.bankTrips).toBe(3);
    expect(plan.buySeconds).toBe(40);
    expect(plan.sessionLimited).toBe(true);
  });

  it('still refuses a number when banking is needed but the bank is unknown', () => {
    const plan = planWithBudget(FLAT, 20, 1_000_000, {
      stackable: false,
      maxWorlds: 1,
      sessionSeconds: 3600,
      maxUnits: 1000,
    });
    expect(plan.units).toBe(100);
    expect(plan.bankTimeKnown).toBe(false);
    expect(plan.gpPerHour).toBeNull();
  });

  it('keeps the session cap out of the way when it is not passed', () => {
    const plan = planWithBudget(AXE, 500, CLEAR_ONE_WORLD * 3, { hopSeconds: 10 });
    expect(plan.worlds).toBe(3);
    expect(plan.sessionLimited).toBe(false);
    expect(plan.timeSeconds).toBe(plan.buySeconds);
  });
});
