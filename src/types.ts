/**
 * Shared domain types for the shop catalogue, the market snapshot and the
 * ranked output. These cross the file boundary between `data/*.json` and the
 * engine, so they are also the schema of what the UI consumes.
 */

import { z } from 'zod';

/**
 * A point on the wiki's game map, in tiles.
 *
 * `mapID` separates the overworld (0) from underground and instanced maps, so
 * two points are only comparable when their map ids match. See
 * `src/api/wikiMap.ts` and `src/domain/bankTrip.ts`.
 */
export interface MapPoint {
  x: number;
  y: number;
  mapID: number;
}

// ---------------------------------------------------------------------------
// Shop catalogue
// ---------------------------------------------------------------------------

/**
 * One (shop, item) pair.
 *
 * `null` always means "the source did not publish this". Per AGENTS.md we never
 * substitute a plausible-looking value, because a fabricated `baseStock` would
 * silently produce confident, wrong profit numbers.
 */
export const ShopEntrySchema = z.object({
  /** Wiki page title of the shop, e.g. `Bob's Brilliant Axes.` */
  shopPage: z.string(),
  /** Human display name, trailing full stop stripped. */
  shopName: z.string(),
  /** NPC that runs the shop. */
  soldBy: z.string().nullable(),
  /** Item display name as published by the shop table. */
  itemName: z.string(),
  /** GE item id, or null when the name could not be resolved. */
  itemId: z.number().int().nullable(),
  /** Item base value (100% price reference). Null when unresolved. */
  itemValue: z.number().int().nullable(),
  /** Members-only shop. */
  members: z.boolean(),
  /** Where the shop is. */
  location: z.string().nullable(),
  /** Shop categories, e.g. `Magic shops`. Empty when unresolved. */
  shopTypes: z.array(z.string()),
  /** `store_sell_multiplier`: shop sells at this /1000 of value. */
  sellMultiplier: z.number(),
  /** `store_buy_multiplier`: shop buys at this /1000 of value. */
  buyMultiplier: z.number(),
  /** `store_delta`: price change per stock unit, /1000 of value. */
  delta: z.number(),
  /** Default/maximum stock. Null for `N/A`; see `infiniteStock` for `∞`. */
  baseStock: z.number().int().nullable(),
  /** True for `∞` stock shops (capped at 10 items per purchase). */
  infiniteStock: z.boolean(),
  /** Restock interval in game ticks (1 tick = 0.6 s). Null when `N/A`. */
  restockTicks: z.number().int().nullable(),
  /**
   * Straight-line distance to the nearest bank on the shop's map, in tiles.
   * Null when the shop page has no coordinates or no bank exists on its map.
   */
  bankTiles: z.number().nullable(),
  /** Wiki page title of that bank. Null whenever `bankTiles` is null. */
  nearestBank: z.string().nullable(),
  /** Price the shop charges at equilibrium, as published. */
  storeSellPrice: z.number().int().nullable(),
  /** Price the shop pays at equilibrium, as published. */
  storeBuyPrice: z.number().int().nullable(),
  currency: z.string(),
});
export type ShopEntry = z.infer<typeof ShopEntrySchema>;

export const ShopCatalogSchema = z.object({
  generatedAt: z.string(),
  source: z.string(),
  shopCount: z.number().int(),
  entries: z.array(ShopEntrySchema),
});
export type ShopCatalog = z.infer<typeof ShopCatalogSchema>;

// ---------------------------------------------------------------------------
// Market snapshot
// ---------------------------------------------------------------------------

