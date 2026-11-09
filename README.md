# rscalc

A gp-earning calculator for Old School RuneScape.

One question, answered from sourced data: **at the gold I actually have, what
earns the most gp per hour, what does it cost up front, and how long does a run
take?**

Four families are modelled, each from its own wiki-sourced data and all priced
by the same pure planners:

- **shop runs** — buy stock from an NPC shop and sell it on the GE;
- **sell to shop** — buy on the GE and sell it to an NPC shop;
- **processing** — buy inputs on the GE, transform them with a deterministic
  recipe and sell the output;
- **skilling** — for a given skill, every priced activity: a make, a gather,
  an expected-value loot table, or the cost of training.

The front page puts all four in **one leaderboard**, so the comparison the
player actually wants ("what should I do with 5m gp?") is not spread across
four tabs. The tabs are the detail pages behind each row.

```text
EARN GP at 1,000,000 gp  [every row sized to that gold]
#  Method          Type        gp / hour   Capital    Profit      Time    Needs
1  Astral rune     Shop run     5,494,360     999,991   1,098,872   12m 00s Lunar Diplomacy
2  Cosmic rune     Shop run     4,418,020     999,991     883,604   12m 00s Song of the Elves
3  Blood rune      Processing   1,956,000      48,000   7,824,000   4h 00m  Runecraft 77
4  Wrath rune      Processing   1,800,000      48,000   7,200,000   4h 00m  Runecraft 95
5  Ring of recoil  Processing   1,596,000     999,635   1,753,206   1h 05m  Magic 7
6  Jaguar fur      Shop run     1,582,790      38,600   1,314,200   49m 49s —
```

Works for all **599 shops** in the game. At the last build: **2,121 priceable
shop → GE pairs** and **744 GE → shop flips** (each priceable in at least one
of the two price modes), **398 instant / 645 patient processing recipes**, and
**2,173 / 2,159 skilling activities across 19 skills** — together **2,530
methods ranked at 1,000,000 gp** (3,052 in patient mode), with the rest
counted and explained rather than filled in.

```text
SHOP -> GE
#  Item                Shop                     Buy     Sell    Tax   Margin  Qty   gp/4h
1  Limestone brick     Razmire Builders Merch…  115     189     3     71      1000  71,350
4  Bronze knife        Arcuani's Archery Supp…  5       33      0     28      2000  55,500
8  Raw herring         Frankie's Fishing Empo…  22      204     4     178     250   44,500
12 Banana              Solihib's Food Stall     11      51      1     39      1000  39,375

GE -> SHOP
#  Item                Shop                     GE buy  Shop pays   Qty   Batch Wrlds Spend      Profit    gp/hour
1  Ruby necklace       Grum's Gold Exchan…   911     1,522→913   3000  15    200*  2,733,000  920,200   1,380,300

PROCESSING (patient)
#  Output    Inputs              Skill        Profit/act  Actions/4h  Actions/hour  gp/hour
1  Avantoe   Grimy avantoe        Herblore 48  156         13,000      48,000        507,000
```

## Quick start

```sh
pnpm install
pnpm refresh        # catalogue + access + GE prices + all four UI rankings
pnpm report         # ranked table in the terminal
pnpm serve          # server: UI + served data + 4-hourly refresh on :8080
```

`pnpm serve` needs `RSCALC_CONTACT` (the wiki User-Agent contact) and, on a fresh
checkout, `pnpm build` for the UI bundle. Put local settings in a gitignored
`.env` at the repo root — it is loaded automatically, and the real environment
wins over it:

```sh
printf 'RSCALC_CONTACT=me@example.com
' > .env
```
It serves the last committed dataset
immediately and refreshes on its own schedule; see `deploy/README.md` for every
setting, the systemd unit and the Docker image.

For UI work: `RSCALC_REFRESH=off RSCALC_CONTACT=x pnpm serve` in one terminal and
`pnpm dev` in another — Vite proxies `/api` to the server.

