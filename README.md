# rscalc

Shop → Grand Exchange profit calculator for Old School RuneScape.

Answers one question well: **if I buy this item from this shop and sell it on the
GE, what is the realistic profit, and what is it worth per hour?**

Works for all **593 shops** in the game, 3,595 priceable shop/item pairs.

```text
#  Item                Shop                     Buy     Sell    Tax   Margin  Qty   gp/4h
1  Limestone brick     Razmire Builders Merch…  115     189     3     71      1000  71,350
4  Bronze knife        Arcuani's Archery Supp…  5       33      0     28      2000  55,500
8  Raw herring         Frankie's Fishing Empo…  22      204     4     178     250   44,500
12 Banana              Solihib's Food Stall     11      51      1     39      1000  39,375
```

## Quick start

```sh
pnpm install
pnpm build:data     # fetch shop catalogue + GE prices  (~60s, no API key)
pnpm report         # ranked table in the terminal
pnpm dev            # web UI at http://localhost:5173
```

### Commands

| Command | What it does |
|---|---|
| `pnpm smoke` | connectivity + schema check against the prices API |
| `pnpm shops` | rebuild `data/shops.json` (24h cache) |
| `pnpm market` | rebuild `data/market.json` |
| `pnpm build:data` | both of the above |
| `pnpm report` | ranked CLI table |
| `pnpm report --mode=patient` | price against GE `high` instead of `low` |
| `pnpm report --shop="<name>" --gold=N` | one shop's multi-item basket |
| `pnpm report --write` | also emit `data/opportunities.json` for the UI |
| `pnpm dev` / `pnpm build` | web UI |
| `pnpm test` / `pnpm typecheck` | 155 tests / `tsc --noEmit` |

`pnpm report` flags: `--mode=pessimistic|patient`, `--limit=N`, `--members`,
`--min-volume4h=N`, `--min-margin=N`, `--infinite`, `--write`.
The basket flags are `--shop="<name>"`, `--gold=N`, `--hop=N` (seconds) and
`--speed=N` (seconds per tile); `--infinite` also applies to a basket.

## No API keys

Nothing here needs a key, a token, or an account. The OSRS Wiki prices API is
free and unauthenticated; it only asks for a descriptive `User-Agent`, which
`src/api/http.ts` sends on every request. See [docs/data-sources.md](docs/data-sources.md).

You may optionally set `RSCALC_CONTACT` to your own contact URL/email so the wiki
can reach you about your traffic.

## How it works

```text
Special:Bucket?bucket=storeline  ─┐
prices.runescape.wiki/api/v2     ─┴─► data/shops.json + data/market.json
                                              │
                                    src/engine/rank.ts
                                              │
                                    data/opportunities.json
                                              │
                              ┌───────────────┴───────────────┐
                        pnpm report                        web UI
```

The browser never makes a network call: it renders a static snapshot, so the
site is deployable as plain files.

## Budget mode (web UI)

Enter **Gold available** and the table re-sizes every opportunity to your
budget, answering "how many can I actually buy, and what's that worth per
hour?". Untick **Size buys to gold** to keep the per-shop-visit columns while
still seeing the hourly rate your gold would earn.

It accounts for four things a naive `budget / unitPrice` would miss:

1. **Prices rise as you buy.** It walks the same marginal shop curve as the CLI,
   so a budget buys fewer units than the first-unit price suggests.
2. **World hops cost time.** Each world is assumed to be at **full default
   stock**, so the price curve restarts every hop. `Worlds` is how many visits
   your budget needs, and hop time is user-configurable (default 10s).
3. **Non-stackable items must be banked — at that shop's own distance.** A
   backpack holds 28 items, and the coin stack you pay with takes one of those
   slots, so a load carries 27 non-stackable items. Every load after the first
   costs a trip to the nearest bank, and the distance is read per shop from the
   wiki map: Varrock General Store is ~32 tiles from its bank, while Razmire in
   Mort'ton is a much longer run. `Travel speed` (seconds per tile) converts
   distance to time. Stackable items (arrows, runes, …) never need a bank.
4. **Selling takes time too.** Time is the *slower* of buying (hops + banks) and
   selling. Buying 13,000 units in one shop visit does not mean you bank them in
   10 seconds if that quantity is a full 4 hours of GE volume. This is what stops
   the planner from reporting eight-figure gp/hour on a stale price.

Outputs per row: `Buy` (units your gold covers), `Spend`, `Worlds`, `Banks`
(trips, seconds per trip, and the bank used), `Profit`, and `gp / hour`. Untick
**Size buys to gold** (or set gold to 0) to show per-shop-visit quantities; the
`gp / hour` column still uses your current gold. The gold amount and chosen view
are saved in the browser's localStorage.

### Shop baskets — one visit, several items

A shop does not sell one item at a time. Lundail's Arena-side Rune Shop sells
cosmic, air, earth, fire, body and other runes, and one visit can buy them all.
Click **basket** beside a shop name to plan that visit as a whole:

- **World hops are shared.** The basket needs the number of visits that buy at
  least one unit, not the sum of each item's own hop count.
- **Bank loads are shared.** All non-stackable units fill the same 27-slot load,
  and each distinct stackable item type reserves one slot. A rune-only basket
  never banks, even in a shop with no bank on its map.
