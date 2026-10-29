import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SINK_HANDOVER_SECONDS,
  isGeneralStore,
  planShopSink,
} from '../src/domain/shopSink.js';
import { trunc, type ShopRow } from '../src/domain/shopPrice.js';

/** Bob's Brilliant Axes: Sells at 100.0%, Buys at 60.0%, Change per 2.0%. */
const BOBS_AXE: ShopRow = {
  itemValue: 200,
  sellMultiplier: 1000,
  buyMultiplier: 600,
  delta: 20,
  baseStock: 3,
};

/** A flat-price row, so the 4h purchase cap is the binding constraint. */
const FLAT_ROW: ShopRow = {
  itemValue: 200,
  sellMultiplier: 1000,
  buyMultiplier: 1000,
  delta: 0,
  baseStock: 0,
};

const TRIP = {
  geTiles: 10,
  secondsPerTile: 0.6,
  handoverSeconds: DEFAULT_SINK_HANDOVER_SECONDS,
};

describe('isGeneralStore', () => {
  it('matches the wiki category, case-insensitively', () => {
    expect(isGeneralStore(['Free-to-play shops', 'General stores'])).toBe(true);
    expect(isGeneralStore(['general stores'])).toBe(true);
    expect(isGeneralStore(['General Store'])).toBe(true);
    expect(isGeneralStore(['Free-to-play shops', 'Shops'])).toBe(false);
    expect(isGeneralStore([])).toBe(false);
  });

  it('does not match on a shop name substring', () => {
    expect(isGeneralStore(['General store suppliers'])).toBe(false);
    expect(isGeneralStore(['Axe shops'])).toBe(false);
  });
});

describe('planShopSink', () => {
  it('plans the marginal sale and its total profit', () => {
    const plan = planShopSink(BOBS_AXE, {
      geCostPerUnit: 100,
      purchaseCap4h: 1000,
      ...TRIP,
    });

    expect(plan.units).toBe(5);
    expect(plan.firstUnitRevenue).toBe(120);
    expect(plan.lastUnitRevenue).toBe(104);
    expect(plan.totalCost).toBe(500);
    expect(plan.totalRevenue).toBe(560);
    expect(plan.profit).toBe(60);
    expect(plan.marginPerUnit).toBe(12);
    expect(plan.priceLimited).toBe(true);
  });

  it('charges one round trip for a load that fits the backpack', () => {
    const plan = planShopSink(BOBS_AXE, {
      geCostPerUnit: 100,
      purchaseCap4h: 1000,
      ...TRIP,
    });

    // 5 units are one load; 2 * 10 tiles * 0.6s + 3s handover.
    expect(plan.loads).toBe(1);
    expect(plan.tripSeconds).toBe(15);
    expect(plan.travelSeconds).toBe(15);
  });

  it('takes the slower of walking the loads and buying from the GE', () => {
    const plan = planShopSink(BOBS_AXE, {
      geCostPerUnit: 100,
      purchaseCap4h: 1000,
      ...TRIP,
    });

    // 5 units out of a 1000-unit 4h cap still needs 72s of GE supply, which
    // beats the 15s walk, so the rate is capped by buying, not travel.
    expect(plan.buySeconds).toBe(72);
    expect(plan.timeSeconds).toBe(72);
    expect(plan.gpPerHour).toBe(3000);
  });

  it('splits non-stackable units into 27-unit loads', () => {
    for (const [units, loads] of [
      [1, 1],
      [27, 1],
      [28, 2],
      [54, 2],
      [55, 3],
    ] as const) {
      const plan = planShopSink(FLAT_ROW, {
        geCostPerUnit: 100,
        purchaseCap4h: units,
        ...TRIP,
      });
      expect(plan.units).toBe(units);
      expect(plan.loads).toBe(loads);
      expect(plan.travelSeconds).toBe(loads * 15);
    }
  });

  it('treats an unknown or unstackable item as non-stackable', () => {
    for (const stackable of [null, false, undefined]) {
      const plan = planShopSink(FLAT_ROW, {
        geCostPerUnit: 100,
        purchaseCap4h: 30,
        stackable,
        ...TRIP,
      });
      expect(plan.units).toBe(30);
      expect(plan.stackable).toBe(false);
      expect(plan.loads).toBe(2);
    }
  });

  it('carries a stackable item in one slot', () => {
    const plan = planShopSink(FLAT_ROW, {
      geCostPerUnit: 100,
      purchaseCap4h: 30,
      stackable: true,
      ...TRIP,
    });

    expect(plan.stackable).toBe(true);
    expect(plan.units).toBe(30);
    expect(plan.loads).toBe(1);
    expect(plan.travelSeconds).toBe(15);
  });

  it('caps the sale by the GE 4h purchase limit', () => {
    const plan = planShopSink(FLAT_ROW, {
      geCostPerUnit: 100,
      purchaseCap4h: 2,
      ...TRIP,
    });

    expect(plan.units).toBe(2);
    expect(plan.purchaseCap4h).toBe(2);
  });

  it('never invents a trip when the GE distance is unknown', () => {
    const plan = planShopSink(BOBS_AXE, {
      geCostPerUnit: 100,
      purchaseCap4h: 1000,
      geTiles: null,
    });

    expect(plan.units).toBe(5);
    expect(plan.profit).toBe(60);
    expect(plan.tripSeconds).toBeNull();
    expect(plan.travelSeconds).toBe(0);
    expect(plan.timeKnown).toBe(false);
    expect(plan.gpPerHour).toBeNull();
  });

  it('reports a known zero, not an unknown time, when nothing is profitable', () => {
    const plan = planShopSink(BOBS_AXE, {
      geCostPerUnit: 120,
      purchaseCap4h: 1000,
      geTiles: null,
    });

    expect(plan.units).toBe(0);
    expect(plan.loads).toBe(0);
    expect(plan.profit).toBe(0);
    expect(plan.gpPerHour).toBe(0);
  });

  it('passes through the 10% floor flag', () => {
    const plan = planShopSink(BOBS_AXE, {
      geCostPerUnit: 1,
      purchaseCap4h: 30,
      ...TRIP,
    });

    expect(plan.units).toBe(30);
    expect(plan.lastUnitRevenue).toBe(trunc(BOBS_AXE.itemValue * 0.1));
    expect(plan.atFloor).toBe(true);
    expect(plan.priceLimited).toBe(false);
  });

  it('honours an explicit start stock', () => {
    const plan = planShopSink(BOBS_AXE, {
      geCostPerUnit: 100,
      purchaseCap4h: 100,
      startStock: 7,
      ...TRIP,
    });

    expect(plan.units).toBe(1);
    expect(plan.firstUnitRevenue).toBe(104);
  });

  it('has no time when there is no purchase capacity', () => {
    const plan = planShopSink(BOBS_AXE, {
      geCostPerUnit: 100,
      purchaseCap4h: 0,
      ...TRIP,
    });

    expect(plan.units).toBe(0);
    expect(plan.loads).toBe(0);
    expect(plan.timeSeconds).toBe(0);
    expect(plan.gpPerHour).toBe(0);
  });
});
