import { describe, expect, it } from 'vitest';
import { evaluate, targetSellPrice, volume24hForMode } from '../src/domain/profit.js';
import type { ShopRow } from '../src/domain/shopPrice.js';
import type { MarketQuote } from '../src/types.js';

/** A steel-axe style row: sells at 100%, buys at 60%, 2% per unit, stock 3. */
const ROW: ShopRow = {
  itemValue: 200,
  sellMultiplier: 1000,
  buyMultiplier: 600,
  delta: 20,
  baseStock: 3,
};

function quote(overrides: Partial<MarketQuote> = {}): MarketQuote {
  return {
    id: 1,
    name: 'Steel axe',
    members: false,
    value: 200,
    stackable: false,
    limit: 100,
    high: 1000,
    low: 900,
    avgHighPrice24h: 1000,
    avgLowPrice24h: 900,
    highVolume24h: 60_000,
    lowVolume24h: 60_000,
    highTime: null,
    lowTime: null,
    ...overrides,
  };
}

describe('sell mode selection', () => {
  it('pessimistic sells at low, patient sells at high', () => {
    expect(targetSellPrice(quote(), 'pessimistic')).toBe(900);
    expect(targetSellPrice(quote(), 'patient')).toBe(1000);
  });

  it('treats a missing or zero price as unavailable', () => {
    expect(targetSellPrice(quote({ low: null }), 'pessimistic')).toBeNull();
    expect(targetSellPrice(quote({ high: 0 }), 'patient')).toBeNull();
  });

  it('reads volume from the matching side of the book', () => {
    const q = quote({ highVolume24h: 600, lowVolume24h: 1200 });
    expect(volume24hForMode(q, 'pessimistic')).toBe(1200);
    expect(volume24hForMode(q, 'patient')).toBe(600);
  });
});

describe('evaluate', () => {
  it('computes margin net of GE tax', () => {
    const result = evaluate(ROW, quote(), { mode: 'pessimistic' });
    expect(result).not.toBeNull();
    if (result === null) return;

    // Sell 900 -> 2% tax = 18 -> net 882.
    expect(result.sellPrice).toBe(900);
    expect(result.taxPerUnit).toBe(18);
    expect(result.netSellPerUnit).toBe(882);

    // Buying 3 units costs 200+204+208 = 612 -> avg 204.
    expect(result.units).toBe(3);
    expect(result.totalCost).toBe(612);
    expect(result.avgCost).toBe(204);
    expect(result.margin).toBe(882 - 204);
    expect(result.totalProfit).toBe(3 * 882 - 612);
  });

  it('is exempt from tax below 50 gp', () => {
    const cheap = quote({ low: 40 });
    const result = evaluate(ROW, cheap, { mode: 'pessimistic' });
    // 40 gp sell vs 204 gp cost: unprofitable, so no opportunity at all.
    expect(result).toBeNull();
  });

  it('returns null when there is no GE price', () => {
    expect(evaluate(ROW, quote({ low: null }), { mode: 'pessimistic' })).toBeNull();
  });

  it('returns null when the item has no base value to price from', () => {
    expect(evaluate({ ...ROW, itemValue: 0 }, quote(), { mode: 'pessimistic' })).toBeNull();
  });

  it('returns null when the shop price exceeds the GE price', () => {
    expect(evaluate(ROW, quote({ low: 100 }), { mode: 'pessimistic' })).toBeNull();
  });

  it('reports but does not cap sales by the GE per-player buy limit', () => {
    // The limit says how many one player may BUY in 4h. It does not limit how
    // much the market can absorb from a seller, so one shop visit's 3 axes are
    // still sellable even though the quote's buy limit is 2.
    const result = evaluate(ROW, quote({ limit: 2 }), { mode: 'pessimistic' });
    expect(result).not.toBeNull();
    if (result === null) return;
    expect(result.geBuyLimit).toBe(2);
    expect(result.sellablePer4h).toBe(3);
    expect(result.gpPer4h).toBe(3 * result.margin);
  });

  it('caps throughput by 4h volume, expressed in whole units', () => {
    // 60 sales/day on the low side is 10 per 4h.
    const result = evaluate(ROW, quote({ lowVolume24h: 60 }), { mode: 'pessimistic' });
    expect(result).not.toBeNull();
    if (result === null) return;
    expect(result.volume4h).toBe(10);
    expect(result.sellablePer4h).toBe(3); // only 3 in stock
  });

  it('never reports a fractional unit count for thin volume', () => {
    // 2 trades/day = 0.33 per 4h. You cannot sell a third of an axe, so the
    // realistic throughput is 0 and gp/4h must be 0 — not 0.33 * margin.
    const result = evaluate(ROW, quote({ lowVolume24h: 2 }), { mode: 'pessimistic' });
    if (result === null) {
      expect(result).toBeNull();
      return;
    }
    expect(Number.isInteger(result.sellablePer4h)).toBe(true);
    expect(result.sellablePer4h).toBe(0);
    expect(result.gpPer4h).toBe(0);
  });

  it('reports world hops needed to fill the 4h volume', () => {
    // 3 units per shop visit, 612 sales/day = 102 per 4h -> 34 visits.
    const result = evaluate(ROW, quote({ lowVolume24h: 612 }), {
      mode: 'pessimistic',
    });
    expect(result).not.toBeNull();
    if (result === null) return;
    expect(result.volume4h).toBe(102);
    expect(result.worldsToFill4h).toBe(34);
  });

  it('ignores the buy limit when counting world hops', () => {
    const result = evaluate(ROW, quote({ limit: 2, lowVolume24h: 612 }), {
      mode: 'pessimistic',
    });
    expect(result).not.toBeNull();
    if (result === null) return;
    expect(result.geBuyLimit).toBe(2);
    expect(result.worldsToFill4h).toBe(34);
  });

  it('reports no world count when the 4h volume is zero', () => {
    const result = evaluate(ROW, quote({ lowVolume24h: 0 }), {
      mode: 'pessimistic',
    });
    expect(result).not.toBeNull();
    if (result === null) return;
    expect(result.sellablePer4h).toBe(0);
    expect(result.worldsToFill4h).toBeNull();
  });

  it('is deterministic', () => {
    const a = evaluate(ROW, quote(), { mode: 'patient' });
    const b = evaluate(ROW, quote(), { mode: 'patient' });
    expect(a).toEqual(b);
  });
});
