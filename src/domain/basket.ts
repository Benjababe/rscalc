/**
 * Multi-item shop baskets.
 *
 * A shop does not sell "one item at a time": the same visit, and the same world
 * hop, can buy every profitable item on that shop's stock table. Buying five
 * kinds of rune from Lundail is one visit, not five. This module plans that
 * basket jointly instead of running `planWithBudget` per item and charging the
 * player a hop for each.
 *
 * What is shared:
 *  - **World hops.** Every world is assumed to be at full default stock for
 *    every item. The basket needs `max(units_i / unitsPerWorld_i)` worlds, not
 *    the sum over items.
 *  - **Bank loads.** A backpack holds 28 slots and the coin stack takes one, so
 *    27 units of non-stackable goods fit per load. Distinct stackable item
 *    types each occupy one slot for the whole trip, leaving fewer slots for
 *    non-stackables. Bank trips are computed from the basket total, not per
 *    item. Stackable-only baskets never bank at all.
 *  - **GE sell time.** Each item has its own 4h throughput, and offers fill in
 *    parallel up to the player's GE slot count (members 8, free 3). Sell time is
 *    the makespan of scheduling each item's fill time on those slots.
 *
 * What is not shared/modelled: restock timers, travel to the shop, teleport
 * costs, competition for stock, and the player's attention. See README.
 *
 * The budget allocation is deliberately simple and explainable: take the next
 * marginal unit with the best profit per coin, skipping units that are no longer
 * profitable or unaffordable. Each item's marginal price rises as its stock
 * falls, so efficiency decreases as the basket fills. This is the standard
 * greedy for the fractional relaxation of the budget knapsack; it is not a
 * proof of integer-knapsack optimality. In the common case the budget covers a
 * full world, so the greedy is not used at all and every profitable unit is
 * bought.
 */

import { bankTripSeconds } from './bankTrip.js';
import {
  DEFAULT_BANK_HANDOVER_SECONDS,
  DEFAULT_HOP_SECONDS,
  DEFAULT_MAX_WORLDS,
  DEFAULT_SECONDS_PER_TILE,
  DEFAULT_UNITS_PER_LOAD,
} from './budget.js';
import {
  INFINITE_STOCK_PURCHASE_CAP,
  shopUnitBuyPrice,
  type PurchasePlan,
  type ShopRow,
} from './shopPrice.js';

/**
 * Grand Exchange offer slots. Members get eight, free players three.
 *
 * https://oldschool.runescape.wiki/w/Grand_Exchange
 *
 * A basket containing any members-only item requires a members account, so the
 * default is 8 in that case. An all-free-to-play basket defaults to 3: a member
 * would have 8, but using the free limit is the pessimistic choice for
 * gp/hour.
 */
export const GE_OFFER_SLOTS_MEMBERS = 8;
export const GE_OFFER_SLOTS_FREE = 3;

/** The GE buy limit and volume windows are 4 hours. */
const SELL_WINDOW_SECONDS = 4 * 3600;

export interface ShopBasketItem {
  /**
   * Stable identifier so the caller can join a result back to its source row.
   * It must be unique within one basket.
   */
  id: string;
  /** Optional display label, echoed in the result. */
  name?: string;
  /** The shop row's pricing parameters. */
  row: ShopRow;
  /** What one unit nets after GE tax. */
  netSellPerUnit: number;
  /**
   * Total units of this item the GE can absorb in the 4h window
   * (min of the GE buy limit and 24h volume slice). Omitted or Infinity means
   * uncapped, which callers should avoid: it can imply thousands of worlds.
   */
  maxUnits?: number;
  /**
   * Whether one unit occupies one inventory slot regardless of quantity.
   * `null`/omitted means the wiki did not say and is charged as non-stackable.
   */
  stackable?: boolean | null;
  /**
   * Members-only item or shop. Used to choose the default GE slot count when
   * `offerSlots` is not supplied.
   */
  members?: boolean;
}

