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

## 9. Buy limits and sale throughput

`/api/v2/osrs/mapping` returns `limit` — the GE 4-hour buy limit. It is the
maximum quantity of an item **one player** can buy in a 4-hour window.

Source: <https://oldschool.runescape.wiki/w/Grand_Exchange/Buying_limits> —
"The buying limit of Grand Exchange items is restricted to a certain quantity
every 4 hours."

That is a purchase cap, not a market-wide sell cap. When you sell, your offer is
filled by many buyers, each with their own limit. The constraint on sale
throughput is therefore the item's 24h traded volume on the matching side of the
book. `geBuyLimit` is reported in each opportunity for transparency, but it is
not part of the sellable-throughput calculation:

```text
volume4h       = floor(volume24h / 6)
sellablePer4h  = min(oneShopVisitUnits, volume4h)
worldsToFill4h = ceil(volume4h / oneShopVisitUnits)
```

The 24h volume is the guard against stale, illiquid GE prices. The buy limit is
still useful context — it tells you how much one buyer can take — but using it
as a sell cap made high-volume, low-margin items look artificially bad.

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

## 11. Multi-item shop baskets

A shop visit is not limited to one item: Lundail's Arena-side Rune Shop sells
cosmic, air, earth, fire, body and other runes, and one visit can buy from every
row. The single-item budget planner intentionally charges each item its own world
hops and bank loads. `src/domain/basket.ts` answers the other question — buy
every profitable item in the shop during the same visits — by sharing those
costs across the basket.

### 11.1 Shared world hops

Each world is assumed to be at full default stock for every item, so the shop's
price curves all restart together. A world is visited if it buys at least one
unit of anything, and the basket's world count is therefore **not** the sum of
the per-item world counts:

```text
worlds = number of visits in which the basket buys at least one unit
```

The planner fills a world with every affordable profitable unit first. If the
budget cannot clear a full world, it takes marginal units by profit per coin,
then hops again while the leftover can still buy a fresh world's first unit (up
to `maxWorlds`, default 200; the web UI exposes it as **Max worlds**). The single-item planner does not hop after its
final partial world; the basket planner does, because a fresh world resets the
cheapest unit price.

### 11.2 Shared bank loads

The inventory rule in §10 is unchanged, but the load is shared by the basket:

- a distinct **stackable item type** holds one slot for the whole trip;
- every **non-stackable unit** holds one slot;
- the coin stack holds one slot, so the base load is 27.

```text
stackableSlots   = number of distinct stackable item types actually bought
nonStackableUnits = sum of units whose stackability is not true
unitsPerLoad     = max(1, 27 - stackableSlots)
bankTrips        = nonStackableUnits <= unitsPerLoad
                     ? 0
                     : ceil(nonStackableUnits / unitsPerLoad) - 1
```

A stackable-only basket (for example all runes) never banks, so a shop with no
bank on its map still yields a computable gp/hour. If any non-stackable units
need a trip and `bankTiles` is `null`, the basket's `gpPerHour` is `null`.

### 11.3 Concurrent GE sell time

Each item has its own 4-hour sellable throughput (`cap`). Its fill time is:

```text
sellSeconds_i = units_i / cap_i * 4 * 3600
```

Different items trade in independent order books, so their offers can fill
concurrently up to the player's Grand Exchange slot count:

- members have **8** offer slots;
- free players have **3**.

Source: <https://oldschool.runescape.wiki/w/Grand_Exchange> — "Members get eight
Grand Exchange slots ... free players are limited to three."

The planner sorts fill times longest-first and assigns each to the least-loaded
slot (LPT scheduling); the makespan is `sellSeconds`. A basket that contains a
members-only item requires a members account and defaults to 8 slots. An
all-free-to-play basket defaults to the pessimistic 3 slots. This assumes offers
can be placed as slots free and ignores the time to walk to the GE and collect.

### 11.4 Budget allocation

The basket first asks whether the remaining gold covers every profitable unit in
a fresh world. If so, it buys the whole world: there is no allocation choice and
the result is exact under the per-world model.

If the gold is short, it takes the next marginal unit with the highest profit per
coin, expanding to the whole block of units that share a price. Each item's
marginal price rises as its stock falls, so this is the standard greedy for the
fractional budget knapsack. It is a documented heuristic, not a proof of integer
knapsack optimality; a deliberately uneven shop could leave a few gp of profit on
the table. Zero-margin units are never bought.

