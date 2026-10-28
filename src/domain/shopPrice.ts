/**
 * The shop pricing model.
 *
 * This is a direct port of the OSRS Wiki's own reference implementation,
 * `Module:Shop calculator`, which is the only authoritative description of how
 * in-game shop prices move with stock. See `docs/shop-mechanics.md` for the
 * full sourced write-up and for the worked examples in `tests/shopPrice.test.ts`.
 *
 *   https://oldschool.runescape.wiki/w/Module:Shop_calculator
 *   https://oldschool.runescape.wiki/w/Shop#Pricing
 *
 * Two things here look wrong and are not:
 *
 *  1. The **overstocked** branch divides instead of subtracting. `value / (sd*D + S)`
 *     is what makes overstocked shops collapse in price rather than go negative.
 *  2. Bounds are applied in a specific order, and the 10%-of-value floor is
 *     checked *before* the `S - 1` floor. Ported verbatim.
 */

/**
 * Lua's `math.modf(num + 0.000001)` — truncation toward zero with an epsilon
 * guard against binary floating point. The epsilon is load-bearing: without it
 * `0.1 * 3` style inputs land 1 gp low. Do not "clean this up".
 */
export function trunc(num: number): number {
  const shifted = num + 0.000001;
  return shifted < 0 ? Math.ceil(shifted) : Math.floor(shifted);
}

/** Purchase batch sizes offered by the shop interface. */
export const BUY_SIZES = [1, 5, 10, 50] as const;
/** Maximum items per purchase at an infinite-stock shop. */
export const INFINITE_STOCK_PURCHASE_CAP = 10;

/**
 * One row of a shop's stock table, in the units the wiki stores.
 * Do not pre-convert to fractions at the call site; that conversion happens
 * internally so the ×10 unit trap in `docs/shop-mechanics.md` §1 can only be
 * made in one place.
 */
export interface ShopRow {
  /** The item's base `value` (from GE `/mapping`), i.e. 100% reference price. */
  itemValue: number;
  /** `store_sell_multiplier` — 1000 means the shop sells at 100% of value. */
  sellMultiplier: number;
  /** `store_buy_multiplier` — 600 means the shop buys at 60% of value. */
  buyMultiplier: number;
  /** `store_delta` — 20 means 2.0% of value per stock unit. */
  delta: number;
  /** `store_stock` — the shop's default/maximum stock. */
  baseStock: number;
  /** Infinite-stock shops (e.g. The Flaming Arrow) never move off base price. */
  infiniteStock?: boolean;
}

/** Normalised fractions derived from a `ShopRow`. */
export interface ShopFractions {
  value: number;
  /** Shop sells at (what you pay), as a fraction of value. */
  sellsAt: number;
  /** Shop buys at (what you receive), as a fraction of value. */
  buysAt: number;
  /** Price change per stock unit, as a fraction of value. */
  delta: number;
}

export function toFractions(row: ShopRow): ShopFractions {
  return {
    value: row.itemValue,
    sellsAt: row.sellMultiplier / 1000,
    buysAt: row.buyMultiplier / 1000,
    delta: row.delta / 1000,
  };
}

// ---------------------------------------------------------------------------
// Buying from a shop (you pay)
// ---------------------------------------------------------------------------

/**
 * Price of a single unit bought from a shop at a given current stock.
 * Port of `buy()`'s inner price computation.
 */
export function shopUnitBuyPrice(row: ShopRow, currentStock: number): number {
  const { value, sellsAt, delta } = toFractions(row);

  const upperBound = trunc(value * (sellsAt + 5));
  const lowerBound = trunc(value * (sellsAt - 1));
  const lowererBound = trunc(value * 0.1);
  const minimumBound = 1;

  if (row.infiniteStock) {
    return applyBuyBounds(trunc(value * sellsAt), {
      upperBound,
      lowerBound,
      lowererBound,
      minimumBound,
    });
  }

  if (currentStock <= 0) return 0;

  const stockDelta = row.baseStock - currentStock;
  let raw: number;
  if (currentStock > row.baseStock) {
    // Overstocked: DIVISION, and the delta is measured downward from
    // equilibrium, i.e. `current - base` (positive). Using `base - current`
    // here yields a negative delta and silently produces the *understocked*
    // price instead.
    const overstockDelta = currentStock - row.baseStock;
    raw = trunc(value / (overstockDelta * delta + sellsAt));
  } else if (currentStock === row.baseStock) {
    raw = trunc(value * sellsAt);
  } else {
    raw = trunc(value * (stockDelta * delta + sellsAt));
  }

  return applyBuyBounds(raw, { upperBound, lowerBound, lowererBound, minimumBound });
}

interface BuyBounds {
  upperBound: number;
  lowerBound: number;
  lowererBound: number;
  minimumBound: number;
}