export interface BasketOptions {
  /** Seconds to travel to the next world and back to the shop. */
  hopSeconds?: number;
  /** Hard ceiling on world visits. */
  maxWorlds?: number;
  /** This shop's straight-line distance to its nearest bank, in tiles. */
  bankTiles?: number | null;
  /** Seconds per tile. 0.3 = running, 0.6 = walking (the default). */
  secondsPerTile?: number;
  /** Seconds to open the bank and deposit, per trip. */
  bankHandoverSeconds?: number;
  /** Non-stackable units carried per load. Defaults to 27. */
  unitsPerLoad?: number;
  /**
   * Concurrent GE offer slots. Defaults to 8 when any item is members-only and
   * 3 otherwise (the pessimistic free-to-play limit).
   */
  offerSlots?: number;
}

export interface BasketItemPlan {
  /** Position in the input array, for callers that join by index. */
  index: number;
  id: string;
  name?: string;
  /** Total units bought across all visited worlds. */
  units: number;
  /** Coins spent on this item. */
  totalCost: number;
  /** Net revenue minus totalCost for this item. */
  profit: number;
  /** Average price paid per unit, 0 when no units were bought. */
  avgCost: number;
  /** Units one full-stock world yields before the margin closes or the cap binds. */
  unitsPerWorld: number;
  /** Cost of clearing one full-stock world. */
  costPerWorld: number;
  /** Total 4h throughput cap, or null when the caller did not supply one. */
  cap: number | null;
  /** Echo of the input; null means unknown, charged as non-stackable. */
  stackable: boolean | null;
}

export interface ShopBasketPlan {
  /** One entry per input item, in the same order. */
  items: BasketItemPlan[];
  /** Total units across every item. */
  units: number;
  /** Total coins spent. */
  totalCost: number;
  /** Gold not spent. */
  leftover: number;
  /** Net revenue minus totalCost. */
  profit: number;
  /** Total cost divided by total units, 0 when nothing was bought. */
  avgCost: number;
  /** World visits needed. */
  worlds: number;
  /** Seconds spent hopping between worlds. */
  hopSecondsTotal: number;
  /** Bank trips needed for the non-stackable part of the basket. */
  bankTrips: number;
  /** Seconds for one trip to this shop's bank. 0 when there is no bank. */
  bankSecondsPerTrip: number;
  /** Seconds spent banking. 0 when the distance is unknown. */
  bankSecondsTotal: number;
  /** False when banking is needed but the shop's bank distance is unknown. */
  bankTimeKnown: boolean;
  /** Distinct stackable item types bought; each takes one inventory slot. */
  stackableSlots: number;
  /** Non-stackable units that must be carried in loads. */
  nonStackableUnits: number;
  /** Non-stackable units carried per load after reserving stackable slots. */
  unitsPerLoad: number;
  /** Seconds the GE needs to absorb the basket across its offer slots. */
  sellSeconds: number;
  /** The binding constraint: max(hop + bank time, sell time). */
  timeSeconds: number;
  /**
   * Profit per hour. Null when banking is required but the shop's bank distance
   * is unknown; 0 when nothing profitable was bought.
   */
  gpPerHour: number | null;
  /** GE offer slots used for the sell-time schedule. */
  offerSlots: number;
  /** True when gold, not stock or margin, limited the final world. */
  budgetLimited: boolean;
  /** True when `maxWorlds` stopped the plan while another world was viable. */
  worldLimited: boolean;
  /** True when at least one item's next unit was no longer profitable. */
  marginLimited: boolean;
}

interface ItemState {
  item: ShopBasketItem;
  index: number;
  net: number;
  cap: number | null;
  stackable: boolean | null;
  eligible: boolean;
  /** Units bought across every world, including the current one. */
  taken: number;
  /** Units bought in the world currently being filled. */
  worldUnits: number;
  unitsPerWorld: number;
  costPerWorld: number;
  totalCost: number;
  profit: number;
}

const EMPTY_PLAN: PurchasePlan = {
  units: 0,
  totalCost: 0,
  totalRevenue: 0,
  profit: 0,
  lastUnitCost: 0,
  stoppedAtMargin: false,
};

function zeroItemPlan(item: ShopBasketItem, index: number): BasketItemPlan {
  return {
    index,
    id: item.id,
    name: item.name,
    units: 0,
    totalCost: 0,
    profit: 0,
    avgCost: 0,
    unitsPerWorld: 0,
    costPerWorld: 0,
    cap: capOf(item),
    stackable: item.stackable ?? null,
  };
}

