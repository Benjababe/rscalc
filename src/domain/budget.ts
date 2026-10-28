/**
 * Budget-aware purchase planning with world-hop time.
 *
 * Answers: "I have G gp. How many units of this item can I actually walk away
 * with, how long does it take, and what's my gp/hour?"
 *
 * Model and assumptions (all deliberate, all stated in the UI):
 *
 *  - **Every world visited is at full default stock.** Shop stock is per-world,
 *    so a fresh world restarts the price curve at `baseStock`. This is the
 *    optimistic-but-standard assumption for shop flipping.
 *  - **Price rises as you buy.** Within a world we walk the same marginal curve
 *    as `planPurchase`, so a budget doesn't simply divide by one unit price.
 *  - **Money is the constraint, not margin.** We keep buying while the next
 *    unit is both affordable AND still profitable.
 *  - **One hop per world visited.** `timeSeconds = worlds * hopSeconds`. This is
 *    conservative: it charges a hop for reaching the first world too.
 *  - **Non-stackable items need banking.** A backpack holds 28 items, and coins
 *    (which stack) still occupy one slot, so each load carries 27
 *    non-stackables. Every load after the first costs a bank trip whose length
 *    is the shop's own distance to its nearest bank, not a global constant.
 *    Stackable items take one slot however many you hold, so they never need
 *    one. When a shop's distance is unknown, `gpPerHour` is null, never a
 *    number computed from an invented trip.
 *  - **Selling time is not modelled here.** GE sell offers are placed instantly;
 *    how long they take to fill is a separate question (see the gp/4h column).
 */

import { bankTripSeconds } from './bankTrip.js';
import { planPurchase, shopUnitBuyPrice, type ShopRow } from './shopPrice.js';

/** Default time to hop to a new world and get back to the shop. */
export const DEFAULT_HOP_SECONDS = 10;
/** Sensible ceiling so a huge budget can't imply thousands of hops. */
const DEFAULT_MAX_WORLDS = 200;

/**
 * Backpack capacity in slots. "A player's backpack inventory can hold up to 28
 * items, and any additional items must be stored in the player's bank."
 *
 * https://oldschool.runescape.wiki/w/Inventory
 */
export const INVENTORY_SLOTS = 28;

/**
 * How many non-stackable units fit in one load while shopping.
 *
 * Coins are stackable and therefore take a single slot, but shop purchases are
 * paid from the inventory, so that slot is not available for goods:
 * `28 - 1 = 27`.
 */
export const DEFAULT_UNITS_PER_LOAD = INVENTORY_SLOTS - 1;

/**
 * Movement speed in seconds per game tile. Walking covers one tile per 0.6 s
 * tick; running covers two, i.e. 0.3 s/tile. The default is the conservative
 * walking figure because run energy is not modelled.
 *
 * https://oldschool.runescape.wiki/w/Game_tick (0.6 s per tick)
 * https://oldschool.runescape.wiki/w/Hazard_Prevention (run = 2 tiles/tick)
 */
export const DEFAULT_SECONDS_PER_TILE = 0.6;

/**
 * Seconds to open the bank and deposit, added to every bank trip. This is the
 * interface time, not travel: it is the same for every shop, unlike distance.
 */
export const DEFAULT_BANK_HANDOVER_SECONDS = 3;

export interface BudgetOptions {
  /** Seconds to travel to the next world and back to the shop. */
  hopSeconds?: number;
  /** How many worlds you're willing to visit. */
  maxWorlds?: number;
  /**
   * This shop's straight-line distance to its nearest bank, in tiles. Comes from
   * `Opportunity.bankTiles`; null when the wiki map cannot locate a bank.
   */
  bankTiles?: number | null;
  /** Seconds per tile. 0.3 = running, 0.6 = walking (the default). */
  secondsPerTile?: number;
  /** Seconds to open the bank and deposit, per trip. */
  bankHandoverSeconds?: number;
  /**
   * Non-stackable units carried per inventory load. Defaults to
   * `DEFAULT_UNITS_PER_LOAD` (27). Ignored when `stackable` is true.
   */
  unitsPerLoad?: number;
  /**
   * Whether the item stacks in the inventory. `true` = never bank between buys;
   * `false` = bank every load. `null`/omitted means the wiki did not say, which
   * is charged as non-stackable: the pessimistic direction for gp/hour.
   */
  stackable?: boolean | null;
  /**
   * Hard ceiling on total units.
   *
   * This exists because a budget alone produces fantasy answers: it will happily
   * plan 188 units of an illiquid item whose GE "price" is a stale trade from
   * days ago, yielding nine-figure gp/hour. Callers should pass the item's
   * sellable throughput (GE buy limit and 24h volume), which is what
   * `Opportunity.sellablePer4h` already encodes.
   */
  maxUnits?: number;
}

