/**
 * GE -> shop planning: buy on the Grand Exchange, sell to a shop for profit.
 *
 * This is the reverse of the main calculator and reuses the same sourced shop
 * formula (`shopUnitSellPrice`, `planShopSale`). Two asymmetries matter:
 *
 *  1. **No GE tax.** Tax is charged on GE *sales*; buying on the GE and selling
 *     to a shop is taxed in neither leg. See `docs/shop-mechanics.md` §7.
 *  2. **The GE buy limit is a purchase cap here.** On the shop -> GE side it is
 *     metadata, because it caps a player's purchases, not market sales. Here we
 *     are the buyer, so the limit genuinely bounds how many units a 4-hour
 *     window can supply, alongside the 24h traded volume.
 *
 * Everything is per shop and per item. Time assumptions stay explicit: the
 * trip length comes from the shop's own straight-line distance to the Grand
 * Exchange (`geTiles`, sourced from the wiki map), and an unknown distance never
 * produces a gp/hour number.
 */

import { DEFAULT_UNITS_PER_LOAD } from './budget.js';
import { roundTripSeconds } from './bankTrip.js';
import { planShopSale, type ShopRow } from './shopPrice.js';

/**
 * Wiki category that marks a general store.
 * https://oldschool.runescape.wiki/w/Category:General_stores
 */
export const GENERAL_STORE_CATEGORY = 'General stores';

const GENERAL_STORE_NAMES: ReadonlySet<string> = new Set([
  'general store',
  'general stores',
]);

/**
 * True when the wiki classifies this shop as a general store.
 *
 * General stores buy almost anything, which makes them the natural sink for
 * arbitrary GE purchases, but their stock table only covers what they sell. We
 * exclude them by the wiki's own category rather than by matching shop names:
 * a name list would silently miss pages and misclassify specialists.
 */
export function isGeneralStore(shopTypes: readonly string[]): boolean {
  return shopTypes.some((type) =>
    GENERAL_STORE_NAMES.has(type.trim().toLowerCase()),
  );
}

/**
 * Interface time for one round trip. Collecting from the GE and using the shop
 * counter are both interface actions, not travel: 3 seconds, the same constant
 * used for a bank handover.
 */
export const DEFAULT_SINK_HANDOVER_SECONDS = 3;

/** Seconds in the GE's buy-limit window. */
export const BUY_LIMIT_WINDOW_SECONDS = 4 * 3600;

export interface ShopSinkOptions {
  /** GE price paid per unit: `high` for an instant buy, `low` for a patient offer. */
  geCostPerUnit: number;
  /**
   * Units the GE can supply in a 4h window: `min(buy limit, floor(volume24h/6))`.
   * Required because selling to a shop has no stock bound of its own.
   */
  purchaseCap4h: number;
  /** This shop's straight-line distance to the GE, or null when unknown. */
  geTiles: number | null;
  /** Seconds per tile. 0.6 walking, 0.3 running. */
  secondsPerTile?: number;
  /** Seconds to use the GE and shop interfaces per round trip. */
  handoverSeconds?: number;
  /** True only when the item is definitively stackable; null/false charge a load. */
  stackable?: boolean | null;
  /** Non-stackable units per inventory load. Defaults to 27. */
  unitsPerLoad?: number;
  /** Stock the shop starts at. Defaults to the row's base stock. */
  startStock?: number;
}