/** Normalise a throughput cap. `null` means uncapped; invalid values become 0. */
function capOf(item: ShopBasketItem): number | null {
  if (item.maxUnits === undefined) return null;
  if (item.maxUnits === Number.POSITIVE_INFINITY) return null;
  if (!Number.isFinite(item.maxUnits)) return 0;
  return Math.max(0, Math.floor(item.maxUnits));
}

/** A finite non-negative option, or its fallback. */
function nonNegative(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value)
    ? Math.max(0, value)
    : fallback;
}

/** A finite positive integer option, or its fallback. */
function positiveInteger(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value)
    ? Math.max(1, Math.floor(value))
    : fallback;
}

/**
 * How many consecutive units from `stock` all cost the same as the next one.
 *
 * Buying the block is equivalent to the unit-by-unit loop in `planPurchase`,
 * but skips hundreds of identical iterations for cheap, low-delta items. The
 * shop price is non-decreasing as stock falls, so a binary search for the first
 * offset whose price differs is exact.
 */
export function samePriceBlock(
  row: ShopRow,
  stock: number,
  maxUnits: number,
): number {
  if (maxUnits <= 1) return Math.max(0, maxUnits);
  const first = shopUnitBuyPrice(row, stock);
  let low = 1;
  let high = maxUnits; // first differing offset; maxUnits means "all same"
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (shopUnitBuyPrice(row, stock - mid) === first) low = mid + 1;
    else high = mid;
  }
  return low;
}

/**
 * Exact block-optimised equivalent of {@link planPurchase}.
 *
 * Kept separate from `shopPrice.ts` so the game-formula module stays a verbatim
 * port. `tests/basket.test.ts` pins this against `planPurchase` across price
 * curves and caps. `minUnitProfit` defaults to 0 (the original `<= net` rule);
 * the basket uses 1 so a zero-margin unit never consumes its budget.
 */
export function planPurchaseFast(
  row: ShopRow,
  netSellPerUnit: number,
  options: { startStock?: number; maxUnits?: number; minUnitProfit?: number } = {},
): PurchasePlan {
  const startStock = options.startStock ?? row.baseStock;
  const minUnitProfit = options.minUnitProfit ?? 0;
  const hardCap = row.infiniteStock
    ? Math.min(
        options.maxUnits ?? INFINITE_STOCK_PURCHASE_CAP,
        INFINITE_STOCK_PURCHASE_CAP,
      )
    : Math.max(0, startStock);
  const maxUnits = Math.min(options.maxUnits ?? hardCap, hardCap);

  if (netSellPerUnit <= 0 || maxUnits <= 0) {
    return { ...EMPTY_PLAN, stoppedAtMargin: maxUnits > 0 };
  }

  let units = 0;
  let totalCost = 0;
  let lastUnitCost = 0;
  let stock = startStock;

  while (units < maxUnits) {
    const unitCost = shopUnitBuyPrice(row, stock);
    if (unitCost > netSellPerUnit - minUnitProfit) break;

    const remaining = maxUnits - units;
    const block = row.infiniteStock
      ? remaining
      : samePriceBlock(row, stock, remaining);
    const quantity = Math.max(1, Math.min(block, remaining));

    units += quantity;
    totalCost += quantity * unitCost;
    lastUnitCost = unitCost;
    if (!row.infiniteStock) stock -= quantity;
  }

  const totalRevenue = units * netSellPerUnit;
  return {
    units,
    totalCost,
    totalRevenue,
    profit: totalRevenue - totalCost,
    lastUnitCost,
    stoppedAtMargin: units < maxUnits,
  };
}

/** Full-stock, cap-limited plan for one item in a fresh world. */
function fullWorldPlan(state: ItemState): PurchasePlan {
  if (!state.eligible) return EMPTY_PLAN;

  const perWorldMax = state.item.row.infiniteStock
    ? INFINITE_STOCK_PURCHASE_CAP
    : Math.max(0, state.item.row.baseStock);
  const capRemaining =
    state.cap === null ? Number.POSITIVE_INFINITY : state.cap - state.taken;
  const maxUnits = Math.min(perWorldMax, capRemaining);
  if (maxUnits <= 0) return EMPTY_PLAN;

  return planPurchaseFast(state.item.row, state.net, {
    startStock: state.item.row.baseStock,
    maxUnits,
    // A basket only spends budget on units that actually add profit. A
    // zero-margin unit would consume gold and add nothing.
    minUnitProfit: 1,
  });
}

