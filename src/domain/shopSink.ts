/**
 * GE -> shop planning: buy on the Grand Exchange, sell to a shop for profit.
 *
 * This is the reverse of the main calculator and reuses the same sourced shop
 * formula (`shopUnitSellPrice`, `planShopSale`). Three asymmetries matter:
 *
 *  1. **No GE tax.** Tax is charged on GE *sales*; buying on the GE and selling
 *     to a shop is taxed in neither leg. See `docs/shop-mechanics.md` §7.
 *  2. **The GE buy limit is a purchase cap here.** On the shop -> GE side it is
 *     metadata, because it caps a player's purchases, not market sales. Here we
 *     are the buyer, so the limit genuinely bounds how many units a 4-hour
 *     window can supply, alongside the 24h traded volume.
 *  3. **Items travel noted.** A GE purchase can be collected as banknotes, so
 *     the whole quantity fits one inventory slot per item type. There are no
 *     27-unit loads and therefore no banking trips. The limiting resource is
 *     the number of **worlds** you hop: each fresh world resets the shop's stock
 *     to its default, so the same falling price curve can be sold again.
 *
 * Everything is per shop and per item. Time assumptions stay explicit: one
 * GE <-> shop round trip, plus a world-hop charge per world visited. The trip
 * length comes from the shop's own straight-line distance to the Grand
 * Exchange (`geTiles`, sourced from the wiki map). An unknown distance never
 * produces a gp/hour number.
 */

import { DEFAULT_HOP_SECONDS, DEFAULT_MAX_WORLDS } from './budget.js';
import { roundTripSeconds } from './bankTrip.js';
import {
  planShopSale,
  sellTotalRevenue,
  type ShopRow,
} from './shopPrice.js';

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
  /** Seconds to hop to a new world and get back to the shop. */
  hopSeconds?: number;
  /** Ceiling on worlds visited. Defaults to the shared 200-world assumption. */
  maxWorlds?: number;
  /** Stock the shop starts at. Defaults to the row's base stock. */
  startStock?: number;
}

export interface ShopSinkPlan {
  /** Total units bought on the GE and sold across every world. */
  units: number;
  /** Units one fresh world absorbs before the shop's next price stops paying. */
  unitsPerWorld: number;
  /** Worlds needed to sell `units`. */
  worlds: number;
  /** True when the world ceiling, not the GE cap, ended the plan. */
  worldLimited: boolean;
  /** Coins paid on the GE. */
  totalCost: number;
  /** Coins the shops pay across every world. */
  totalRevenue: number;
  /** `totalRevenue - totalCost`; no tax applies to either leg. */
  profit: number;
  /** Average profit per unit sold. */
  marginPerUnit: number;
  /** What a shop paid for the first and the last unit of one world's batch. */
  firstUnitRevenue: number;
  lastUnitRevenue: number;
  /** True when the price curve, not the GE cap, ended one world's batch. */
  priceLimited: boolean;
  /** True when the last unit of one world's batch hit the 10%-of-value floor. */
  atFloor: boolean;
  /** Shop price change per unit sold, as a percentage of item value. */
  deltaPct: number;
  /** Nominal gp the shop's offer falls by for each unit sold on one world. */
  priceDropPerUnit: number;
  /** Straight-line distance used, echoed for transparency. */
  geTiles: number | null;
  /** Seconds for the one GE <-> shop round trip; null when distance unknown. */
  tripSeconds: number | null;
  /** Total seconds spent hopping between worlds. */
  hopSecondsTotal: number;
  /** `tripSeconds + hopSecondsTotal`; 0 when the distance is unknown. */
  travelSeconds: number;
  /** Seconds the GE needs to supply `units`, from the 4h purchase cap. */
  buySeconds: number;
  /** `max(travelSeconds, buySeconds)`. */
  timeSeconds: number;
  /** False when travel is needed but the GE distance is unknown. */
  timeKnown: boolean;
  /**
   * Profit per hour. Null when travel is needed and the GE distance is unknown:
   * never a number computed from an invented trip.
   */
  gpPerHour: number | null;
}