export interface BudgetPlan {
  /** Total units you can buy with this budget. */
  units: number;
  /** Total coins spent. */
  totalCost: number;
  /** Coins you started with, minus what you spent. */
  leftover: number;
  /** World visits required. */
  worlds: number;
  /** Revenue net of GE tax, minus totalCost. */
  /** Revenue net of GE tax, minus totalCost. */
  profit: number;
  /** Seconds spent hopping between worlds to buy. */
  hopSecondsTotal: number;
  /**
   * Bank trips needed to free inventory space. 0 for stackable items, and 0
   * when everything fits in one load.
   */
  bankTrips: number;
  /** Seconds for one trip to this shop's bank. 0 when there is no bank. */
  bankSecondsPerTrip: number;
  /** Seconds spent banking. 0 when the distance is unknown (see below). */
  bankSecondsTotal: number;
  /** False when banking is needed but the shop's bank distance is unknown. */
  bankTimeKnown: boolean;
  /**
   * Seconds needed to actually offload `units` on the GE, derived from the
   * item's 4-hour sellable throughput. 0 when no throughput cap was supplied.
   */
  sellSeconds: number;
  /** The binding constraint: max(buying time, selling time). */
  timeSeconds: number;
  /**
   * Gross margin per hour. Null when banking is required but the shop's bank
   * distance is unknown: reporting a number there would silently assume an
   * invented travel time.
   */
  gpPerHour: number | null;
  /** Average price paid per unit across everything you bought. */
  avgCost: number;
  /** True when you ran out of gold before you ran out of profitable units. */
  budgetLimited: boolean;
  /** True when the shop's price curve made the next unit unprofitable. */
  marginLimited: boolean;
  /** Units from a single full-stock world visit. */
  unitsPerWorld: number;
  /** Cost of clearing one world's worth. */
  costPerWorld: number;
}

const EMPTY: BudgetPlan = {
  units: 0,
  totalCost: 0,
  leftover: 0,
  worlds: 0,
  profit: 0,
  hopSecondsTotal: 0,
  bankTrips: 0,
  bankSecondsPerTrip: 0,
  bankSecondsTotal: 0,
  bankTimeKnown: true,
  sellSeconds: 0,
  timeSeconds: 0,
  gpPerHour: 0,
  avgCost: 0,
  budgetLimited: false,
  marginLimited: false,
  unitsPerWorld: 0,
  costPerWorld: 0,
};

