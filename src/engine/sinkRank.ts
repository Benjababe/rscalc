/**
 * GE -> shop ranking engine.
 *
 * Joins the shop catalogue to the market snapshot, but in the opposite direction
 * from `rank.ts`: buy on the GE, sell to a shop. The shop's own price formula is
 * reused (`planShopSale`), and the two mode names keep their meaning from the
 * player's point of view — the *worse* price is still called pessimistic:
 *
 *   pessimistic = instant buy at GE `high`   (guaranteed fill, worst price)
 *   patient     = buy offer at GE `low`      (better price, may not fill)
 *
 * These deliberately do not reuse the sell-side helpers in `profit.ts`: the
 * price *and* the volume side flip when you are the buyer. An instant buy is
 * filled by sellers hitting the high side of the book, so it uses `highVolume24h`;
 * a resting low offer is filled by instant sellers, so it uses `lowVolume24h`.
 *
 * The GE buy limit is a genuine purchase cap in this direction. It stays
 * metadata on the shop -> GE side because it caps one player's purchases, not
 * market sales; here we are that player.
 */

import { isGeneralStore, planShopSink } from '../domain/shopSink.js';
import { DEFAULT_HOP_SECONDS, DEFAULT_MAX_WORLDS } from '../domain/budget.js';
import { toShopRow } from './rank.js';
import type {
  MarketQuote,
  MarketSnapshot,
  SellMode,
  ShopCatalog,
  ShopSinkOpportunity,
  ShopSinkRanking,
} from '../types.js';

/** The GE price a mode pays when buying. Null when the quote has no usable price. */
export function targetBuyPrice(quote: MarketQuote, mode: SellMode): number | null {
  const price = mode === 'pessimistic' ? quote.high : quote.low;
  return price !== null && price > 0 ? price : null;
}

/** 24h traded volume on the side of the book a buy mode takes liquidity from. */
export function volume24hForBuyMode(quote: MarketQuote, mode: SellMode): number {
  return mode === 'pessimistic' ? quote.highVolume24h : quote.lowVolume24h;
}

export interface SinkRankOptions {
  mode: SellMode;
  /**
   * Drop general stores, which buy almost anything but whose stock table only
   * describes what they sell. On by default per the current scope.
   */
  excludeGeneralStores?: boolean;
  /** Infinite-stock shops are excluded by default, matching `rank.ts`. */
  includeInfiniteStock?: boolean;
  /** Currencies other than Coins are excluded by default. */
  includeOtherCurrencies?: boolean;
  /** Only rows whose shop is members-only (matches the shop -> GE page). */
  membersOnly?: boolean;
  /** Minimum total profit for the planned sale. Zero is floored to 1 gp. */
  minProfit?: number;
  /** Drop rows the GE cannot supply at least this many units in 4h. */
  minVolume4h?: number;
  /** Seconds per tile for the GE -> shop trip. */
  secondsPerTile?: number;
  /** Seconds charged for each world hop. */
  hopSeconds?: number;
  /** Ceiling on worlds visited. */
  maxWorlds?: number;
  /** Gold available; 0 or omitted means no budget cap. */
  budgetGp?: number;
  /** Cap the returned list. */
  limit?: number;
}

const COINS = 'coins';
const DEFAULT_SECONDS_PER_TILE = 0.6;

