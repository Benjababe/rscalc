/**
 * Ranking engine: joins the shop catalogue to the market snapshot and produces
 * a sorted list of executable opportunities.
 */

import { evaluate } from '../domain/profit.js';
import type { ShopRow } from '../domain/shopPrice.js';
import type {
  MarketQuote,
  MarketSnapshot,
  Opportunity,
  Ranking,
  SellMode,
  ShopCatalog,
  ShopEntry,
} from '../types.js';

export interface RankOptions {
  mode: SellMode;
  /** Drop anything that can't clear this many units per 4h. */
  minVolume4h?: number;
  /** Drop anything whose average margin is below this many gp. */
  minMargin?: number;
  /** Only members items / shops. */
  membersOnly?: boolean;
  /** Infinite-stock shops are excluded by default (10/purchase, no scarcity). */
  includeInfiniteStock?: boolean;
  /** Currencies other than Coins are excluded by default. */
  includeOtherCurrencies?: boolean;
  /** Cap the returned list. */
  limit?: number;
}

/**
 * Build the pricing model input for a catalogue entry.
 * Returns null when the entry can't be priced honestly (unresolved item, or
 * no published stock figure for a finite-stock shop).
 */
export function toShopRow(entry: ShopEntry): ShopRow | null {
  if (entry.itemValue === null || entry.itemValue <= 0) return null;
  if (entry.infiniteStock) {
    return {
      itemValue: entry.itemValue,
      sellMultiplier: entry.sellMultiplier,
      buyMultiplier: entry.buyMultiplier,
      delta: entry.delta,
      baseStock: 0,
      infiniteStock: true,
    };
  }
  if (entry.baseStock === null || entry.baseStock < 0) return null;
  return {
    itemValue: entry.itemValue,
    sellMultiplier: entry.sellMultiplier,
    buyMultiplier: entry.buyMultiplier,
    delta: entry.delta,
    baseStock: entry.baseStock,
  };
}

const COINS = 'coins';

export function rank(
  catalog: ShopCatalog,
  market: MarketSnapshot,
  options: RankOptions,
): Ranking {
  const minVolume4h = options.minVolume4h ?? 0;
  const minMargin = options.minMargin ?? 0;
  const membersOnly = options.membersOnly ?? false;
  const includeInfiniteStock = options.includeInfiniteStock ?? false;
  const includeOtherCurrencies = options.includeOtherCurrencies ?? false;

  const opportunities: Opportunity[] = [];

  for (const entry of catalog.entries) {
    if (!includeOtherCurrencies && entry.currency.toLowerCase() !== COINS) {
      continue;
    }
    if (entry.infiniteStock && !includeInfiniteStock) continue;
    if (membersOnly && !entry.members) continue;
    if (entry.itemId === null) continue;

    const row = toShopRow(entry);
    if (row === null) continue;

    const quote = market.quotes[String(entry.itemId)];
    if (quote === undefined) continue;

    const result = evaluate(row, quote, { mode: options.mode });
    if (result === null) continue;

    if (result.sellablePer4h < minVolume4h) continue;
    if (result.margin < minMargin) continue;

    opportunities.push({
      ...result,
      shopPage: entry.shopPage,
      shopName: entry.shopName,
      soldBy: entry.soldBy,
      location: entry.location,
      members: entry.members,
      shopTypes: entry.shopTypes,
      baseStock: entry.baseStock,
      infiniteStock: entry.infiniteStock,
      restockTicks: entry.restockTicks,
      bankTiles: entry.bankTiles,
      nearestBank: entry.nearestBank,
    });
  }

  // Highest sustainable gp/4h first. Ties broken by margin then by name, so the
  // output is fully deterministic for golden-file tests.
  opportunities.sort((a, b) => {
    if (b.gpPer4h !== a.gpPer4h) return b.gpPer4h - a.gpPer4h;
    if (b.margin !== a.margin) return b.margin - a.margin;
    return a.itemName.localeCompare(b.itemName);
  });

  const limited =
    options.limit !== undefined ? opportunities.slice(0, options.limit) : opportunities;

  return {
    generatedAt: new Date().toISOString(),
    pricesAsOf: market.pricesAsOf,
    mode: options.mode,
    filters: { minVolume4h, minMargin, membersOnly, includeInfiniteStock },
    count: limited.length,
    opportunities: limited,
  };
}

/** Cheapest quote lookup helper for callers that already have an id. */
export function quoteFor(
  market: MarketSnapshot,
  itemId: number,
): MarketQuote | undefined {
  return market.quotes[String(itemId)];
}