/** True when a fresh world has at least one profitable, affordable unit. */
function canBuyFromFreshWorld(
  states: readonly ItemState[],
  budgetGp: number,
): boolean {
  return states.some((state) => {
    if (!state.eligible) return false;
    const capRemaining =
      state.cap === null ? Number.POSITIVE_INFINITY : state.cap - state.taken;
    if (capRemaining <= 0) return false;
    const price = shopUnitBuyPrice(state.item.row, state.item.row.baseStock);
    return price > 0 && price < state.net && price <= budgetGp;
  });
}

interface PartialResult {
  bought: boolean;
  units: number;
  cost: number;
  profit: number;
}

/**
 * Spend a budget that cannot clear a full world.
 *
 * Always takes the affordable unit with the highest profit per coin, then
 * expands it to the whole same-price block. Cross-multiplication keeps the
 * ratio comparison exact; ties fall back to the larger absolute margin, the
 * cheaper unit, then input order.
 */
function buyPartialWorld(states: ItemState[], budgetGp: number): PartialResult {
  let remaining = budgetGp;
  let units = 0;
  let cost = 0;
  let profit = 0;
  let bought = false;

  while (remaining > 0) {
    let best: {
      state: ItemState;
      price: number;
      profitPerUnit: number;
      block: number;
    } | null = null;

    for (const state of states) {
      if (!state.eligible) continue;

      const perWorldMax = state.item.row.infiniteStock
        ? INFINITE_STOCK_PURCHASE_CAP
        : Math.max(0, state.item.row.baseStock);
      const capRemaining =
        state.cap === null ? Number.POSITIVE_INFINITY : state.cap - state.taken;
      const worldRemaining = Math.min(
        perWorldMax - state.worldUnits,
        capRemaining,
      );
      if (worldRemaining <= 0) continue;

      // `startStock` is always the full-stock figure for the world; the current
      // stock is that figure minus what this world has already taken.
      const stock = state.item.row.infiniteStock
        ? state.item.row.baseStock
        : state.item.row.baseStock - state.worldUnits;
      const price = shopUnitBuyPrice(state.item.row, stock);
      if (price <= 0 || price >= state.net || price > remaining) continue;

      const profitPerUnit = state.net - price;
      const block = state.item.row.infiniteStock
        ? worldRemaining
        : samePriceBlock(state.item.row, stock, worldRemaining);

      if (best === null) {
        best = { state, price, profitPerUnit, block };
        continue;
      }

      // profitPerUnit / price vs best.profitPerUnit / best.price, exactly.
      const lhs = profitPerUnit * best.price;
      const rhs = best.profitPerUnit * price;
      const better =
        lhs > rhs ||
        (lhs === rhs &&
          (profitPerUnit > best.profitPerUnit ||
            (profitPerUnit === best.profitPerUnit &&
              (price < best.price ||
                (price === best.price && state.index < best.state.index)))));
      if (better) {
        best = { state, price, profitPerUnit, block };
      }
    }

    if (best === null) break;

    const affordable = Math.floor(remaining / best.price);
    const quantity = Math.min(best.block, affordable);
    if (quantity <= 0) break;

    const spend = quantity * best.price;
    const gain = quantity * best.profitPerUnit;

    best.state.taken += quantity;
    best.state.worldUnits += quantity;
    best.state.totalCost += spend;
    best.state.profit += gain;

    remaining -= spend;
    units += quantity;
    cost += spend;
    profit += gain;
    bought = true;
  }

  return { bought, units, cost, profit };
}

/**
 * Schedule per-item GE fill times onto `offerSlots` lanes.
 *
 * Longest first, then the least-loaded lane (LPT). The makespan is the time the
 * last offer finishes. This is a good practical schedule, not a proof of the
 * optimal makespan.
 */