export function rankSinks(
  catalog: ShopCatalog,
  market: MarketSnapshot,
  options: SinkRankOptions,
): ShopSinkRanking {
  const excludeGeneralStores = options.excludeGeneralStores ?? true;
  const includeInfiniteStock = options.includeInfiniteStock ?? false;
  const includeOtherCurrencies = options.includeOtherCurrencies ?? false;
  const membersOnly = options.membersOnly ?? false;
  const minProfit = Math.max(1, options.minProfit ?? 1);
  const minVolume4h = Math.max(0, options.minVolume4h ?? 0);
  const secondsPerTile = Math.max(
    0,
    options.secondsPerTile ?? DEFAULT_SECONDS_PER_TILE,
  );
  const hopSeconds = Math.max(0, options.hopSeconds ?? DEFAULT_HOP_SECONDS);
  const maxWorlds = Math.max(
    1,
    Math.floor(options.maxWorlds ?? DEFAULT_MAX_WORLDS),
  );
  const budgetGp = Math.max(0, options.budgetGp ?? 0);

  const best = new Map<string, ShopSinkOpportunity>();

  for (const entry of catalog.entries) {
    if (!includeOtherCurrencies && entry.currency.toLowerCase() !== COINS) continue;
    if (entry.infiniteStock && !includeInfiniteStock) continue;
    if (membersOnly && !entry.members) continue;
    if (excludeGeneralStores && isGeneralStore(entry.shopTypes)) continue;
    // `store_buy_price` is the wiki's own statement that this shop buys the
    // item at default stock. It is N/A when the shop does not buy at all (for
    // example Eblis's ancient staff, whose table sets `hidebuy=y`), even though
    // the buy multiplier can still be non-zero. Treating the multiplier alone
    // as a "yes" would manufacture a buyer, so the published price is required.
    if (entry.storeBuyPrice === null || entry.storeBuyPrice <= 0) continue;
    if (entry.itemId === null) continue;

    const quote = market.quotes[String(entry.itemId)];
    if (quote === undefined) continue;

    const geBuyPrice = targetBuyPrice(quote, options.mode);
    if (geBuyPrice === null) continue;

    const row = toShopRow(entry);
    if (row === null) continue;

    const volume4h = Math.floor(
      volume24hForBuyMode(quote, options.mode) / 6,
    );
    if (volume4h < minVolume4h) continue;

    // The GE buy limit and the 4h traded volume both bound how many units a
    // 4h window can supply. A missing limit is "no limit", not zero.
    const purchaseCap4h = Math.min(quote.limit ?? Number.POSITIVE_INFINITY, volume4h);
    if (purchaseCap4h < 1) continue;

    const plan = planShopSink(row, {
      geCostPerUnit: geBuyPrice,
      purchaseCap4h,
      geTiles: entry.geTiles,
      secondsPerTile,
      hopSeconds,
      maxWorlds,
      budgetGp,
      startStock: row.baseStock,
    });
    if (plan.units <= 0) continue;
    if (plan.profit < minProfit) continue;

    const opportunity: ShopSinkOpportunity = {
      itemId: quote.id,
      itemName: quote.name,
      shopPage: entry.shopPage,
      shopName: entry.shopName,
      soldBy: entry.soldBy,
      location: entry.location,
      members: entry.members,
      shopTypes: entry.shopTypes,

      itemValue: row.itemValue,
      buyMultiplier: row.buyMultiplier,
      delta: row.delta,
      baseStock: entry.baseStock,
      infiniteStock: entry.infiniteStock,

      geBuyPrice,
      shopFirstUnitPrice: plan.firstUnitRevenue,
      shopLastUnitPrice: plan.lastUnitRevenue,
      shopAvgPrice: plan.totalRevenue / plan.units,

      units: plan.units,
      totalCost: plan.totalCost,
      totalRevenue: plan.totalRevenue,
      profit: plan.profit,
      margin: plan.marginPerUnit,
      marginPct: (plan.marginPerUnit / geBuyPrice) * 100,

      geBuyLimit: quote.limit,
      volume4h,
      purchaseCap4h,
      unitsPerWorld: plan.unitsPerWorld,
      worlds: plan.worlds,
      worldLimited: plan.worldLimited,
      budgetLimited: plan.budgetLimited,
      deltaPct: plan.deltaPct,
      priceDropPerUnit: plan.priceDropPerUnit,
      priceLimited: plan.priceLimited,
      atFloor: plan.atFloor,

      geTiles: plan.geTiles,
      tripSeconds: plan.tripSeconds,
      timeSeconds: plan.timeSeconds,
      gpPerHour: plan.gpPerHour,
    };

    // The storeline table can list the same item under several vendors. Keep a
    // single deterministic row per (shop, item): the best buy multiplier, then
    // the least overstocked start.
    const key = `${entry.shopPage}\u0000${entry.itemId}`;
    const existing = best.get(key);
    if (existing === undefined || betterRow(opportunity, existing)) {
      best.set(key, opportunity);
    }
  }

  const opportunities = [...best.values()];

  // Unknown time is never better than a known time, whichever way the column
  // is sorted; profit remains the tie-breaker among unknown-distance rows.
  opportunities.sort((a, b) => {
    if (a.gpPerHour !== b.gpPerHour) {
      if (a.gpPerHour === null) return 1;
      if (b.gpPerHour === null) return -1;
      return b.gpPerHour - a.gpPerHour;
    }
    if (b.profit !== a.profit) return b.profit - a.profit;
    if (b.margin !== a.margin) return b.margin - a.margin;
    const byItem = a.itemName.localeCompare(b.itemName);
    if (byItem !== 0) return byItem;
    return a.shopPage.localeCompare(b.shopPage);
  });

  const limited =
    options.limit !== undefined ? opportunities.slice(0, options.limit) : opportunities;

  return {
    generatedAt: new Date().toISOString(),
    pricesAsOf: market.pricesAsOf,
    mode: options.mode,
    filters: {
      excludeGeneralStores,
      includeInfiniteStock,
      membersOnly,
      minProfit,
      minVolume4h,
      hopSeconds,
      maxWorlds,
      budgetGp,
    },
    count: limited.length,
    opportunities: limited,
  };
}

function betterRow(
  candidate: ShopSinkOpportunity,
  current: ShopSinkOpportunity,
): boolean {
  if (candidate.buyMultiplier !== current.buyMultiplier) {
    return candidate.buyMultiplier > current.buyMultiplier;
  }
  const candidateStock = candidate.baseStock ?? 0;
  const currentStock = current.baseStock ?? 0;
  return candidateStock < currentStock;
}

/** Cheapest quote lookup helper for callers that already have an id. */
export function quoteForSink(
  market: MarketSnapshot,
  itemId: number,
): MarketQuote | undefined {
  return market.quotes[String(itemId)];
}
