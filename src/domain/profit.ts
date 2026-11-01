/**
 * Arbitrage evaluation: turn one (shop row, market quote) pair into a ranked,
 * honest opportunity.
 */

import { netProceeds, geTax } from './tax.js';
import { planPurchase, shopUnitBuyPrice, type ShopRow } from './shopPrice.js';
import type { MarketQuote, Opportunity, SellMode } from '../types.js';

/** The GE buy limit and volume windows are both 4 hours. */
export const GE_LIMIT_WINDOW_HOURS = 4;

export interface EvaluateOptions {
  mode: SellMode;
  /** Restrict how many units we consider buying from the shop. */
  maxUnits?: number;
}

/** The GE price a given mode targets. Returns null when unavailable. */
export function targetSellPrice(quote: MarketQuote, mode: SellMode): number | null {
  const price = mode === 'pessimistic' ? quote.low : quote.high;
  return price !== null && price > 0 ? price : null;
}

/** 24h traded volume on the side of the book a given mode sells into. */
export function volume24hForMode(quote: MarketQuote, mode: SellMode): number {
  return mode === 'pessimistic' ? quote.lowVolume24h : quote.highVolume24h;
}

/**
 * Evaluate one shop row against one quote.
 *
 * Returns null when the pair cannot produce a defensible number: no GE price,
 * no base value, or unstockable/unsellable. We would rather emit nothing than
 * emit a row whose inputs are guesses.
 */
export function evaluate(
  row: ShopRow,
  quote: MarketQuote,
  options: EvaluateOptions,
): Opportunity | null {
  if (row.itemValue <= 0) return null;
  if (!Number.isFinite(row.baseStock) || row.baseStock < 0) return null;

  const sellPrice = targetSellPrice(quote, options.mode);
  if (sellPrice === null) return null;

  const taxPerUnit = geTax(sellPrice);
  const netSellPerUnit = netProceeds(sellPrice);

  // An explicit empty options object rather than a conditional spread: the spread
  // form hides whether the field is absent or merely undefined.
  const planOptions =
    options.maxUnits === undefined ? {} : { maxUnits: options.maxUnits };
  const plan = planPurchase(row, netSellPerUnit, planOptions);
  if (plan.units <= 0 || plan.profit <= 0) return null;
  if (plan.totalCost <= 0) return null;

  const avgCost = plan.totalCost / plan.units;
  const margin = netSellPerUnit - avgCost;
  if (margin <= 0) return null;

  // Throughput. A sale counts against the 24h volume on its own side of the
  // book, so a 4h slice is volume24h/6.
  //
  // This is floored to whole units: volume24h/6 is fractional (2 trades/day is
  // 0.33 per 4h), and multiplying a fractional unit count by the margin
  // manufactures a gp/4h figure for items you cannot actually sell. Flooring
  // makes thin-volume rows sink to zero instead of topping the ranking.
  const volume4hExact = volume24hForMode(quote, options.mode) / 6;
  const volume4h = Math.floor(volume4hExact);

  // The GE buy limit is deliberately not part of this cap. It limits how many
  // of an item one player can *buy* in 4h, not how much the market can absorb
  // from a seller. The market-wide constraint is the 24h volume on the side of
  // the book we are selling into. `geBuyLimit` is still reported for
  // transparency, but it must not shrink the sellable quantity.
  const sellablePer4h = Math.max(0, Math.min(plan.units, volume4h));
  const gpPer4h = sellablePer4h * margin;

  // How many world hops to fill the 4h volume. Null when the item has no
  // sellable volume in the window.
  const worldsToFill4h =
    plan.units > 0 && volume4h > 0
      ? Math.max(1, Math.ceil(volume4h / plan.units))
      : null;

  return {
    itemId: quote.id,
    itemName: quote.name,
    shopPage: '',
    shopName: '',
    soldBy: null,
    location: null,
    members: quote.members,
    shopTypes: [],

    firstUnitCost: shopUnitBuyPrice(row, row.baseStock),
    lastUnitCost: plan.lastUnitCost,
    totalCost: plan.totalCost,

    sellPrice,
    taxPerUnit,
    netSellPerUnit,

    units: plan.units,
    avgCost,
    margin,
    marginPct: (margin / avgCost) * 100,
    totalProfit: plan.profit,

    baseStock: Number.isFinite(row.baseStock) ? row.baseStock : null,
    infiniteStock: row.infiniteStock ?? false,
    restockTicks: null,
    stackable: quote.stackable,
    bankTiles: null,
    nearestBank: null,

    // Passed through so the UI can rebuild the price curve for a gold budget.
    itemValue: row.itemValue,
    sellMultiplier: row.sellMultiplier,
    buyMultiplier: row.buyMultiplier,
    delta: row.delta,

    geBuyLimit: quote.limit,
    volume4h,
    sellablePer4h,
    gpPer4h,
    worldsToFill4h,
    gpPerHour: gpPer4h,
  };
}
