import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SINK_HANDOVER_SECONDS,
  isGeneralStore,
  planShopSink,
} from '../src/domain/shopSink.js';
import {
  sellTotalRevenue,
  trunc,
  type ShopRow,
} from '../src/domain/shopPrice.js';

/** Bob's Brilliant Axes: Sells at 100.0%, Buys at 60.0%, Change per 2.0%. */
const BOBS_AXE: ShopRow = {
  itemValue: 200,
  sellMultiplier: 1000,
  buyMultiplier: 600,
  delta: 20,
  baseStock: 3,
};

/** A flat-price row, so one world absorbs the whole GE purchase cap. */
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
  hopSeconds: 10,
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
  it('repeats one world batch across worlds and charges no per-unit loads', () => {
    const plan = planShopSink(BOBS_AXE, {
      geCostPerUnit: 100,
      purchaseCap4h: 12,
      ...TRIP,
    });

    // One world absorbs 5 units (120, 116, 112, 108, 104; 100 is not > 100).
    expect(plan.unitsPerWorld).toBe(5);
    expect(plan.units).toBe(12);
    expect(plan.worlds).toBe(3);
    expect(plan.worldLimited).toBe(false);

    // Two full worlds plus the first two units of a third.
    expect(plan.totalRevenue).toBe(
      2 * 560 + sellTotalRevenue(BOBS_AXE, 2, BOBS_AXE.baseStock),
    );
    expect(plan.totalCost).toBe(1200);
    expect(plan.profit).toBe(156);
    expect(plan.marginPerUnit).toBe(13);
    expect(plan.firstUnitRevenue).toBe(120);
    expect(plan.lastUnitRevenue).toBe(104);
    expect(plan.priceLimited).toBe(true);
  });

  it('describes the per-unit price drop from the shop delta', () => {
    const plan = planShopSink(BOBS_AXE, {
      geCostPerUnit: 100,
      purchaseCap4h: 12,
      ...TRIP,
    });

    // store_delta 20 is 2.0% of value, i.e. 4 gp on a 200 gp item.
    expect(plan.deltaPct).toBe(2);
    expect(plan.priceDropPerUnit).toBe(4);
  });

  it('charges one GE trip plus one hop per world, not one trip per load', () => {
    const plan = planShopSink(BOBS_AXE, {
      geCostPerUnit: 100,
      purchaseCap4h: 12,
      ...TRIP,
    });

    // 12 non-stackable units are noted, so there is no 27-unit split.
    expect(plan.tripSeconds).toBe(15);
    expect(plan.hopSecondsTotal).toBe(30); // 3 worlds × 10s
    expect(plan.travelSeconds).toBe(45); // one trip + hops
    expect(plan.timeSeconds).toBe(14400); // GE supply of a 12-unit cap still binds
  });

  it('caps at the world ceiling before the GE purchase cap', () => {
    const plan = planShopSink(BOBS_AXE, {
      geCostPerUnit: 100,
      purchaseCap4h: 100_000,
      ...TRIP,
    });

    expect(plan.unitsPerWorld).toBe(5);
    expect(plan.worlds).toBe(200);
    expect(plan.units).toBe(1000); // 200 worlds × 5 units
    expect(plan.worldLimited).toBe(true);
    expect(plan.totalRevenue).toBe(200 * 560);
    expect(plan.profit).toBe(12_000);

    // Travel now binds: 15s trip + 200 × 10s hops, versus 144s of GE supply.
    expect(plan.hopSecondsTotal).toBe(2000);
    expect(plan.travelSeconds).toBe(2015);
    expect(plan.buySeconds).toBe(144);
    expect(plan.timeSeconds).toBe(2015);
    expect(plan.gpPerHour).toBeCloseTo(21_439.2, 0);
  });

  it('honours a custom world-hop time', () => {
    const plan = planShopSink(BOBS_AXE, {
      geCostPerUnit: 100,
      purchaseCap4h: 100_000,
      ...TRIP,
      hopSeconds: 30,
    });

    expect(plan.hopSecondsTotal).toBe(6000);
    expect(plan.travelSeconds).toBe(6015);
    expect(plan.timeSeconds).toBe(6015);
    expect(plan.gpPerHour).toBeCloseTo(7182.0, 0);
  });

  it('needs only one world when the GE cap is below a world batch', () => {
    const plan = planShopSink(BOBS_AXE, {
      geCostPerUnit: 100,
      purchaseCap4h: 2,
      ...TRIP,
    });

    expect(plan.unitsPerWorld).toBe(2);
    expect(plan.units).toBe(2);
    expect(plan.worlds).toBe(1);
    expect(plan.priceLimited).toBe(false); // the cap ended it, not the price
    expect(plan.totalRevenue).toBe(236); // 120 + 116
    expect(plan.profit).toBe(36);
  });

  it('lets one world absorb everything when the price does not fall', () => {
    const plan = planShopSink(FLAT_ROW, {
      geCostPerUnit: 100,
      purchaseCap4h: 300,
      ...TRIP,
    });

    expect(plan.unitsPerWorld).toBe(300);
    expect(plan.units).toBe(300);
    expect(plan.worlds).toBe(1);
    expect(plan.profit).toBe(30_000);
    expect(plan.deltaPct).toBe(0);
    expect(plan.priceDropPerUnit).toBe(0);
  });

  it('honours an explicit start stock on every world', () => {
    const plan = planShopSink(BOBS_AXE, {
      geCostPerUnit: 100,
      purchaseCap4h: 10,
      startStock: 7,
      maxWorlds: 1,
      ...TRIP,
    });

    expect(plan.unitsPerWorld).toBe(1); // 104 > 100, next unit pays 100
    expect(plan.units).toBe(1);
    expect(plan.worlds).toBe(1);
    expect(plan.firstUnitRevenue).toBe(104);
    expect(plan.profit).toBe(4);
  });

  it('never invents a trip when the GE distance is unknown', () => {
    const plan = planShopSink(BOBS_AXE, {
      geCostPerUnit: 100,
      purchaseCap4h: 12,
      geTiles: null,
      hopSeconds: 10,
    });

    expect(plan.units).toBe(12);
    expect(plan.profit).toBe(156);
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
    expect(plan.unitsPerWorld).toBe(0);
    expect(plan.worlds).toBe(0);
    expect(plan.profit).toBe(0);
    expect(plan.gpPerHour).toBe(0);
  });

  it('passes through the 10% floor flag', () => {
    const plan = planShopSink(BOBS_AXE, {
      geCostPerUnit: 1,
      purchaseCap4h: 100,
      ...TRIP,
    });

    expect(plan.lastUnitRevenue).toBe(trunc(BOBS_AXE.itemValue * 0.1));
    expect(plan.atFloor).toBe(true);
  });

  it('has no time when there is no purchase capacity', () => {
    const plan = planShopSink(BOBS_AXE, {
      geCostPerUnit: 100,
      purchaseCap4h: 0,
      ...TRIP,
    });

    expect(plan.units).toBe(0);
    expect(plan.worlds).toBe(0);
    expect(plan.timeSeconds).toBe(0);
    expect(plan.gpPerHour).toBe(0);
  });

  it('does not charge a price drop at an infinite-stock shop', () => {
    const infinite: ShopRow = {
      itemValue: 100,
      sellMultiplier: 1000,
      buyMultiplier: 600,
      delta: 10,
      baseStock: 0,
      infiniteStock: true,
    };
    const plan = planShopSink(infinite, {
      geCostPerUnit: 50,
      purchaseCap4h: 5,
      ...TRIP,
    });

    expect(plan.units).toBe(5);
    expect(plan.profit).toBe(50);
    expect(plan.deltaPct).toBe(1);
    expect(plan.priceDropPerUnit).toBe(0);
  });
});