/** Verbatim port of the module's `applyBounds` for the buying branch. */
function applyBuyBounds(
  num: number,
  { upperBound, lowerBound, lowererBound, minimumBound }: BuyBounds,
): number {
  if (num > upperBound) return upperBound;
  if (num < minimumBound) return minimumBound;
  if (num < lowererBound) return lowererBound;
  if (num < lowerBound) return lowerBound;
  return num;
}

/**
 * Total cost of buying `quantity` units starting from `startStock`.
 * Each purchase decrements the stock, so unit prices strictly increase.
 * Total cost is never `quantity * firstUnitPrice`.
 */
export function buyTotalCost(row: ShopRow, quantity: number, startStock: number): number {
  if (quantity <= 0) return 0;
  if (row.infiniteStock) {
    const cap = Math.min(quantity, INFINITE_STOCK_PURCHASE_CAP);
    return cap * shopUnitBuyPrice(row, startStock);
  }

  const affordable = Math.min(quantity, Math.max(0, startStock));
  let total = 0;
  let stock = startStock;
  for (let i = 0; i < affordable; i += 1) {
    total += shopUnitBuyPrice(row, stock);
    stock -= 1;
  }
  return total;
}

// ---------------------------------------------------------------------------
// Selling to a shop (shop pays you)
// ---------------------------------------------------------------------------

/** Price a shop pays for a single unit at a given current stock. */
export function shopUnitSellPrice(row: ShopRow, currentStock: number): number {
  const { value, buysAt, delta } = toFractions(row);

  const upperBound = trunc(value + buysAt * value);
  const lowerBound = trunc(value * 0.1);

  const applyBounds = (num: number): number => {
    if (num > upperBound) return upperBound;
    if (num <= lowerBound) return lowerBound;
    return num;
  };

  if (row.infiniteStock) {
    return applyBounds(trunc(value * buysAt));
  }

  if (currentStock < row.baseStock) {
    return applyBounds(trunc(value * (buysAt + delta * (row.baseStock - currentStock))));
  }
  if (currentStock === row.baseStock) {
    return applyBounds(trunc(value * buysAt));
  }
  return applyBounds(trunc(value * (buysAt - delta * (currentStock - row.baseStock))));
}

/**
 * Total revenue from selling `quantity` units starting from `startStock`.
 * Each sale increments the stock, so unit prices strictly decrease and the
 * shop's 10%-of-value floor eventually binds.
 */
export function sellTotalRevenue(
  row: ShopRow,
  quantity: number,
  startStock: number,
): number {
  if (quantity <= 0) return 0;
  if (row.infiniteStock) return quantity * shopUnitSellPrice(row, startStock);

  let total = 0;
  let stock = startStock;
  for (let i = 0; i < quantity; i += 1) {
    total += shopUnitSellPrice(row, stock);
    stock += 1;
  }
  return total;
}

// ---------------------------------------------------------------------------
// Optimal purchase planning
// ---------------------------------------------------------------------------

export interface PurchasePlan {
  /** Units worth buying. */
  units: number;
  /** Coins leaving your inventory. */
  totalCost: number;
  /** Coins received after GE tax, if all units sell at `netSellPerUnit`. */
  totalRevenue: number;
  profit: number;
  /** Cost of the marginal (last) unit bought. */
  lastUnitCost: number;
  /** True when we stopped because the next unit would be unprofitable. */
  stoppedAtMargin: boolean;
}

/**
 * How many units of one shop row are worth buying, given a fixed net sell price.
 *
 * Because the shop's price rises with every unit you take, the correct rule is
 * marginal: keep buying while the next unit's price is still <= the net sale
 * price. Aggregating with an average price would overstate the quantity.
 */
export function planPurchase(
  row: ShopRow,
  netSellPerUnit: number,
  options: { startStock?: number; maxUnits?: number } = {},
): PurchasePlan {
  const startStock = options.startStock ?? row.baseStock;
  const hardCap = row.infiniteStock
    ? Math.min(options.maxUnits ?? INFINITE_STOCK_PURCHASE_CAP, INFINITE_STOCK_PURCHASE_CAP)
    : Math.max(0, startStock);
  const maxUnits = Math.min(options.maxUnits ?? hardCap, hardCap);

  if (netSellPerUnit <= 0 || maxUnits <= 0) {
    return {
      units: 0,
      totalCost: 0,
      totalRevenue: 0,
      profit: 0,
      lastUnitCost: 0,
      stoppedAtMargin: maxUnits > 0,
    };
  }

  let units = 0;
  let totalCost = 0;
  let lastUnitCost = 0;
  let stock = startStock;

  for (let i = 0; i < maxUnits; i += 1) {
    const unitCost = shopUnitBuyPrice(row, stock);
    if (unitCost > netSellPerUnit) break;
    units += 1;
    totalCost += unitCost;
    lastUnitCost = unitCost;
    if (!row.infiniteStock) stock -= 1;
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