function sellMakespan(
  items: readonly BasketItemPlan[],
  offerSlots: number,
): number {
  const jobs = items
    .flatMap((item) => {
      if (item.units <= 0 || item.cap === null || item.cap <= 0) return [];
      return [{ index: item.index, seconds: (item.units / item.cap) * SELL_WINDOW_SECONDS }];
    })
    .sort((a, b) => b.seconds - a.seconds || a.index - b.index);

  const lanes = new Array<number>(Math.max(1, offerSlots)).fill(0);
  for (const job of jobs) {
    let lane = 0;
    for (let i = 1; i < lanes.length; i += 1) {
      if ((lanes[i] ?? 0) < (lanes[lane] ?? 0)) lane = i;
    }
    lanes[lane] = (lanes[lane] ?? 0) + job.seconds;
  }

  let makespan = 0;
  for (const seconds of lanes) makespan = Math.max(makespan, seconds);
  return makespan;
}

export function planShopBasket(
  items: readonly ShopBasketItem[],
  budgetGp: number,
  options: BasketOptions = {},
): ShopBasketPlan {
  const hopSeconds = nonNegative(options.hopSeconds, DEFAULT_HOP_SECONDS);
  const secondsPerTile = nonNegative(
    options.secondsPerTile,
    DEFAULT_SECONDS_PER_TILE,
  );
  const handoverSeconds = nonNegative(
    options.bankHandoverSeconds,
    DEFAULT_BANK_HANDOVER_SECONDS,
  );
  const bankTiles = options.bankTiles ?? null;
  const baseUnitsPerLoad = positiveInteger(
    options.unitsPerLoad,
    DEFAULT_UNITS_PER_LOAD,
  );
  const maxWorlds = positiveInteger(options.maxWorlds, DEFAULT_MAX_WORLDS);
  const defaultOfferSlots = items.some((item) => item.members === true)
    ? GE_OFFER_SLOTS_MEMBERS
    : GE_OFFER_SLOTS_FREE;
  const offerSlots = positiveInteger(options.offerSlots, defaultOfferSlots);

  const states: ItemState[] = items.map((item, index) => {
    const cap = capOf(item);
    const net = item.netSellPerUnit;
    const perWorldMax = item.row.infiniteStock
      ? INFINITE_STOCK_PURCHASE_CAP
      : Math.max(0, item.row.baseStock);
    const eligible =
      item.row.itemValue > 0 &&
      net > 0 &&
      perWorldMax > 0 &&
      (cap === null || cap > 0);
    return {
      item,
      index,
      net,
      cap,
      stackable: item.stackable ?? null,
      eligible,
      taken: 0,
      worldUnits: 0,
      unitsPerWorld: 0,
      costPerWorld: 0,
      totalCost: 0,
      profit: 0,
    };
  });

  if (!(budgetGp > 0) || items.length === 0) {
    return {
      items: items.map(zeroItemPlan),
      units: 0,
      totalCost: 0,
      leftover: Math.max(0, budgetGp),
      profit: 0,
      avgCost: 0,
      worlds: 0,
      hopSecondsTotal: 0,
      bankTrips: 0,
      bankSecondsPerTrip: 0,
      bankSecondsTotal: 0,
      bankTimeKnown: true,
      stackableSlots: 0,
      nonStackableUnits: 0,
      unitsPerLoad: baseUnitsPerLoad,
      sellSeconds: 0,
      timeSeconds: 0,
      gpPerHour: 0,
      offerSlots,
      budgetLimited: false,
      worldLimited: false,
      marginLimited: false,
    };
  }

  // Per-world capacity for display: the full-stock plan before any budget rule.
  for (const state of states) {
    const plan = fullWorldPlan(state);
    state.unitsPerWorld = plan.units;
    state.costPerWorld = plan.totalCost;
  }

  let worlds = 0;
  let budgetLimited = false;
  let worldLimited = false;
  let marginLimited = false;

  while (true) {
    const remainingBudget = budgetGp - states.reduce((sum, s) => sum + s.totalCost, 0);
    if (remainingBudget <= 0) break;

    if (worlds >= maxWorlds) {
      if (canBuyFromFreshWorld(states, remainingBudget)) worldLimited = true;
      break;
    }

    for (const state of states) state.worldUnits = 0;

    const plans = states.map(fullWorldPlan);
    let fullCost = 0;
    for (const plan of plans) {
      if (plan.stoppedAtMargin) marginLimited = true;
      fullCost += plan.totalCost;
    }
    if (fullCost <= 0) break;

    if (remainingBudget >= fullCost) {
      // The budget covers every profitable unit in a fresh world. No allocation
      // choice is needed, so buy the world whole.
      for (let i = 0; i < states.length; i += 1) {
        const state = states[i];
        const plan = plans[i];
        if (state === undefined || plan === undefined || plan.units <= 0) continue;
        state.taken += plan.units;
        state.totalCost += plan.totalCost;
        state.profit += plan.profit;
      }
      worlds += 1;
      continue;
    }

    const partial = buyPartialWorld(states, remainingBudget);
    if (!partial.bought) {
      // Even the cheapest profitable unit is unaffordable.
      budgetLimited = true;
      break;
    }
    worlds += 1;
    budgetLimited = true;
    // Loop again: if the leftover can still buy a fresh world's first unit, the
    // basket keeps hopping. The full-world path above will buy it, otherwise the
    // partial allocator buys what it can and eventually reports no purchase.
  }

  const itemPlans: BasketItemPlan[] = states.map((state) => ({
    index: state.index,
    id: state.item.id,
    name: state.item.name,
    units: state.taken,
    totalCost: state.totalCost,
    profit: state.profit,
    avgCost: state.taken > 0 ? state.totalCost / state.taken : 0,
    unitsPerWorld: state.unitsPerWorld,
    costPerWorld: state.costPerWorld,
    cap: state.cap,
    stackable: state.stackable,
  }));

  const totalUnits = itemPlans.reduce((sum, item) => sum + item.units, 0);
  const totalCost = itemPlans.reduce((sum, item) => sum + item.totalCost, 0);
  const profit = itemPlans.reduce((sum, item) => sum + item.profit, 0);
  const leftover = Math.max(0, budgetGp - totalCost);

  // Each distinct stackable item type holds one slot for the whole trip. The
  // remaining slots carry non-stackable units, 27 of which fit when coins take
  // the 28th. Unknown stackability is charged as non-stackable.
  const stackableSlots = itemPlans.filter(
    (item) => item.units > 0 && item.stackable === true,
  ).length;
  const nonStackableUnits = itemPlans.reduce(
    (sum, item) => sum + (item.stackable === true ? 0 : item.units),
    0,
  );
  const unitsPerLoad = Math.max(1, baseUnitsPerLoad - stackableSlots);
  const bankTrips =
    nonStackableUnits <= unitsPerLoad
      ? 0
      : Math.ceil(nonStackableUnits / unitsPerLoad) - 1;
  const bankSecondsPerTrip =
    bankTiles === null
      ? 0
      : bankTripSeconds(bankTiles, secondsPerTile, handoverSeconds);
  const bankSecondsTotal = bankTrips * bankSecondsPerTrip;
  const bankTimeKnown = bankTrips === 0 || bankTiles !== null;

  const hopSecondsTotal = worlds * hopSeconds;
  const sellSeconds = sellMakespan(itemPlans, offerSlots);
  const timeSeconds = Math.max(hopSecondsTotal + bankSecondsTotal, sellSeconds);

  let gpPerHour: number | null;
  if (totalUnits <= 0) {
    // No units is a known zero, not an unknown time.
    gpPerHour = 0;
  } else {
    gpPerHour =
      bankTimeKnown && timeSeconds > 0 ? (profit * 3600) / timeSeconds : null;
  }

  return {
    items: itemPlans,
    units: totalUnits,
    totalCost,
    leftover,
    profit,
    avgCost: totalUnits > 0 ? totalCost / totalUnits : 0,
    worlds,
    hopSecondsTotal,
    bankTrips,
    bankSecondsPerTrip,
    bankSecondsTotal,
    bankTimeKnown,
    stackableSlots,
    nonStackableUnits,
    unitsPerLoad,
    sellSeconds,
    timeSeconds,
    gpPerHour,
    offerSlots,
    budgetLimited,
    worldLimited,
    marginLimited,
  };
}