- **GE sell time is concurrent.** Each item has its own 4-hour fill time, and
  offers share the Grand Exchange slots (8 for members, 3 for free players).
- **Gold is allocated by profit per coin.** The basket takes the best marginal
  unit first; if your gold covers a full world, it buys every profitable unit in
  it and the result is exact under the model.

The panel shows the combined `Buy`, `Spend`, `Profit`, `Worlds`, `Banks`,
`gp / hour`, and a per-item breakdown. The main table still ranks items as if you
bought only that item; the basket is the combined plan. The same view is
available from the CLI:

```sh
pnpm report --shop="Lundail's Arena-side Rune Shop" --gold=100000
```

## Accuracy — read this before trusting a number

The maths is a direct port of the wiki's own `Module:Shop calculator`, and the
test suite pins it to three worked examples published by the wiki (including an
off-by-one that a naive implementation gets wrong). Beyond that, be aware:

- **Shop stock is per world.** `Qty` is what *one* shop visit yields. Filling a
  4-hour throughput may need many world hops (`worldsToFill4h`).
- **Restock timers are not modelled.** `restockTicks` is reported, but the
  calculator assumes you arrive at default stock.
- **Shop prices move as you buy.** Buying 50 units costs more than 50× the first
  unit. `Buy` is the *average* across the quantity taken, and the planner stops
  at the last unit that still clears the GE price.
- **"Patient" mode may not fill.** It prices against GE `high`, which requires
  your sell offer to actually be matched. "Pessimistic" prices against `low`
  (instant dump) and is the number to trust.
- **Thin-volume items are floored.** A 4h throughput of 0.33 units is reported
  as 0, not multiplied into a fake gp/4h figure.
- **Budget mode caps by liquidity.** Units are capped at the item's 24h traded
  volume, split into a 4h slice. The GE buy limit is a per-player purchase cap
  and is reported but not used as a sell cap. Without the volume cap the planner
  recommends buying illiquid items whose GE price is a stale trade from days
  ago, producing confidently absurd gp/hour numbers.
- **World hops are assumed ideal.** Every visited world is treated as full
  default stock. In practice shops are contested, and the first hop is charged
  even though you may already be standing at the shop.
- **A basket shares hops and bank loads.** The per-item table's `gp / hour`
  assumes you buy only that item; the basket panel buys every profitable item in
  the shop during the same visits, so its `gp / hour` is usually higher. A
  stackable-only basket can still report a number when the shop has no bank,
  because it never needs a bank trip.
- **Basket allocation is greedy.** If your gold cannot clear a full world, the
  planner takes the affordable marginal unit with the best profit per coin. This
  is the standard greedy for the fractional budget knapsack, not a proof of
  integer-knapsack optimality; an unusually uneven shop may leave a few gp of
  profit on the table. A budget that covers a full world buys every profitable
  unit, so the greedy is not used in the common case.
- **GE sell slots are a real constraint.** Sell time schedules each item's 4-hour
  fill across 8 slots for members and 3 for free players, longest first. More
  distinct items than slots means later offers wait. This assumes you can place
  and collect offers without travel time, and it does not model competition
  filling your offers more slowly.
- **Bank distances are per shop and per map.** They come from the wiki map as
  straight-line tiles, not a pathfound route, so corners and obstacles add time;
  the default walking speed (0.6s/tile) partly offsets that, and you can raise it.
  Shops with no bank on their map (underground or instanced areas) show `—` for
  gp/hour instead of inventing a trip. The 27-item load assumes you pay with
  coins carried in the backpack (28 slots minus the coin stack). Travel to the
  shop itself is still not modelled. Items whose wiki page does not state
  stackability are treated as non-stackable, which lowers gp/hour rather than
  inflating it.
- **Travel to the shop is not modelled**, only hop time, bank trips and GE
  sell time.
- **Illiquid items show stale GE prices.** If something trades twice a day, its
  `low` may be wildly out of date. Filter with `--min-volume4h`.
- **Not modelled:** travel to the shop, teleport costs, competition from other
  players, instance/quest access requirements, shop gold limits when *selling*
  to shops.

## Project layout

```text
src/api/       HTTP gateway (UA, 1 req/s, TTL cache, backoff) + typed clients
src/domain/   shopPrice.ts (game maths), tax.ts, profit.ts, budget.ts, basket.ts — pure, no I/O
src/engine/    rank.ts — joins catalogue × prices × volume
src/types.ts   zod schemas for every artifact
scripts/       refresh-shops, refresh-market, report, smoke
web/           Vite + React table
data/          generated JSON (committed so the UI builds offline)
docs/          shop-mechanics.md, data-sources.md, tooling-notes.md
```

`docs/shop-mechanics.md` documents every formula with citations, including the
two traps that are easy to get wrong (the overstocked branch is a *division*, and
the stored multipliers are 10× the displayed percentage). Read it before touching
`src/domain/shopPrice.ts`.

## Attribution

Item names, images and game data are © Jagex Ltd. This is an unofficial fan tool
with no affiliation. Wiki content is CC BY-SA. Price data courtesy of the
[Old School RuneScape Wiki](https://oldschool.runescape.wiki/w/RuneScape:Real-time_Prices).

This project only makes read-only HTTP requests to public wiki endpoints. It does
not interact with the game client in any way.
