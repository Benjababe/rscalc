# Shop mechanics — sourced reference

Everything in this document is verified against the OSRS Wiki's own renderer, not
guessed. This file is the single source of truth for `src/domain/shopPrice.ts`.

Sources:

- <https://oldschool.runescape.wiki/w/Shop> — "Stock" and "Pricing" sections
- <https://oldschool.runescape.wiki/w/Module:Shop_calculator> — the wiki's own
  reference implementation of every price formula below
- <https://oldschool.runescape.wiki/w/Module:StoreTableHead> — proves the unit
  scale of the multipliers and delta
- <https://oldschool.runescape.wiki/w/Module:StoreLine> — per-row price defaults
- <https://oldschool.runescape.wiki/w/Special:Bucket?bucket=storeline> — the
  machine-readable catalogue of every shop's stock table
- <https://oldschool.runescape.wiki/w/Tax> / <https://oldschool.runescape.wiki/w/Grand_Exchange> — GE tax

## 1. The five shop parameters

Each shop's stock table is declared as:

```
{{StoreTableHead|sellmultiplier=1000|buymultiplier=600|delta=20}}
{{StoreLine|name=Bronze pickaxe|stock=5|restock=100}}
```

`Module:StoreTableHead` renders the caption as:

```lua
string.format('Sells at: %.1f%% • Buys at: %.1f%% • Change per: %.1f%%',
              sellmultiplier/10, buymultiplier/10, delta/10)
```

**This is the critical unit fact:** the stored integers are *ten times* the
displayed percentage. They are effectively per-mille-with-a-factor-of-10. Verified
live — `Bob's Brilliant Axes.` has `sellmultiplier=1000, buymultiplier=600,
delta=20` and renders `Sells at: 100.0% • Buys at: 60.0% • Change per: 2.0%`.

Therefore, as fractions:

| symbol | source field | conversion | Bob's value |
|---|---|---|---|
| `S` — shop *sells* at (what you pay) | `store_sell_multiplier` | `/ 1000` | `1.00` |
| `B` — shop *buys* at (what you receive) | `store_buy_multiplier` | `/ 1000` | `0.60` |
| `D` — price change per stock unit | `store_delta` | `/ 1000` | `0.02` |
| `base` — default/max stock | `store_stock` | as-is | `3` |
| `restock` — restock interval | `restock_time` | ticks × `0.6` s | — |

Getting `D` wrong by 10× silently corrupts every single price in the calculator.
`tests/shopPrice.test.ts` pins Bob's steel axe against the worked example on the
wiki's `Shop` page specifically to catch this.

## 2. Truncation

The game truncates; it never rounds. The wiki module emulates Lua `math.modf`
with an epsilon guard:

```lua
local function truncate(num)
    local whole, decimal = math.modf(num + 0.000001)
    return whole
end
```

We replicate this exactly in `src/domain/shopPrice.ts` as `trunc()`, epsilon
included. Do not "clean it up" into `Math.floor` — floating-point values like
`0.1 * 3` would shift by 1 gp.

The one exception is the module's final `priceShopSellsAt` label, which is
`%.2f each`. Prices themselves are integers.

## 3. Buying from a shop (you pay)

From `Module:Shop calculator`, `buy()`. With `sd = base - current`:

| condition | unit price |
|---|---|
| `current > base` (overstocked) | `trunc(value / (sd*D + S))` ← **division** |
| `current == base` (equilibrium) | `trunc(value * S)` |
| `current < base` (understocked) | `trunc(value * (sd*D + S))` |

The overstocked branch is a **division, not a subtraction**. This is the single
easiest part of the whole model to get wrong, and it is why overstocked shops can
become extremely cheap rather than negative. Do not "simplify" it.

Bounds, applied in this exact order:

```lua
upperBound    = truncate(itemValue * (shopSellsAt + 5))   -- +500% of value
lowerBound    = truncate(itemValue * (shopSellsAt - 1))   -- -100% of value
lowererBound  = truncate(itemValue * .1)                  -- 10% of value
minimumBound  = 1

if num > upperBound   then upperBound
elseif num < 1        then 1
elseif num < lowererBound then lowererBound
elseif num < lowerBound   then lowerBound
else num
```

