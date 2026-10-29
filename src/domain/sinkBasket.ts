/**
 * GE -> shop baskets: sell several items to the same shop on the same worlds.
 *
 * One world visit can sell every profitable item in that shop's stock table,
 * and the world hop is paid once for the whole basket. Items bought on the GE
 * travel as banknotes, so there are no inventory loads or banking trips: one
 * GE <-> shop trip covers the basket, plus one hop per world.
 *
 * Gold is shared across items. The allocator takes the next marginal unit with
 * the best profit per coin, using each item's own falling shop-price curve. The
 * sequence repeats each world (a fresh world resets the shop's stock), capped by
 * the item's GE 4h purchase limit and the shared world ceiling. This is the
 * standard greedy for the fractional budget knapsack: explainable, but not a
 * proof of integer-knapsack optimality. It also ignores the shared hop cost
 * when ranking units, so a marginal unit that forces an extra world can look
 * slightly better than it is.
 *
 * GE buy offers run concurrently up to the player's offer slots (members 8,
 * free 3), so the basket's GE supply time is the LPT makespan of each item's
 * `units / purchaseCap4h * 4h`, not their sum. Time is the slower of that and
 * the single trip plus world hops. Unknown GE distance -> gpPerHour is null.
 */

import {
  GE_OFFER_SLOTS_FREE,
  GE_OFFER_SLOTS_MEMBERS,
} from './basket.js';
import {
  DEFAULT_HOP_SECONDS,
  DEFAULT_MAX_WORLDS,
  DEFAULT_SECONDS_PER_TILE,
} from './budget.js';
import { roundTripSeconds } from './bankTrip.js';
import {
  BUY_LIMIT_WINDOW_SECONDS,
  DEFAULT_SINK_HANDOVER_SECONDS,
} from './shopSink.js';
import {
  planShopSale,
  shopUnitSellPrice,
  type ShopRow,
} from './shopPrice.js';

const BUY_WINDOW_SECONDS = BUY_LIMIT_WINDOW_SECONDS;

export interface ShopSinkBasketItem {
  /** Stable identifier, unique within one basket. */
  id: string;
  /** Optional display label, echoed in the result. */
  name?: string;
  /** The shop row's pricing parameters. */
  row: ShopRow;
  /** GE price paid per unit in the chosen mode. */
  geCostPerUnit: number;
  /** Units the GE can supply in 4h: min(buy limit, floor(volume24h/6)). */
  purchaseCap4h: number;
  /** Members-only item or shop, used for the default GE offer slots. */
  members?: boolean;
}

export interface ShopSinkBasketOptions {
  /** This shop's straight-line distance to the GE, or null when unknown. */
  geTiles: number | null;
  /** Seconds per tile. 0.6 walking, 0.3 running. */
  secondsPerTile?: number;
  /** Seconds to use the GE and shop interfaces per trip. */
  handoverSeconds?: number;
  /** Seconds to hop to a new world and get back to the shop. */
  hopSeconds?: number;
  /** Ceiling on worlds visited. Defaults to the shared 200-world assumption. */
  maxWorlds?: number;
  /**
   * Concurrent GE buy offer slots. Defaults to 8 when any item is members-only
   * and 3 otherwise (the pessimistic free-to-play limit).
   */
  offerSlots?: number;
}

export interface ShopSinkBasketItemPlan {
  index: number;
  id: string;
  name?: string;
  /** Units allocated across every world. */
  units: number;
  /** Coins paid on the GE for this item. */
  totalCost: number;
  /** Coins the shops pay for this item. */
  totalRevenue: number;
  profit: number;
  /** The GE cost per unit (constant for this item). */
  unitCost: number;
  /** Average shop price across the units sold. */
  avgShopPrice: number;
  /** Units one fresh world absorbs before its next price stops paying. */
  unitsPerWorld: number;
  /** Cost and profit of one world's batch. */
  costPerWorld: number;
  profitPerWorld: number;
  /** Shop price for the first and last unit of a world's batch. */
  firstUnitPrice: number;
  lastUnitPrice: number;
  /** GE 4h supply cap. */
  cap: number;
  /** True when the batch ended at the shop's price floor, not the GE cap. */
  priceLimited: boolean;
}

export interface ShopSinkBasketPlan {
  items: ShopSinkBasketItemPlan[];
  units: number;
  totalCost: number;
  totalRevenue: number;
  profit: number;
  leftover: number;
  /** Average GE cost across all units. */
  unitCost: number;
  /** Worlds needed: `max(ceil(units_i / batch_i))`, shared by every item. */
  worlds: number;
  /** Seconds spent hopping between worlds. */
  hopSecondsTotal: number;
  /** Seconds the GE needs to supply the basket across its offer slots. */
  buySeconds: number;
  /** One GE <-> shop round trip; null when the distance is unknown. */
  tripSeconds: number | null;
  /** `max(trip + hops, buySeconds)`. */
  timeSeconds: number;
  /** False when a trip is needed but the GE distance is unknown. */
  timeKnown: boolean;
  /** Null when travel is needed and the GE distance is unknown. */
  gpPerHour: number | null;
  offerSlots: number;
  /** True when gold, not supply or worlds, stopped the allocation. */
  budgetLimited: boolean;
  /** True when the world ceiling stopped at least one item. */
  worldLimited: boolean;
}