The basket is exposed in the UI by the **basket** button beside a shop, and in
the CLI:

```sh
pnpm report --shop="Lundail's Arena-side Rune Shop" --gold=100000
```

`tests/basket.test.ts` pins the shared-hop, shared-load, mixed-stackability,
unknown-bank, GE-slot and allocation behaviour.

## 12. GE → shop (buying on the GE, selling to a shop)

The same shop formula runs in reverse. This direction is exposed on the **GE →
shop** page and built by `pnpm sinks --write` into `data/shop-sinks.json`; the
pure planner is `src/domain/shopSink.ts` and the join is `src/engine/sinkRank.ts`.

### 12.1 Which mode is which

Mode names keep their player-facing meaning — the *worse* price is pessimistic:

- **pessimistic** = instant buy at GE `high` (guaranteed fill, worst price)
- **patient** = resting buy offer at GE `low` (better price, may never fill)

The volume side flips relative to §9, because we are now the buyer. An instant
buy is filled by sellers hitting the high side, so it uses `highVolume24h`; a
resting low offer is filled by instant sellers, so it uses `lowVolume24h`.
`src/engine/sinkRank.ts` maps both explicitly and deliberately does not reuse the
sell-side helpers in `src/domain/profit.ts`.

### 12.2 No tax

The 2% GE tax in §7 applies to **GE sales**. Buying on the GE is untaxed, and
selling to a shop is not a GE trade, so neither leg is taxed:

```text
profit = shopRevenue - units * geBuyPrice
```

### 12.3 The buy limit is a purchase cap here

Unlike the shop → GE direction (§9), we are the player doing the buying, so the
GE buy limit genuinely bounds the plan:

```text
purchaseCap4h = min(geBuyLimit ?? ∞, floor(volume24h / 6))
```

A missing buy limit is "no limit", not zero. The 4h volume slice still guards
against stale, illiquid prices.

### 12.4 Marginal sale, capped by an explicit quantity

`planShopSale` is the mirror of `planPurchase` (§3): it sells the k-th unit only
while the shop's next offer is **strictly greater** than the GE cost, incrementing
the shop's stock so the price falls, and never selling a zero-margin unit. The
10%-of-value floor (§4) means an overstocked shop's offer eventually stops
falling. That is why `planShopSale` requires a `maxUnits` bound: with a floor
price above the GE cost, an unbounded loop would never terminate. The bound is
the GE purchase cap above; §12.5 repeats that batch across worlds.

The shop's buy price at default stock is validated against the wiki's own
published `store_buy_price`: the formula matches every finite-stock row except a
1 gp rounding edge on a general-store row (excluded) and infinite-stock reward
shops (excluded by default).

### 12.5 Notes, world hops and trip time

GE purchases are collected as **banknotes**, so a non-stackable item still takes
one inventory slot for the whole quantity. There are no 27-unit loads and no
banking trips in this direction. What limits the plan is world hopping: shop
stock is per world, so each fresh world resets the shop to its default stock and
the same falling price curve can be sold again.

The marginal sale of §12.4 is therefore computed once for a fresh world and
repeated:

```text
unitsPerWorld = planShopSale(fresh world, maxUnits = purchaseCap4h).units
worlds        = ceil(units / unitsPerWorld)
units         = min(purchaseCap4h, unitsPerWorld * maxWorlds,
                    floor(budgetGp / geBuyPrice))
totalRevenue  = fullWorlds * revenuePerWorld + remainder revenue
```

`budgetGp` is the optional gold budget. **0 means no cap**, matching the
shop → GE page's "gold 0 = do not size" convention; a plan cut by gold is
marked `budgetLimited`. The browser pages share one `rscalc.budget` localStorage
value, so the same gold amount sizes both directions.

`maxWorlds` defaults to **200**, the same explicit ceiling as the shop → GE
budget planner (`DEFAULT_MAX_WORLDS`). It is an assumption, not a sourced world
count; the web UI exposes it as **Max worlds**, and `pnpm sinks --max-worlds=N`
changes it for a build. A row where it binds is marked `worldLimited` and
"world cap" in the UI. Without a ceiling the
GE buy limit can imply thousands of worlds, which is not a realisable plan.