Every script also runs under **npm**: `npm start` (the server), `npm run refresh`,
`npm run build`, `npm run report`. Composed scripts (`refresh`, `build:data`) are
written as `npm run <task>` chains so either manager can drive them, and npm needs
`--` before flags: `npm run report -- --write` where pnpm accepts
`pnpm report --write`. Installs remain pnpm-only: `pnpm-lock.yaml` is the lockfile
of record, so a stray `package-lock.json` is gitignored rather than half-supported.

### Commands

| Command | What it does |
|---|---|
| `pnpm smoke` | connectivity + schema check against the prices API |
| `pnpm shops` | rebuild `data/shops.json` (24h cache) |
| `pnpm market` | rebuild `data/market.json` |
| `pnpm run access` | rebuild `data/shop-access.json` from the curated rules |
| `pnpm build:data` | shops + market |
| `pnpm refresh` | all data: catalogue + access + market + all four UI rankings |
| `pnpm report` | ranked CLI table |
| `pnpm report --mode=patient` | price against GE `high` instead of `low` |
| `pnpm report --shop="<name>" --gold=N` | one shop's multi-item basket |
| `pnpm report --write` | emit `data/opportunities.json` for the UI |
| `pnpm sinks` | GE → shop ranking in the terminal |
| `pnpm sinks --write` | emit `data/shop-sinks.json` for the UI |
| `pnpm process` | processing ranking + `data/process.json` |
| `pnpm skilling` | skilling activities (losses included) + `data/skilling.json` |
| `pnpm serve` / `npm start` | server: SPA + dataset API + 4-hourly refresh |
| `npm run <task>` | any task above, for npm users (`npm run refresh`) |
| `pnpm dev` / `pnpm build` | web UI (dev server proxies `/api` to `pnpm serve`) |
| `pnpm test` / `pnpm typecheck` | unit, render and server tests / `tsc --noEmit` |
| `pnpm lint` / `pnpm lint:fix` | ESLint, type-aware; `--fix` applies safe autofixes |

`pnpm report` flags: `--mode=pessimistic|patient`, `--limit=N`, `--members`,
`--min-volume4h=N`, `--min-margin=N`, `--infinite`, `--write`.
The basket flags are `--shop="<name>"`, `--gold=N`, `--hop=N` (seconds) and
`--speed=N` (seconds per tile); `--infinite` also applies to a basket.

`pnpm sinks` flags: `--mode=pessimistic|patient`, `--limit=N`, `--members`,
`--min-profit=N`, `--min-volume4h=N`, `--speed=N`, `--infinite`,
`--include-general-stores`, `--write`. It reads the two data artifacts and makes
no network calls.