export function planWithBudget(
  row: ShopRow,
  netSellPerUnit: number,
  budgetGp: number,
  options: BudgetOptions = {},
): BudgetPlan {
  const hopSeconds = options.hopSeconds ?? DEFAULT_HOP_SECONDS;
  const secondsPerTile = Math.max(
    0,
    options.secondsPerTile ?? DEFAULT_SECONDS_PER_TILE,
  );
  const handoverSeconds = Math.max(
    0,
    options.bankHandoverSeconds ?? DEFAULT_BANK_HANDOVER_SECONDS,
  );
  const bankTiles = options.bankTiles ?? null;
  const unitsPerLoad = Math.max(
    1,
    Math.floor(options.unitsPerLoad ?? DEFAULT_UNITS_PER_LOAD),
  );
  const maxWorlds = Math.max(1, Math.floor(options.maxWorlds ?? DEFAULT_MAX_WORLDS));
  const unitCap =
    options.maxUnits !== undefined && Number.isFinite(options.maxUnits)
      ? Math.max(0, Math.floor(options.maxUnits))
      : Number.POSITIVE_INFINITY;

  if (!(budgetGp > 0) || !(netSellPerUnit > 0) || unitCap <= 0) {
    return { ...EMPTY, leftover: Math.max(0, budgetGp) };
  }

  // One full-stock world: buy everything that still clears the GE price.
  const perWorld = planPurchase(row, netSellPerUnit, { startStock: row.baseStock });

  if (perWorld.units <= 0 || perWorld.totalCost <= 0) {
    return { ...EMPTY, leftover: budgetGp, marginLimited: true };
  }

  // Worlds fully affordable with the budget, then one partial world.
  // Also clamped by how many units the GE can actually absorb.
  const worldsByBudget = Math.floor(budgetGp / perWorld.totalCost);
  const worldsByCap = Math.floor(unitCap / perWorld.units);
  const fullWorlds = Math.min(worldsByBudget, maxWorlds, worldsByCap);

  let units = fullWorlds * perWorld.units;
  let totalCost = fullWorlds * perWorld.totalCost;
  let worlds = fullWorlds;
  let leftover = budgetGp - totalCost;
  let budgetLimited = false;
  const remainingCap = Number.isFinite(unitCap) ? unitCap - units : Number.POSITIVE_INFINITY;

  if (worlds < maxWorlds && leftover > 0 && remainingCap > 0) {
    let stock = row.baseStock;
    let partUnits = 0;
    let partCost = 0;

    for (let i = 0; i < perWorld.units; i += 1) {
      if (partUnits >= remainingCap) break;
      const price = shopUnitBuyPrice(row, stock);
      if (price > netSellPerUnit) break;
      if (partCost + price > leftover) {
        budgetLimited = true;
        break;
      }
      partCost += price;
      partUnits += 1;
      if (!row.infiniteStock) stock -= 1;
    }

    if (partUnits > 0) {
      units += partUnits;
      totalCost += partCost;
      worlds += 1;
      leftover -= partCost;
    }
  }

  const profit = units * netSellPerUnit - totalCost;

  // Banking is serial with buying, so it adds to the hop time rather than
  // competing with it. You only bank when you need the next load, so N units
  // need `ceil(N / load) - 1` trips: a full inventory you are about to sell
  // does not require a trip back to the shop.
  //
  // Unknown stackability (`null`) is charged as non-stackable: overstating the
  // time (and therefore understating gp/hour) is the safe failure direction.
  const stacks = options.stackable === true;
  const bankTrips =
    stacks || units <= unitsPerLoad ? 0 : Math.ceil(units / unitsPerLoad) - 1;
  // The trip length is per shop. A null distance is not zero seconds; it means
  // the time model cannot answer, so gpPerHour becomes null below.
  const bankSecondsPerTrip =
    bankTiles === null
      ? 0
      : bankTripSeconds(bankTiles, secondsPerTile, handoverSeconds);
  const bankSecondsTotal = bankTrips * bankSecondsPerTrip;
  const bankTimeKnown = bankTrips === 0 || bankTiles !== null;

  // Time is the *slower* of buying and selling. You cannot bank 13,000 units of
  // an item in 10 seconds just because one shop visit covered the purchase: an
  // item whose 4h throughput is 13,000 takes roughly 4 hours to offload.
  const hopSecondsTotal = worlds * hopSeconds;
  const sellSeconds =
    Number.isFinite(unitCap) && unitCap > 0 && units > 0
      ? (units / unitCap) * 4 * 3600
      : 0;
  const timeSeconds = Math.max(hopSecondsTotal + bankSecondsTotal, sellSeconds);

  let gpPerHour: number | null;
  if (units <= 0) {
    // No units is a known zero, not an unknown time.
    gpPerHour = 0;
  } else {
    gpPerHour =
      bankTimeKnown && timeSeconds > 0 ? (profit * 3600) / timeSeconds : null;
  }

  return {
    units,
    totalCost,
    leftover,
    worlds,
    profit,
    hopSecondsTotal,
    bankTrips,
    bankSecondsPerTrip,
    bankSecondsTotal,
    bankTimeKnown,
    sellSeconds,
    timeSeconds,
    gpPerHour,
    avgCost: units > 0 ? totalCost / units : 0,
    budgetLimited,
    marginLimited: perWorld.stoppedAtMargin,
    unitsPerWorld: perWorld.units,
    costPerWorld: perWorld.totalCost,
  };
}