Each unit sold lowers the shop's next offer by `value * delta / 1000` — the
stored `delta` is 10× the displayed percentage, so `delta = 20` is 2.0% of value
per unit, i.e. 4 gp on a 200 gp item. The row carries `deltaPct` and
`priceDropPerUnit` so this is auditable; it is exactly what caps
`unitsPerWorld`.

Time is one GE ↔ shop round trip plus one hop per world:

```text
tripSeconds  = 2 * geTiles * secondsPerTile + handoverSeconds
timeSeconds  = max(tripSeconds + worlds * hopSeconds,
                   units / purchaseCap4h * 4 * 3600)
gpPerHour    = profit * 3600 / timeSeconds
```

`hopSeconds` defaults to 10s (the shared `DEFAULT_HOP_SECONDS`); the UI exposes
it and the travel speed, and recomputes the rate from the row's own `geTiles`.
No banking time is charged. Where the wiki map gives no GE distance (another
map, or no coordinates), `geTiles` is `null` and `gpPerHour` is `null` — the
planner reports profit but never invents a trip.

`geTiles` is the shop's own straight-line distance to the Grand Exchange, sourced
from the wiki map with the same map rules as banks (§10.1): same `mapID` first,
a 40-tile cross-map fallback, and `mapID = -1` never treated as a shared map.
The origin is the Grand Exchange page's `{{Map}}` point (`3165, 3490`, mapID 0 at
the time of writing), fetched by `scripts/refresh-shops.ts`.

### 12.6 Only shops that publish a buy price count

The storeline table lists what a shop sells, so "listed" is not by itself proof
that the shop buys the item. The wiki publishes `store_buy_price` for rows the
shop actually buys at default stock, and writes `N/A` when it does not (Eblis's
ancient staff is the clear example: `{{StoreTableHead|hidebuy=y}}` plus
`buy=N/A`, while its `store_buy_multiplier` is still 1000). The engine therefore
requires a published, positive `store_buy_price`; the multiplier alone must never
be read as "yes".

Two consequences, both stated in the UI:

- **General stores are excluded** (`Category:General stores`). They buy almost
  anything, but their stock table only describes what they sell, so "buys
  anything" cannot be derived from this data. Exclusion is by the wiki category,
  never by shop name.
- A specialist shop buying a related item it does not stock is invisible here.
  Adding it would need a separate sourced list of what each shop buys.

The planner assumes each visited world's shop is at default stock on arrival.
Destock on a world you revisit is not modelled, so revisiting the same world is
optimistic. The `maxWorlds` ceiling in §12.5 is an explicit assumption, not a
sourced world count.

### 12.7 Multi-item baskets

A shop visit does not sell one item at a time. `src/domain/sinkBasket.ts` plans
every profitable item for one shop together, so the world hops and the single
GE ↔ shop trip are shared:

- **Batch per world.** Each item keeps its own `unitsPerWorld` from §12.5. A
  fresh world resets every item's stock, so each item's batch can be sold again
  on the next hop.
- **Shared worlds.** `worlds = max_i ceil(units_i / unitsPerWorld_i)`, not the
  sum over items: one world visit can sell a batch of every item.
- **Shared gold.** One budget is allocated by the next marginal unit's profit
  per coin, respecting each item's GE 4h purchase cap and the shared world
  ceiling. The greedy is explainable but not a proof of knapsack optimality;
  it also ranks by unit efficiency without charging the shared hop cost, so a
  unit that forces an extra world can look slightly better than it is.
- **One GE trip, no banking.** Items bought on the GE are noted, so the basket
  needs one GE ↔ shop round trip, plus `worlds × hopSeconds`. There are no
  27-unit loads and no bank trips.
- **Concurrent GE buys.** Each item's supply time is
  `units_i / purchaseCap4h_i × 4h`; offers fill in parallel across the player's
  GE slots (members 8, free 3), scheduled longest-first (LPT). Time is
  `max(trip + hops, buyMakespan)`. Unknown `geTiles` ⇒ `gpPerHour = null`.

The per-item table shows the batch, average shop price, spend and profit; the
summary shows the shared worlds, hop time, GE supply time and total time.