`pnpm process` flags: `--mode=pessimistic|patient`, `--limit=N`, `--members`,
`--skill=herblore` (comma-separated), `--min-profit=N` and
`--actions-per-hour=N` (a slower-play cap; 0/omitted uses each recipe's rate).
It fetches the wiki recipe bucket and the prices API, and always writes both
modes to `data/process.json`; the flags only shape the terminal table.

`pnpm skilling` flags: `--skill=crafting` (comma-separated, for the terminal
table), `--cooking-level=N` (only foods safe at that level),
`--actions-per-hour=N` and `--limit=N`. It fetches the recipe bucket, the wiki
node and loot sources and the prices API, and always writes both modes for every
scanned skill to `data/skilling.json`; the flags only shape the terminal table.

To refresh everything — catalogue, access table, market, both shop rankings, the
processing artifact and the skilling artifact — in one go:

```sh
pnpm refresh
```

## No API keys

Nothing here needs a key, a token, or an account. The OSRS Wiki prices API is
free and unauthenticated; it only asks for a descriptive `User-Agent`, which
`src/api/http.ts` sends on every request. See [docs/data-sources.md](docs/data-sources.md).

You may optionally set `RSCALC_CONTACT` to your own contact URL/email so the wiki
can reach you about your traffic.

## How it works

```text
Special:Bucket?bucket=storeline  ─┐
Special:Bucket?bucket=recipe     ─┤
prices.runescape.wiki/api/v2     ─┴─►       catalogue + GE quotes
                                                       │
                ┌─────────────────────────┬────────────┼────────────┬─────────────────────────┐
       src/engine/rank.ts      src/engine/sinkRank.ts   src/engine/processRank.ts  src/engine/skilling.ts
                │                         │            │            │                         │
     data/opportunities.json    data/shop-sinks.json   │    data/process.json        data/skilling.json
                │                         │            │            │                         │
                └─────────────────────────┬────────────┼────────────┬─────────────────────────┘
                                                       │
                                            src/domain/earnings.ts  ← one gp/hour leaderboard
                                                       │
   pnpm report / pnpm sinks / pnpm process / pnpm skilling   →  pnpm serve  →  web UI (5 pages)
```

`pnpm serve` publishes those artifacts as a dataset and serves them, so the
browser fetches current numbers and never calls an external API. A refresh needs
no rebuild: the running server re-runs the pipeline every four hours (or on
`POST /api/refresh`) and swaps the served dataset atomically, while the SPA
bundle stays code-only (about 340 kB, 80 kB gzipped). The **Earn gp** page joins
all four artifacts in the browser through `src/domain/earnings.ts`, so the
leaderboard is always computed by the same planners as the detail pages and
cannot drift from them. Each page module is code-split and loads only the
artifacts it needs; the leaderboard is the only page that needs all of them.
Price and build timestamps are rendered in your local timezone, with the source
date-time in the hover tooltip. Each detail table
has a **Columns** menu for hiding columns you do not need; the choice is
remembered per table in this browser.

## Earn gp — the leaderboard (web UI)

The front page (`#/earn`, and the default when you open the site). Every row is a
method you can actually execute, re-planned at your own gold:

- **gp / hour** — profit divided by the time the plan takes, using the same time
  model as that method's detail page. This is the ranking.
- **Capital** — the coins the plan ties up (shop stock, GE purchases, or inputs
  plus fees). Not a suggested bank; the money you need on hand to run it.
- **Profit** — what the plan returns after costs, including the GE tax where one
  applies (a GE sale, never a shop sale).
- **Time** — how long the plan takes: world hops and bank trips against the GE's
  own throughput for a shop run; one GE round trip plus hops against the GE's
  supply for a sell-to-shop flip; the recipe's published action rate against a
  4h market window for processing; the published attempt interval for skilling.
- **Needs** — the wiki-cited access requirement for a shop, or the skill levels
  for a recipe or skilling row (and, for a cooking row, the no-burn level).
  Levels are shown, never enforced: this is not a read of your account.

The **method filter** narrows the list to shop runs, sell-to-shop flips,
processing or skilling; **Members only** and **Hide locked** behave exactly as
on the detail pages. Clicking a method opens its detail page with the same
price mode and the item already searched.

Rows that cannot be numbered are excluded **and reported**: a shop with no bank
on its map that needs banking, a flip whose shop has no map distance to the GE,
a recipe with no published tick time and a skilling activity with no published
rate are counted under the table. Nothing is
estimated to fill the gap, and at a given gold the page also says how many
methods that gold cannot fund.

The leaderboard compares four different models of time. It is a fair comparison
of *this repo's* modelled methods, not a claim about every way to make gp: bossing
and other combat methods are out of scope.

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

## GE → shop (web UI + CLI)

Use the **GE → shop** tab (or `#/ge-to-shop`) to answer the reverse question:
which items are cheaper on the Grand Exchange than a shop will pay for them?
No GE tax applies on either leg, and the GE buy limit is a real purchase cap
here, because you are the one buying.

```sh
pnpm sinks                        # top 25, instant buy at the GE high
pnpm sinks --mode=patient         # resting buy offers at the GE low
pnpm sinks --write                # emit data/shop-sinks.json for the UI
```

The table shows the GE buy price, what the shop pays (first → last of one
world's batch, falling as it fills), the batch one world absorbs, the total
quantity across worlds, worlds, spend, profit, the GE trip and gp/hour. Items
are collected from the GE as **banknotes**, so the whole purchase fits one
inventory slot: there is no 27-unit load split and no banking. Each fresh world
resets the shop's stock, so the same falling price curve can be sold again after
a hop; `Qty` totals those worlds and `Worlds` is the hop count. The plan is
capped at your **Max worlds** setting (default **200**, the same ceiling as the
shop → GE planner); change it in the UI or with `--max-worlds=N`. `gp / hour` is the slower of one GE↔shop trip plus the
hops, and the GE supplying the units. A shop on another map shows `—` rather
than a made-up trip.

The **Gold available** field sizes every plan:
`units = min(GE 4h supply, max worlds × batch, gold / GE buy price)`. A row cut
by gold is marked **budget**, and clearing the field to 0 shows the uncapped
plan. It is the **same localStorage value** as the shop → GE page, so the two
directions share one gold amount.

Click **basket** beside a shop name to plan every profitable item for that shop
together. The basket shares the world hops and the single GE↔shop trip, and
allocates one gold budget across the items by marginal profit per coin. Its
per-item table shows each batch, average shop price, spend and profit; GE buy
offers are scheduled across the 8 member / 3 free offer slots. The basket is
the combined plan, while the main table still ranks items one at a time.

### Shop access

A **locked** badge beside a shop means the wiki-backed access table lists a
requirement; hover or open the badge for the requirement and its source.
**Hide locked** removes those shops from both the Shop → GE and GE → shop
tables. A shop with no badge has **unknown** access, not guaranteed access, and
the filter is not a check of your account's quests or levels. The table is
curated and cited in [docs/shop-access.md](docs/shop-access.md); regenerate it
with `pnpm run access`. Use the `run` prefix: bare `pnpm access` is pnpm's
built-in package-access command.

What this page deliberately does **not** claim:

- **General stores are excluded.** They buy almost anything, but the wiki's
  stock table only describes what they sell, so "buys anything" cannot be
  derived from the data. Exclusion is by `Category:General stores`, not by name.
- **Only items with a published shop buy price count.** The wiki writes `N/A`
  when a shop does not buy an item (Eblis's ancient staff is the standard trap),
  even though the buy multiplier can still be non-zero.
- Only items in a shop's stock table are considered. A specialist shop buying a
  related item it does not stock is invisible; that would need a separate
  sourced list.

The shop is assumed to be at default stock on each world, so the same batch is
repeated across hops. Destocking between visits to the same world, restock
timers and teleports are not modelled. The 200-world ceiling is an explicit
assumption, not a sourced world count; a row marked **world cap** could sell
more if you raised **Max worlds**.

## Item processing (web UI + CLI)

Use the **Processing** tab (or `#/processing`) to answer: buy an item on the GE,
transform it with a deterministic recipe, and sell the result back to the GE —
what is the net profit per action, and how much can the market absorb in 4h?

Recipes come from the wiki's structured `Special:Bucket?bucket=recipe` table
(written by `Template:Recipe`), not from a hand-typed list. Every material and
the output must have a GE price. **Cooking and chance/average recipes are
excluded**, because their yield depends on level or luck.

```sh
pnpm process                      # both modes -> data/process.json
pnpm process --mode=patient --limit=50
pnpm process --members --skill=herblore
pnpm process --min-profit=100
```

The two modes are:

- **Instant** — buy inputs at the GE `high`, sell the output at the GE `low`.
- **Patient** — rest a buy at the GE `low`, rest a sell at the GE `high`.

Per action the page shows the input cost plus any Coin fee, the output value
after the 2% GE tax, the profit and the margin. The **Inputs** cell shows each
material's unit price and subtotal, and hovering **Cost / action** gives the
same breakdown plus the fee and total. The 4h plan is capped by the input's GE
buy limit and 24h volume, the output's 24h volume (never its buy limit), the
recipe's published ticks and your gold. **Banking and travel to the facility
are not modelled**, so gp/hour is a processing-only ceiling.

The flagship example is cleaning grimy herbs. In patient mode at the last build,
grimy avantoe at 1,118 and clean avantoe at 1,300 (1,274 after 26 tax) is 156 gp
per action; the 13,000 buy-limit cap makes that 2,028,000 gp per 4h, or 507,000
gp/hour. The table shows the recipe's raw **48,000 actions/hour**; the cell
note shows the effective **3,250/hour** plan after the 13,000-per-4h buy-limit
cap. The same snapshot is a loss in instant mode, which is why both modes are
shown.

The **Actions / hour cap** field models inefficient play: it caps every
recipe's published action rate (0 uses the wiki rate) and can only slow a
recipe down, never speed it up. The **Actions / hour** column shows the rate
actually used; the cell note shows the lower effective plan rate after GE and
gold caps.

The gold field is the **same localStorage value** as the other pages. The full
method, deterministic-only filter, exclusions and worked example are in
[docs/processing.md](docs/processing.md).

## Skilling (web UI + CLI)

Use the **Skilling** tab (or `#/skilling`) to answer the per-skill question:
**for this skill, what can I actually do, and does it earn me gp or cost me gp?**
It opens in instant mode, like the other pages.

```sh
pnpm skilling                        # all scanned skills, both modes -> data/skilling.json
pnpm skilling --skill=crafting --limit=30 --actions-per-hour=1200
pnpm skilling --skill=cooking --cooking-level=90   # only foods safe at 90
```

Unlike the processing page, the profit floor is **off**: the artifact carries
the loss-making side too, so training cost is a result, not a filter. Every row
is priced GE buy → GE sell and shows its per-action profit in its own column —
the one number that does not depend on a rate at all.

- **Kind badges:** `Make` (a deterministic recipe), `Upgrade` (a finished item
  re-made into a better version of itself), `Cost` (an output that cannot be
  sold, priced as the cost of one action), `Gather` (one node per published
  respawn) and `EV` (a published loot table or success chart priced at its
  expectation, with the distribution carried alongside so the mean is
  auditable).
- **Time:** a published attempt interval gives gp/hour; a row with none keeps
  `—` and ranks by per-action profit. The **Actions / hour** input fills only
  the missing rates, marks the result *your rate*, and never overrides a
  published one — the artifact itself never carries a player rate.
- **Cooking is gated, not guessed:** a cooked food carries its published
  no-burn level and stays hidden until the entered **Cooking level** reaches
  it, because a hidden gamble cannot be ranked.
- **The Blast Furnace** is the one minigame that publishes both halves — a
  throughput per bar and the coffer fee — and is priced as an overlay on its
  bucket recipes: the published bars/hour replaces the tick count and the fee
  is charged per bar as `ceil(72,000 / rate)` gp.
- The **Gold available** field is the **same localStorage value** as the other
  pages, and the per-skill **coverage line** states what was priced,
  profitable, loss-making, cost-only, unknown-rate and unpriced — the unpriced
  remainder is counted, never estimated.

The full method, the scan queue and every refusal — each with the published
number it would need — are in [docs/skilling-plan.md](docs/skilling-plan.md).

What this page deliberately does **not** claim: it prices **GE buy → GE sell
only** — no high-alch and no shop-sale channel — so a losing row is a number
for that channel, not a verdict on the item; banking and facility travel are
charged only where the wiki pins a location (a stall); and a rate marked
*your rate* is presentation arithmetic, never part of the artifact.

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
- **GE → shop: no tax, and the buy limit really binds.** Buying on the GE is
  untaxed and a shop sale is not a GE trade, so neither leg pays the 2% tax. In
  this direction you are the buyer, so `min(GE buy limit, 24h volume/6)` caps the
  total quantity per 4-hour window. `Qty` is the total across worlds, `Batch` is
  one fresh world, and the plan stops at `min(GE cap, max worlds × batch)`.
- **GE → shop: "the shop buys it" is sourced, not inferred.** A row is only
  included when the wiki publishes a positive `store_buy_price`. The multiplier
  alone is not enough: Eblis's ancient staff lists a 100% buy multiplier but
  `buy=N/A` (`hidebuy=y`), and the shop refuses the item. General stores are
  excluded by `Category:General stores`; only items a shop stocks are visible,
  so a specialist buying an unlisted related item is a known gap.
- **GE → shop: noted items, fresh worlds.** GE purchases are collected as
  banknotes, so there is no banking time: one GE↔shop trip plus one hop per
  world. Each world resets the shop's stock, so the marginal batch (driven by
  the shop's `delta` price drop per unit) is repeated. **Gold available** caps
  the total at `floor(gold / GE price)`; it is the same localStorage value as the
  shop → GE page, and 0 means no cap. Only the shop's default stock is assumed
  on every world; destocking on a world you revisit is not modelled. The
  200-world ceiling is an assumption, and the travel distance is a straight-line
  lower bound (teleports and obstacles are not modelled).
- **GE → shop baskets share hops and one gold budget.** The basket needs
  `max(ceil(units_i / batch_i))` worlds, not the sum over items, and one GE trip
  because the items are noted. Gold is allocated greedily by marginal profit per
  coin; the shared hop cost is not part of that ratio, so a marginal unit that
  forces an extra world can look slightly better than it is. GE buy offers are
  assumed to fill concurrently across the offer slots, with no competition or
  collection travel. Per-item rows can show 0 units when the budget goes
  elsewhere.
- **Shop access is curated, not exhaustive.** A **locked** badge means the
  wiki-backed access table lists a requirement; the source is linked. **Hide
  locked** removes only those shops. A shop without a badge has unknown access,
  not guaranteed access. Requirements are informational and are not evaluated
  against your account's quests or skill levels. See
  [docs/shop-access.md](docs/shop-access.md).
- **Travel to the shop is not modelled** on the shop → GE page, only hop time,
  bank trips and GE sell time.
- **Illiquid items show stale GE prices.** If something trades twice a day, its
  `low` may be wildly out of date. Filter with `--min-volume4h`.
- **Processing is deterministic-only.** Cooking is excluded because burn
  chance depends on level and food; any recipe whose wiki quantity note mentions
  a chance, average, range or level scaling is also excluded. The recipe bucket
  exposes only the primary output, so secondary products are not credited.
  Banking, facility travel, tool acquisition and quest/area access are not
  modelled. `gp / hour` is the processing action rate only, and is `—` when the
  wiki publishes no ticks.
- **Not modelled:** teleport costs, competition from other players,
  instance/quest access requirements, and destocking/restocking between runs.
  The GE → shop world count is capped at an explicit 200, not a sourced total.

## Project layout

```text
src/api/       HTTP gateway (UA, 1 req/s, TTL cache, backoff) + typed clients,
              including wikiRecipes.ts for the recipe bucket
src/domain/   shopPrice.ts (game maths), shopSink.ts (GE -> shop), shopAccess.ts,
              tax.ts, profit.ts, budget.ts, basket.ts, bankTrip.ts,
              earnings.ts (the gp/hour leaderboard) — pure, no I/O
src/engine/   rank.ts (shop -> GE), sinkRank.ts (GE -> shop),
              processRank.ts (processing), skilling.ts (skilling)
              — join catalogue × prices
src/types.ts   zod schemas for every artifact
scripts/       refresh-shops, refresh-market, refresh-access, report,
              refresh-sinks, refresh-process, refresh-skilling, smoke
web/           Vite + React: the earn leaderboard plus the four detail pages
data/          generated JSON (committed so the UI builds offline)
docs/          shop-mechanics.md, data-sources.md, shop-access.md,
              processing.md, skilling-plan.md, tooling-notes.md
```

`docs/shop-mechanics.md` documents every formula with citations, including the
two traps that are easy to get wrong (the overstocked branch is a *division*, and
the stored multipliers are 10× the displayed percentage). Read it before touching
`src/domain/shopPrice.ts`.

## Attribution

Item names, images and game data are © Jagex Ltd. This is an unofficial fan tool
with no affiliation. Wiki content is CC BY-SA, including recipe data from the
wiki's recipe bucket. Price data courtesy of the
[Old School RuneScape Wiki](https://oldschool.runescape.wiki/w/RuneScape:Real-time_Prices).

This project only makes read-only HTTP requests to public wiki endpoints. It does
not interact with the game client in any way.
