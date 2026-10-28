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

## 10. Inventory space and banking

Sources:

- <https://oldschool.runescape.wiki/w/Inventory> — "A player's backpack inventory
  can hold up to 28 items, and any additional items must be stored in the
  player's bank."
- <https://oldschool.runescape.wiki/w/Stackable_items> — "Stackable items are
  items which only take up one space in a player's inventory."

This is the only part of the model where *time* depends on what the item is
rather than only on its price:

| item | slots per unit | banking between buys |
|---|---|---|
| stackable (arrows, runes, coins, …) | one slot for the whole stack | never |
| non-stackable (`stackable = No`) | 1 each | every load |
| stackability unknown | 1 each (conservative) | every load |

A load is **27**, not 28: coins stack but still occupy a slot, and shop purchases
are paid from the inventory, so the coin stack is not available for goods.
`src/domain/budget.ts` exposes this as `DEFAULT_UNITS_PER_LOAD`.

Bank trips for `N` non-stackable units, and the time they cost:

```text
bankTrips          = N <= 27 ? 0 : ceil(N / 27) - 1
bankSecondsPerTrip = 2 * bankTiles * secondsPerTile + handoverSeconds
timeSeconds        = max(worlds * hopSeconds + bankTrips * bankSecondsPerTrip,
                         sellSeconds)
```

The `- 1` is deliberate: the final inventory load is carried to the GE rather
than banked and re-bought. Trips are counted across the **whole plan**, not per
world, because hopping worlds does not empty your backpack.

### 10.1 Trip length is per shop, not global

A single trip time cannot be right for every shop: Varrock General Store is ~30
tiles from Varrock west bank, while Razmire Builders Merchants is a run across
Mort'ton. Each shop therefore carries two fields of its own:

- `bankTiles` — straight-line distance to the nearest bank on the same map.
- `nearestBank` — that bank's wiki page, so the number is auditable.

Sources for the join:

- <https://oldschool.runescape.wiki/w/Special:Bucket?bucket=map> — page centres as
  `{x,y,plane,mapID}` for pages that opted in with `bucket=yes`.
- <https://oldschool.runescape.wiki/w/Category:Banks> — the bank page list.
- Bank pages' `{{Map|...}}` infobox parameter — most banks do not opt into the
  bucket, so their coordinates are read from wikitext.
- <https://oldschool.runescape.wiki/w/Game_tick> — one tick is 0.6 s.
- <https://oldschool.runescape.wiki/w/Hazard_Prevention> — running moves 2 tiles
  per tick; walking moves 1.

Only banks sharing the shop's `mapID` are considered. That stops a Dwarven Mine
shop being priced against Keldagrim's bank ~398 tiles away on another map. When
a shop's map has no bank, a cross-map bank is accepted only within 40 tiles:
that catches shops on custom maps which share the surface coordinate space, but
rejects cross-world coincidences.

`secondsPerTile` defaults to 0.6 (walking; 0.3 is running) and the bank handover
defaults to 3 s. Both are explicit assumptions, while `bankTiles` is sourced.
The UI exposes travel speed only; it cannot change a shop's distance.

Straight-line distance is a **lower bound** on travel time: corners, doors and
obstacles make the real route longer. Raise `secondsPerTile` to compensate.

Where the wiki map gives no bank for a shop (no coordinates, or no bank on its
map), `bankTiles` is `null` and the budget planner reports `gpPerHour = null`
rather than inventing a trip. Those rows still show their per-4h throughput.

Stackability is read from the item infobox's `|stackable =` parameter; see
`docs/data-sources.md` §3.1. A page that does not state it, or whose item
variants disagree, is stored as `null` and charged as non-stackable — the
pessimistic direction for gp/hour.