## 13. Overnight shop runs

The shop -> GE model sizes a run against the GE's **4-hour** window (§9), so a
run stops at what the market absorbs in four hours. `src/domain/overnight.ts`
answers the other question: *"I will shop for an hour and then leave the GE
offers resting — how much can I put up, and what is it worth?"*

It is an option on `#/shop-to-ge`, its basket panel and the shop-run rows of
`#/earn`; it is carried in the URL as `overnight=1&rest=<h>&session=<min>`. The
shop-dump and processing families are unaffected: they sell into the market you
are standing in, not into an offer you leave behind.

### 13.1 The rest window replaces the 4h slice

The unit cap is the same 24h traded volume, scaled to a window you choose
(default 12 hours) instead of 4:

```text
restUnits = floor(volume24h * restHours / 24)
```

Nothing is invented: this is `volume24h` from §9, and a thin market still caps
the run — an item that trades twice a day yields **one unit** in a 12h window
(`floor(2 * 12 / 24)`), where the 4h slice floors to zero. That is the coverage
the window buys: at the last refresh, 1,705 shop-run rows were priceable
overnight against 1,682 on the 4h window, and the difference is entirely items
the 4h floor excluded.

### 13.2 The session is your own time

Buying is bounded by a session (default 60 minutes, `0` = no limit): world hops
plus the bank trips the loads need (§10). A world visit that would overrun the
clock ends the plan, and a partial world is bought when it still fits. The plan
reports `buySeconds` (your time) and `sessionLimited`.

### 13.3 The fill is still charged

```text
sellSeconds = units / restUnits * restWindowSeconds
timeSeconds = max(buySeconds, sellSeconds)
```

The offers rest while you sleep, but they are not free time: **your capital is
committed until they fill**, and until then you cannot fund another run. Measuring
this against the real artifact settled the question:

| Wyrmscraig villager robe top | 4h window | 12h window, fill charged | 12h window, fill free |
|---|---|---|---|
| units | 0 (floored) | 1 | 1 |
| profit | — | 137,508 | 137,508 |
| time | — | 12h | 10s of shopping |
| gp/hour | — | **11,459** | **49,502,880** |

A free sell leg puts a 500 gp item that trades twice a day at the top of the
leaderboard, because the 24-hour figure is divided by ten seconds. Charging the
fill also has a property worth stating: for an item the market already absorbs in
4h, the longer window buys a **bigger plan at the same hourly rate** (three times
the units and the profit for three times the clock), which is what "stock up
overnight" means. It does not manufacture a higher rate. `tests/budget.test.ts`
pins that invariance.

### 13.4 Unlimited buyers (an assumption, not a source)

The checkbox beside the rest window, **Unlimited buyers**, switches the cap off
entirely: no 4h buy limit and no volume ceiling, so a run is bounded only by
gold, shop stock, worlds and the session, and no fill time is charged
(`sellSeconds = 0`, so `gp/hour` is the shopping time alone). The rest window is
disabled while it is on, because it can no longer bind.

Everything it does is an assumption and the UI says so, in the hint, the
caveats, and on the `#/earn` coverage:

- **It prices stale markets.** The 24h traded volume is the only guard against a
  GE price that is one old trade (§9). With the cap gone, items that have not
  traded in a day are priced at that quote.
- **The rate is a one-off.** Only the session bounds how much you buy, and the
  night can absorb it once. Charging the fill is what keeps the ordinary
  overnight rows repeatable; this switch deliberately gives that up, so its rows
  are comparable with each other, not with the rest of the leaderboard.

It exists because the player may know something the volume snapshot does not —
an item about to be consumed by an update, a market they are about to move — and
the alternative was to leave that out of the tool entirely.

The UI exposes **Overnight**, **Session** (minutes), **Rest window** (hours) and
**Unlimited buyers** in the budget card, swaps the *4h volume* column for *Rest
units* (or *Buyers*, reading ∞), adds a *GE fill* column, and states the
assumption in the caveats.

Tests: `tests/overnight.test.ts` (window scaling, clamps and the unlimited-buyer
cap), the overnight blocks in `tests/budget.test.ts` and `tests/basket.test.ts`,
and `tests/earnings.test.ts` for the leaderboard rows.
