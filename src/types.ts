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

/** Runtime shape of a map point, used by the catalogue and sink payloads. */
export const MapPointSchema = z.object({
  x: z.number(),
  y: z.number(),
  mapID: z.number().int(),
});

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
  /**
   * Straight-line distance from the Grand Exchange to this shop, in tiles.
   * Sourced from the wiki map; null when the shop is on another map or has no
   * coordinates. Used by the GE -> shop planner, never defaulted.
   */
  geTiles: z.number().nullable(),
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
  /** Location of the Grand Exchange, the origin of every GE -> shop trip. */
  gePoint: MapPointSchema.nullable(),
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
  /** GE 4-hour buy limit. It caps one player's purchases, not market sales. */
  geBuyLimit: z.number().int().nullable(),
  /** Floored 4h slice of the 24h volume on the chosen side of the book. */
  volume4h: z.number(),
  /** Units from one shop visit that can sell in 4h: min(units, volume4h). */
  sellablePer4h: z.number(),
  /** Profit from one shop visit's sellable units, not the full 4h volume. */
  gpPer4h: z.number(),
  /** World hops needed to fill the 4h volume. Null when volume is zero. */
  worldsToFill4h: z.number().int().nullable(),
  /** Placeholder equal to gpPer4h; the UI recomputes the gold-sized rate. */
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

// ---------------------------------------------------------------------------
// GE -> shop sinks
// ---------------------------------------------------------------------------

/**
 * One (item, shop) pair where buying on the GE and selling to the shop can
 * profit. The GE buy limit genuinely caps purchases here, and no tax applies
 * on either leg. See `src/domain/shopSink.ts`.
 */
export const ShopSinkOpportunitySchema = z.object({
  itemId: z.number().int(),
  itemName: z.string(),
  shopPage: z.string(),
  shopName: z.string(),
  soldBy: z.string().nullable(),
  location: z.string().nullable(),
  members: z.boolean(),
  shopTypes: z.array(z.string()),

  /** Pricing parameters, passed through so the UI can explain the curve. */
  itemValue: z.number().int(),
  buyMultiplier: z.number(),
  delta: z.number(),
  baseStock: z.number().int().nullable(),
  infiniteStock: z.boolean(),

  /** GE price paid per unit: `high` for an instant buy, `low` for a patient one. */
  geBuyPrice: z.number().int(),
  /** What the shop pays for the first, last and average unit. */
  shopFirstUnitPrice: z.number().int(),
  shopLastUnitPrice: z.number().int(),
  shopAvgPrice: z.number(),

  /** Units bought on the GE and sold to the shop. */
  units: z.number().int(),
  /** Coins paid on the GE (no tax). */
  totalCost: z.number(),
  /** Coins received from the shop (no tax). */
  totalRevenue: z.number(),
  profit: z.number(),
  /** Average profit per unit, and as a percentage of the GE cost. */
  margin: z.number(),
  marginPct: z.number(),

  /** GE 4h buy limit. Here it really is a purchase cap. */
  geBuyLimit: z.number().int().nullable(),
  /** 4h slice of the 24h volume on this mode's side of the book. */
  volume4h: z.number(),
  /** min(geBuyLimit, volume4h): what the GE can supply in 4h. */
  purchaseCap4h: z.number().int(),
  /** Units one fresh world absorbs before its next price stops paying. */
  unitsPerWorld: z.number().int(),
  /** Worlds needed to sell `units`; each hop resets the shop's stock. */
  worlds: z.number().int(),
  /** True when the world ceiling, not the GE purchase cap, ended the plan. */
  worldLimited: z.boolean(),
  /** True when available gold, not the GE/world cap, ended the plan. */
  budgetLimited: z.boolean(),
  /** Shop price change per unit sold, as a percentage of item value. */
  deltaPct: z.number(),
  /** Nominal gp the shop's offer falls by for each extra unit sold. */
  priceDropPerUnit: z.number(),
  /** True when the shop's price curve, not the purchase cap, ended the sale. */
  priceLimited: z.boolean(),
  /** True when the marginal unit already paid the 10%-of-value floor. */
  atFloor: z.boolean(),

  /** Straight-line GE distance, per-trip seconds and the plan's total time. */
  geTiles: z.number().nullable(),
  tripSeconds: z.number().nullable(),
  timeSeconds: z.number(),
  /** Null when a trip is needed but the GE distance is unknown. */
  gpPerHour: z.number().nullable(),
});
export type ShopSinkOpportunity = z.infer<typeof ShopSinkOpportunitySchema>;

export const ShopSinkRankingSchema = z.object({
  generatedAt: z.string(),
  pricesAsOf: z.string(),
  mode: SellModeSchema,
  filters: z.object({
    excludeGeneralStores: z.boolean(),
    includeInfiniteStock: z.boolean(),
    membersOnly: z.boolean(),
    minProfit: z.number(),
    minVolume4h: z.number(),
    /** Seconds charged for each world hop in this snapshot. */
    hopSeconds: z.number(),
    /** Ceiling on worlds visited in this snapshot. */
    maxWorlds: z.number().int(),
    /** Gold budget used for this snapshot; 0 means no budget cap. */
    budgetGp: z.number(),
  }),
  count: z.number().int(),
  opportunities: z.array(ShopSinkOpportunitySchema),
});
export type ShopSinkRanking = z.infer<typeof ShopSinkRankingSchema>;

/** Both sell modes plus the shared GE origin, as consumed by the UI. */
export const ShopSinksPayloadSchema = z.object({
  generatedAt: z.string(),
  pricesAsOf: z.string(),
  /** Null when the wiki map could not locate the Grand Exchange. */
  gePoint: MapPointSchema.nullable(),
  pessimistic: ShopSinkRankingSchema,
  patient: ShopSinkRankingSchema,
});
export type ShopSinksPayload = z.infer<typeof ShopSinksPayloadSchema>;