interface ItemState {
  item: ShopSinkBasketItem;
  index: number;
  cost: number;
  cap: number;
  batch: number;
  maxUnits: number;
  /** Shop price for each unit position within one world batch. */
  prices: number[];
  taken: number;
  totalCost: number;
  profit: number;
}

const EMPTY_ITEM: Omit<ShopSinkBasketItemPlan, 'index' | 'id'> = {
  units: 0,
  totalCost: 0,
  totalRevenue: 0,
  profit: 0,
  unitCost: 0,
  avgShopPrice: 0,
  unitsPerWorld: 0,
  costPerWorld: 0,
  profitPerWorld: 0,
  firstUnitPrice: 0,
  lastUnitPrice: 0,
  cap: 0,
  priceLimited: false,
};

function nonNegative(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value)
    ? Math.max(0, value)
    : fallback;
}

function positiveInteger(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value)
    ? Math.max(1, Math.floor(value))
    : fallback;
}

/** Schedule per-item GE buy times onto `offerSlots` lanes (LPT). */
function buyMakespan(
  items: readonly ShopSinkBasketItemPlan[],
  offerSlots: number,
): number {
  const jobs = items
    .flatMap((item) => {
      if (item.units <= 0 || item.cap <= 0) return [];
      return [{ index: item.index, seconds: (item.units / item.cap) * BUY_WINDOW_SECONDS }];
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

/**
 * Plan one shop's GE -> shop basket.
 *
 * `budgetGp` is required and shared: 0 returns an empty plan, matching the
 * shop -> GE basket panel's "enter gold" behaviour. Items are noted, so there
 * is no banking; the single trip and the hops are shared.
 */
export function planShopSinkBasket(
  items: readonly ShopSinkBasketItem[],
  budgetGp: number,
  options: ShopSinkBasketOptions,
): ShopSinkBasketPlan {
  const hopSeconds = nonNegative(options.hopSeconds, DEFAULT_HOP_SECONDS);
  const secondsPerTile = nonNegative(
    options.secondsPerTile,
    DEFAULT_SECONDS_PER_TILE,
  );
  const handoverSeconds = nonNegative(
    options.handoverSeconds,
    DEFAULT_SINK_HANDOVER_SECONDS,
  );
  const maxWorlds = positiveInteger(options.maxWorlds, DEFAULT_MAX_WORLDS);
  const defaultOfferSlots = items.some((item) => item.members === true)
    ? GE_OFFER_SLOTS_MEMBERS
    : GE_OFFER_SLOTS_FREE;
  const offerSlots = positiveInteger(options.offerSlots, defaultOfferSlots);

  const zeroItems = items.map<ShopSinkBasketItemPlan>((item, index) => ({
    index,
    id: item.id,
    name: item.name,
    ...EMPTY_ITEM,
    cap: Math.max(0, Math.floor(item.purchaseCap4h)),
  }));

  if (!(budgetGp > 0) || items.length === 0) {
    return {
      items: zeroItems,
      units: 0,
      totalCost: 0,
      totalRevenue: 0,
      profit: 0,
      leftover: Math.max(0, budgetGp),
      unitCost: 0,
      worlds: 0,
      hopSecondsTotal: 0,
      buySeconds: 0,
      tripSeconds: null,
      timeSeconds: 0,
      timeKnown: options.geTiles !== null,
      gpPerHour: 0,
      offerSlots,
      budgetLimited: false,
      worldLimited: false,
    };
  }

  const states: ItemState[] = [];
  for (const [index, item] of items.entries()) {
    const cost = item.geCostPerUnit;
    const cap = Math.max(0, Math.floor(item.purchaseCap4h));
    if (!(cost > 0) || cap <= 0 || item.row.itemValue <= 0) continue;

    const batchPlan = planShopSale(item.row, cost, {
      maxUnits: cap,
      startStock: item.row.baseStock,
    });
    const batch = batchPlan.units;
    if (batch <= 0) continue;

    const prices: number[] = [];
    for (let position = 0; position < batch; position += 1) {
      prices.push(
        shopUnitSellPrice(
          item.row,
          item.row.infiniteStock ? 0 : item.row.baseStock + position,
        ),
      );
    }

    states.push({
      item,
      index,
      cost,
      cap,
      batch,
      maxUnits: Math.min(cap, batch * maxWorlds),
      prices,
      taken: 0,
      totalCost: 0,
      profit: 0,
    });
  }

  let remaining = budgetGp;
  while (remaining > 0) {
    let best: {
      state: ItemState;
      price: number;
      profitPerUnit: number;
      block: number;
    } | null = null;

    for (const state of states) {
      if (state.taken >= state.maxUnits) continue;
      if (state.cost > remaining) continue;

      const position = state.taken % state.batch;
      const price = state.prices[position] ?? 0;
      const profitPerUnit = price - state.cost;
      if (profitPerUnit <= 0) continue;

      // Consecutive positions at the same price within this world batch. The
      // next batch resets to the higher first-unit price, so don't cross it.
      let block = 1;
      while (
        position + block < state.batch &&
        state.prices[position + block] === price &&
        state.taken + block < state.maxUnits
      ) {
        block += 1;
      }
      block = Math.min(block, state.maxUnits - state.taken);

      if (best === null) {
        best = { state, price, profitPerUnit, block };
        continue;
      }

      // profitPerUnit / cost vs best.profitPerUnit / best.cost, exactly.
      const lhs = profitPerUnit * best.state.cost;
      const rhs = best.profitPerUnit * state.cost;
      const better =
        lhs > rhs ||
        (lhs === rhs &&
          (profitPerUnit > best.profitPerUnit ||
            (profitPerUnit === best.profitPerUnit &&
              (state.cost < best.state.cost ||
                (state.cost === best.state.cost &&
                  state.index < best.state.index)))));
      if (better) {
        best = { state, price, profitPerUnit, block };
      }
    }

    if (best === null) break;

    const affordable = Math.floor(remaining / best.state.cost);
    const quantity = Math.min(best.block, affordable);
    if (quantity <= 0) break;

    const spend = quantity * best.state.cost;
    best.state.taken += quantity;
    best.state.totalCost += spend;
    best.state.profit += quantity * best.profitPerUnit;
    remaining -= spend;
  }

  const itemPlans: ShopSinkBasketItemPlan[] = items.map((item, index) => {
    const state = states.find((candidate) => candidate.index === index);
    if (state === undefined) {
      return {
        index,
        id: item.id,
        name: item.name,
        ...EMPTY_ITEM,
        cap: Math.max(0, Math.floor(item.purchaseCap4h)),
      };
    }
    const batchPlan = planShopSale(item.row, state.cost, {
      maxUnits: state.cap,
      startStock: item.row.baseStock,
    });
    return {
      index,
      id: item.id,
      name: item.name,
      units: state.taken,
      totalCost: state.totalCost,
      totalRevenue: state.totalCost + state.profit,
      profit: state.profit,
      unitCost: state.cost,
      avgShopPrice: state.taken > 0 ? (state.totalCost + state.profit) / state.taken : 0,
      unitsPerWorld: state.batch,
      costPerWorld: state.batch * state.cost,
      profitPerWorld: batchPlan.profit,
      firstUnitPrice: state.prices[0] ?? 0,
      lastUnitPrice: state.prices[state.batch - 1] ?? 0,
      cap: state.cap,
      priceLimited: batchPlan.stoppedAtMargin,
    };
  });

  const totalUnits = itemPlans.reduce((sum, item) => sum + item.units, 0);
  const totalCost = itemPlans.reduce((sum, item) => sum + item.totalCost, 0);
  const profit = itemPlans.reduce((sum, item) => sum + item.profit, 0);
  const leftover = Math.max(0, budgetGp - totalCost);

  const worlds = itemPlans.reduce(
    (max, item) =>
      item.units > 0 && item.unitsPerWorld > 0
        ? Math.max(max, Math.ceil(item.units / item.unitsPerWorld))
        : max,
    0,
  );

  const hasRemaining = states.some((state) => {
    if (state.taken >= state.maxUnits) return false;
    return (state.prices[state.taken % state.batch] ?? 0) - state.cost > 0;
  });
  const hasAffordable = states.some((state) => {
    if (state.taken >= state.maxUnits) return false;
    if (state.cost > remaining) return false;
    return (state.prices[state.taken % state.batch] ?? 0) - state.cost > 0;
  });
  const worldLimited = states.some(
    (state) => state.taken >= state.batch * maxWorlds && state.cap > state.taken,
  );

  const hopSecondsTotal = worlds * hopSeconds;
  const tripSeconds =
    options.geTiles === null
      ? null
      : roundTripSeconds(options.geTiles, secondsPerTile, handoverSeconds);
  const buySeconds = buyMakespan(itemPlans, offerSlots);
  const timeSeconds =
    totalUnits <= 0
      ? 0
      : Math.max(
          tripSeconds === null
            ? hopSecondsTotal
            : tripSeconds + hopSecondsTotal,
          buySeconds,
        );
  const timeKnown = tripSeconds !== null;

  let gpPerHour: number | null;
  if (totalUnits <= 0) {
    gpPerHour = 0;
  } else {
    gpPerHour =
      timeKnown && timeSeconds > 0 ? (profit * 3600) / timeSeconds : null;
  }

  return {
    items: itemPlans,
    units: totalUnits,
    totalCost,
    totalRevenue: totalCost + profit,
    profit,
    leftover,
    unitCost: totalUnits > 0 ? totalCost / totalUnits : 0,
    worlds,
    hopSecondsTotal,
    buySeconds,
    tripSeconds,
    timeSeconds,
    timeKnown,
    gpPerHour,
    offerSlots,
    budgetLimited: hasRemaining && !hasAffordable,
    worldLimited,
  };
}