export const MarketQuoteSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  members: z.boolean(),
  /** Item base value, the 100% reference for shop prices. */
  value: z.number().int(),
  /**
   * True when the item occupies one inventory slot regardless of quantity.
   * Null when the wiki does not say (or item variants disagree).
   * https://oldschool.runescape.wiki/w/Stackable_items
   */
  stackable: z.boolean().nullable(),
  /** GE 4-hour buy limit. Null when the item has none. */
  limit: z.number().int().nullable(),
  /** Latest purchase price — what a patient sell offer targets. */
  high: z.number().int().nullable(),
  /** Latest sale price — what an instant sell yields. */
  low: z.number().int().nullable(),
  avgHighPrice24h: z.number().nullable(),
  avgLowPrice24h: z.number().nullable(),
  /** Units traded in the last 24h at the high/low side. */
  highVolume24h: z.number(),
  lowVolume24h: z.number(),
  /** Unix seconds of the last recorded high/low trade. */
  highTime: z.number().int().nullable(),
  lowTime: z.number().int().nullable(),
});
export type MarketQuote = z.infer<typeof MarketQuoteSchema>;

export const MarketSnapshotSchema = z.object({
  generatedAt: z.string(),
  pricesAsOf: z.string(),
  itemCount: z.number().int(),
  quotes: z.record(z.string(), MarketQuoteSchema),
});
export type MarketSnapshot = z.infer<typeof MarketSnapshotSchema>;

// ---------------------------------------------------------------------------
// Ranked opportunities
// ---------------------------------------------------------------------------

export const SellModeSchema = z.enum(['pessimistic', 'patient']);
export type SellMode = z.infer<typeof SellModeSchema>;

export const OpportunitySchema = z.object({
  itemId: z.number().int(),
  itemName: z.string(),
  shopPage: z.string(),
  shopName: z.string(),
  soldBy: z.string().nullable(),
  location: z.string().nullable(),
  members: z.boolean(),
  shopTypes: z.array(z.string()),

  /** Price you pay for the first unit, and for the marginal unit. */
  firstUnitCost: z.number(),
  lastUnitCost: z.number(),
  /** Coins spent to execute `units`. */
  totalCost: z.number(),

  /** Raw GE price used, and what you net after tax. */
  sellPrice: z.number(),
  taxPerUnit: z.number(),
  netSellPerUnit: z.number(),

  /** Units worth buying from one shop before the margin disappears. */
  units: z.number().int(),
  /** Average cost per unit across those units. */
  avgCost: z.number(),
  /** Profit per unit (average), and total across `units`. */
  margin: z.number(),
  marginPct: z.number(),
  totalProfit: z.number(),

  /** Stock data, echoed for transparency. */
  baseStock: z.number().int().nullable(),
  infiniteStock: z.boolean(),
  restockTicks: z.number().int().nullable(),
  /**
   * Whether the item stacks. Drives whether banking time is charged in the
   * budget planner. Null means unknown; treat it conservatively.
   */
  stackable: z.boolean().nullable(),
  /** Per-shop bank distance and bank name, echoed for the time model. */
  bankTiles: z.number().nullable(),
  nearestBank: z.string().nullable(),

  /**
   * Pricing parameters, passed through so the UI can recompute the shop price
   * curve for a gold budget without re-fetching anything. See
   * `src/domain/shopPrice.ts` for the units (multipliers and delta are stored
   * at 10x the displayed percentage).
   */
  itemValue: z.number().int(),
  sellMultiplier: z.number(),
  buyMultiplier: z.number(),
  delta: z.number(),

  /** Throughput constraints. */
  geBuyLimit: z.number().int().nullable(),
  volume4h: z.number(),
  /** Units realistically sellable in 4h: min(units, buyLimit, volume4h). */
  sellablePer4h: z.number(),
  gpPer4h: z.number(),
  /** How many world hops to fill the 4h throughput. Null when unlimited. */
  worldsToFill4h: z.number().int().nullable(),
  /** gp per hour if 4h throughput is achieved. */
  gpPerHour: z.number(),
});
export type Opportunity = z.infer<typeof OpportunitySchema>;

export const RankingSchema = z.object({
  generatedAt: z.string(),
  pricesAsOf: z.string(),
  mode: SellModeSchema,
  filters: z.object({
    minVolume4h: z.number(),
    minMargin: z.number(),
    membersOnly: z.boolean(),
    includeInfiniteStock: z.boolean(),
  }),
  count: z.number().int(),
  opportunities: z.array(OpportunitySchema),
});
export type Ranking = z.infer<typeof RankingSchema>;