Note the ordering: the `lowererBound` (10% of value) check precedes the
`lowerBound` check, so the effective floor is the *tighter* of the two.

Each purchased unit decrements `current` by 1, so buying N units means summing N
**increasing** prices. Total cost is never `N * firstUnitPrice`.

Quantity rules (from `Shop` §Stock): purchases are available in batches of 1, 5,
10 and 50. Shops with infinite stock cap a single purchase at 10. You cannot buy
from a shop at 0 stock.

## 4. Selling to a shop (shop pays you)

From `Module:Shop calculator`, `sell()`. With `sd = current - base`:

| condition | unit price |
|---|---|
| `current < base` (understocked) | `trunc(value * (B + D*(base - current)))` |
| `current == base` (equilibrium) | `trunc(value * B)` |
| `current > base` (overstocked) | `trunc(value * (B - D*(current - base)))` |

Bounds:

```lua
upperBound = truncate(itemValue + (shopBuysAt * itemValue))
lowerBound = truncate(itemValue * .1)   -- shops always pay >= 10% of value
if num > upperBound  then upperBound
elseif num <= lowerBound then lowerBound
else num
```

Each unit sold increments `current`, so selling N units yields N **decreasing**
prices.

## 5. Restock

- Restock interval is stored in **game ticks**; `1 tick = 0.6 s`
  (`Module:StoreLine.ticktime`: `seconds = ticks % 100 * 0.6`).
- Only **one** item is re-added per restock cycle, except `Ore seller.` which
  restocks in batches.
- Items above the shop's default capacity ("overstock" from player sales) are
  slowly *removed* over time — the same timer acts as a "destock" timer.
- `Grum's Gold Exchange.` and similar have `base = 0`: they only ever exist at 0
  or above, so they function as sell-only shops. Ironmen cannot buy from them.
- Some shops are infinite-stock (`stock=inf`, stored as `∞`): `The Flaming Arrow`,
  `Farming Supplies`. Max 10 per purchase, no restock timer.

## 6. Stock is per-world and per-account-type

- Stock differs **per world**. World hopping is the core of real shop arbitrage.
- Stock is shared between *some* shops (e.g. buying at the Void Knight General
  Store decrements Jennifer's General Supplies).
- Ironman stock is separate from main-account stock, and further split between
  regular / group / ultimate ironmen.
- Shops selling a Cape of Accomplishment have a separate stock for players with
  the relevant 99, and a further split for the untrimmed variant.

**Consequence for the model:** the catalogue's `base` stock is the per-world
default. Total available supply across the game is roughly `base × worlds`, but
each world's price curve restarts at `base`. `src/domain/profit.ts` treats one
shop visit as one world's `base` stock, and reports `worldsOneInvariant`
separately rather than pretending stock is global.

## 7. Grand Exchange tax

- **2%** of the sale price.
- **Capped at 5,000,000 gp per item sold.**
- Items selling for **less than 50 gp are exempt** (0 tax).
- Rounded **down** to the nearest gp.
- Introduced 26 January 2022.

```
geTax(price) = price < 50 ? 0 : min(5_000_000, floor(price * 0.02))
```

Seller receives `price - geTax(price)`.

## 8. Which GE price is which

From the `prices.runescape.wiki` v2 docs and observed payloads:

- `high` — the most recent price an item was **purchased** at. This is the price
  you get from a *patient sell offer* (and what an instant buy costs you).
- `low` — the most recent price an item was **sold** at. This is what an *instant
  sell* yields.

Shop → GE is a **sell** operation, so:

- **pessimistic mode** = sell at `low` (instant dump, guaranteed fill)
- **patient mode** = sell at `high` (list and wait)

`profit.ts` computes both and labels them. Do not present a single "profit"
number without saying which mode it is.

## 9. Buy limits

`/api/v2/osrs/mapping` returns `limit` — the GE 4-hour buy limit. For shop
arbitrage the binding constraint on sale throughput is the item's **liquidity**
(24h volume), not its buy limit, but both are reported: `gp/4h` is capped by
`min(buyLimit, sellableUnits)`.