/**
 * Plan one GE -> shop flip across worlds.
 *
 * One world resets the shop's stock, so its falling offer curve can be sold
 * again after a hop. `unitsPerWorld` is the marginal-sale quantity for a fresh
 * world; the plan repeats it until either the GE's 4h purchase cap or the world
 * ceiling binds. Items are noted, so there are no inventory loads or banking
 * trips: the whole purchase travels in one slot per item type, and the only
 * movement is one GE <-> shop trip plus one hop per extra world.
 *
 * The shop is assumed to be at default stock on arrival on each world. Destock
 * between visits to the same world is not modelled and is stated in the UI.
 */
export function planShopSink(
  row: ShopRow,
  options: ShopSinkOptions,
): ShopSinkPlan {
  const purchaseCap4h = Math.max(0, Math.floor(options.purchaseCap4h));
  const secondsPerTile = Math.max(0, options.secondsPerTile ?? 0.6);
  const handoverSeconds = Math.max(
    0,
    options.handoverSeconds ?? DEFAULT_SINK_HANDOVER_SECONDS,
  );
  const hopSeconds = Math.max(0, options.hopSeconds ?? DEFAULT_HOP_SECONDS);
  const maxWorlds = Math.max(
    1,
    Math.floor(options.maxWorlds ?? DEFAULT_MAX_WORLDS),
  );
  const startStock = options.startStock ?? row.baseStock;

  // A fresh world: the marginal sale stops when the shop's next offer no longer
  // beats the GE cost, or at the GE purchase cap if that is tighter.
  const perWorld = planShopSale(row, options.geCostPerUnit, {
    maxUnits: purchaseCap4h,
    startStock,
  });

  const unitsPerWorld = perWorld.units;
  const maxUnitsByWorlds = unitsPerWorld * maxWorlds;
  const units = Math.min(purchaseCap4h, maxUnitsByWorlds);

  const worlds = unitsPerWorld > 0 ? Math.ceil(units / unitsPerWorld) : 0;
  const fullWorlds = unitsPerWorld > 0 ? Math.floor(units / unitsPerWorld) : 0;
  const remainder = unitsPerWorld > 0 ? units % unitsPerWorld : 0;
  const totalRevenue =
    unitsPerWorld > 0
      ? fullWorlds * perWorld.totalRevenue +
        (remainder > 0 ? sellTotalRevenue(row, remainder, startStock) : 0)
      : 0;

  const totalCost = units * options.geCostPerUnit;
  const profit = totalRevenue - totalCost;

  const tripSeconds =
    options.geTiles === null
      ? null
      : roundTripSeconds(options.geTiles, secondsPerTile, handoverSeconds);
  const hopSecondsTotal = worlds * hopSeconds;
  const travelSeconds =
    units <= 0 || tripSeconds === null
      ? 0
      : tripSeconds + hopSecondsTotal;
  const buySeconds =
    purchaseCap4h > 0 ? (units / purchaseCap4h) * BUY_LIMIT_WINDOW_SECONDS : 0;
  const timeSeconds = Math.max(travelSeconds, buySeconds);
  const timeKnown = tripSeconds !== null;

  let gpPerHour: number | null;
  if (units <= 0) {
    // No units is a known zero, not an unknown time.
    gpPerHour = 0;
  } else {
    gpPerHour =
      timeKnown && timeSeconds > 0
        ? (profit * 3600) / timeSeconds
        : null;
  }

  return {
    units,
    unitsPerWorld,
    worlds,
    worldLimited: unitsPerWorld > 0 && purchaseCap4h > maxUnitsByWorlds,
    totalCost,
    totalRevenue,
    profit,
    marginPerUnit: units > 0 ? profit / units : 0,
    firstUnitRevenue: perWorld.firstUnitRevenue,
    lastUnitRevenue: perWorld.lastUnitRevenue,
    priceLimited: perWorld.stoppedAtMargin,
    atFloor: perWorld.atFloor,
    deltaPct: row.delta / 10,
    priceDropPerUnit: row.infiniteStock
      ? 0
      : (row.itemValue * row.delta) / 1000,
    geTiles: options.geTiles,
    tripSeconds,
    hopSecondsTotal,
    travelSeconds,
    buySeconds,
    timeSeconds,
    timeKnown,
    gpPerHour,
  };
}