export interface ShopSinkPlan {
  /** Units worth buying on the GE and selling to the shop. */
  units: number;
  /** Coins paid on the GE. */
  totalCost: number;
  /** Coins the shop pays. */
  totalRevenue: number;
  /** `totalRevenue - totalCost`; no tax applies to either leg. */
  profit: number;
  /** Average profit per unit sold. */
  marginPerUnit: number;
  /** What the shop paid for the first and the last (marginal) unit. */
  firstUnitRevenue: number;
  lastUnitRevenue: number;
  /** Resolved stackability: true only when explicitly stated. */
  stackable: boolean;
  /** Inventory loads, or 1 for a stackable item that fits one slot. */
  loads: number;
  /** Inventory capacity used for the non-stackable unit count. */
  unitsPerLoad: number;
  /** Purchase cap the sale was planned against. */
  purchaseCap4h: number;
  /** True when the sale was limited by the price curve, not the cap. */
  priceLimited: boolean;
  /** True when the last accepted unit already paid the 10%-of-value floor. */
  atFloor: boolean;
  /** Straight-line distance used, echoed for transparency. */
  geTiles: number | null;
  /** Seconds for one there-and-back trip; null when the distance is unknown. */
  tripSeconds: number | null;
  /** Total seconds spent on trips. 0 when the distance is unknown. */
  travelSeconds: number;
  /** Seconds the GE needs to supply `units`, from the 4h purchase cap. */
  buySeconds: number;
  /** `max(travelSeconds, buySeconds)`. */
  timeSeconds: number;
  /** False when trips are needed but the distance is unknown. */
  timeKnown: boolean;
  /**
   * Profit per hour. Null when a trip is needed and the GE distance is unknown:
   * never a number computed from an invented trip.
   */
  gpPerHour: number | null;
}

/**
 * Plan one GE -> shop flip, including the inventory and purchase-limit time.
 *
 * Units are bounded by the GE's 4h purchase cap, not by the shop's stock: the
 * shop happily absorbs more, only paying less. `loads` is the number of round
 * trips the non-stackable units need (one inventory of 27 at a time), and the
 * time model takes the slower of walking those loads and waiting for the GE to
 * supply them. The shop is assumed to be at default stock on arrival; destock
 * between trips is not modelled and is stated in the UI.
 */
export function planShopSink(
  row: ShopRow,
  options: ShopSinkOptions,
): ShopSinkPlan {
  const stackable = options.stackable === true;
  const unitsPerLoad = Math.max(
    1,
    Math.floor(options.unitsPerLoad ?? DEFAULT_UNITS_PER_LOAD),
  );
  const purchaseCap4h = Math.max(0, Math.floor(options.purchaseCap4h));
  const secondsPerTile = Math.max(0, options.secondsPerTile ?? 0.6);
  const handoverSeconds = Math.max(
    0,
    options.handoverSeconds ?? DEFAULT_SINK_HANDOVER_SECONDS,
  );

  const sale = planShopSale(row, options.geCostPerUnit, {
    maxUnits: purchaseCap4h,
    ...(options.startStock !== undefined
      ? { startStock: options.startStock }
      : {}),
  });

  const units = sale.units;
  let loads = 0;
  if (units > 0) loads = stackable ? 1 : Math.ceil(units / unitsPerLoad);

  const tripSeconds =
    options.geTiles === null
      ? null
      : roundTripSeconds(options.geTiles, secondsPerTile, handoverSeconds);
  const travelSeconds = tripSeconds === null ? 0 : loads * tripSeconds;
  const buySeconds =
    purchaseCap4h > 0 ? (units / purchaseCap4h) * BUY_LIMIT_WINDOW_SECONDS : 0;
  const timeSeconds = Math.max(travelSeconds, buySeconds);
  const timeKnown = tripSeconds !== null;

  let gpPerHour: number | null;
  if (units <= 0) {
    // Zero units is a known zero, not an unknown time.
    gpPerHour = 0;
  } else {
    gpPerHour =
      timeKnown && timeSeconds > 0
        ? (sale.profit * 3600) / timeSeconds
        : null;
  }

  return {
    units,
    totalCost: sale.totalCost,
    totalRevenue: sale.totalRevenue,
    profit: sale.profit,
    marginPerUnit: units > 0 ? sale.profit / units : 0,
    firstUnitRevenue: sale.firstUnitRevenue,
    lastUnitRevenue: sale.lastUnitRevenue,
    stackable,
    loads,
    unitsPerLoad,
    purchaseCap4h,
    priceLimited: sale.stoppedAtMargin,
    atFloor: sale.atFloor,
    geTiles: options.geTiles,
    tripSeconds,
    travelSeconds,
    buySeconds,
    timeSeconds,
    timeKnown,
    gpPerHour,
  };
}
