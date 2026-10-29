# AGENTS.md — rscalc

Shop → Grand Exchange profit calculator for Old School RuneScape.

## Mission

Given a shop and an item, answer: **can I buy it from that shop and sell it on the
GE for profit, and how much is that worth per 4 hours / per hour?** And the
reverse: **can I buy it on the GE and sell it to a shop for profit?**

Correctness of the shop pricing formula, the GE tax and the travel-time model
matters more than UI polish. A wrong number presented confidently is the worst
possible outcome for this project.

## Ground rules (non-negotiable)

- **Read-only HTTP only.** Never automate the OSRS client, log in, or send input.
  There is no botting path in this repo and there must never be one.
- Every outbound request (`prices.runescape.wiki` and `oldschool.runescape.wiki`)
  MUST send a descriptive User-Agent: `rscalc/<version> (+<contact>)`. Do not
  remove or genericise it. Set `RSCALC_CONTACT` so the contact is real.
- **Global outbound rate limit: 1 req/s.** All outbound calls go through
  `src/api/http.ts`. Cache TTLs: latest 60s; mapping 24h; 24h averages 1h;
  timeseries 1h; storeline 24h; map bucket 24h; item/bank page wikitext 24h.
  Honor `429` + `Retry-After` with exponential backoff.
- **Never commit secrets.** `.env` is gitignored. The core product requires
  **zero API keys** — see `docs/data-sources.md`.
- **No fabricated game data.** If stock, restock, delta, base value or bank
  distance is unknown, store `null` and exclude the row (or its time estimate)
  rather than guessing. Do not interpolate, do not "fill in" a plausible number.
  Unknown stackability is stored as `null` and charged conservatively as
  non-stackable.
- **A shop buys an item only when the wiki says so.** Require a positive
  published `store_buy_price`; `N/A` means the shop refuses the item even when
  `store_buy_multiplier` is non-zero (Eblis's ancient staff). General stores are
  excluded from the GE → shop page by `Category:General stores`, never by name,
  until their "buys anything" behaviour has its own sourced model.
- **Never replace a per-shop quantity with a global default.** Bank travel is per
  shop and derived from the wiki map. The only allowed global values are game or
  interface constants: movement speed and the bank handover. A single global
  "bank trip takes N seconds" is wrong and must not come back.
- **An unknown bank distance must not produce a time-derived number.** The budget
  planner reports `gpPerHour = null` and the UI shows `—`; it never charges an
  invented trip.
- All money is integer gp. Truncate (floor) at the same points the game does —
  see `docs/shop-mechanics.md`. Never round differently than the source formula.

## Stack

pnpm · TypeScript (strict, ESM) · Node >= 22 · Vite + React for the UI ·
`tsx` for scripts · `vitest` for tests · `zod` for every external JSON payload.

No database. The pipeline is file-based: `scripts/` fetch → `data/*.json`
(build artifacts) → engine reads them → UI reads the engine output.

No HTML-parser dependency: the small, header-addressed extractors live in
`src/api/wikiTable.ts` (tables) and `src/api/wikiPages.ts` (wikitext).

## Layout

```text
src/api/http.ts        fetchJson/fetchText: UA, 1 req/s limiter, cache, 429 backoff
src/api/prices.ts      typed zod client for prices.runescape.wiki v2
src/api/storeBucket.ts parser for Special:Bucket?bucket=storeline (shops/stock)
src/api/wikiTable.ts   shared HTML table extraction (columns by header name)
src/api/wikiPages.ts   batched page wikitext (redirects + normalisation)
src/api/wikiItems.ts   item stackability from the infobox
src/api/wikiMap.ts     shop/bank coordinates (map bucket + Category:Banks pages)
src/domain/tax.ts      GE tax rules
src/domain/shopPrice.ts dynamic shop price formula (the game's exact math)
src/domain/shopSink.ts  GE -> shop planner: decreasing sale curve, world hops, GE trip, gp/hour
src/domain/sinkBasket.ts GE -> shop basket: shared worlds/trip, one gold budget, GE buy slots
src/domain/profit.ts   arbitrage planner: marginal buy quantity, margin, gp/4h
src/domain/budget.ts   gold-budget planner: worlds, banking, gp/hour
src/domain/basket.ts   multi-item shop planner: shared hops/loads, GE sell slots
src/domain/bankTrip.ts nearest-bank join + per-shop trip seconds (shared with the GE trip)
src/engine/rank.ts     joins catalog × prices × volume × stackability
src/engine/sinkRank.ts joins for GE -> shop; buy limit as a purchase cap,
                       general-store exclusion, published buy prices only
src/types.ts           shared domain types and zod schemas
scripts/refresh-shops.ts   build data/shops.json (storeline + map + banks)
scripts/refresh-market.ts  build data/market.json (prices + stackability)
scripts/report.ts          CLI report; --write emits opportunities.json;
                           --shop prints one shop's multi-item basket
scripts/refresh-sinks.ts   GE -> shop ranking; --write emits shop-sinks.json
scripts/smoke.ts           connectivity + schema check
web/                       Vite + React UI (reads static data only)
data/                      generated JSON (committed so the UI works offline)
tests/                     unit tests; mocked fetch, no live network
docs/                      sourced mechanics + data-source documentation
```

## Data artifacts

```text
data/shops.json          593 shops / 5,657 stock rows; pricing parameters plus
                         bankTiles + nearestBank per row
data/market.json         GE quotes for the 1,239 items the catalogue references;
                         includes stackable
data/opportunities.json  both sell modes, full lists, consumed by the UI
data/shop-sinks.json     GE -> shop flips for both buy modes, consumed by the UI
```

Coverage at the last refresh: 526/593 shops have a bank distance (5 have no map
coordinates, 62 have no bank on their map) and 461/593 have a Grand Exchange
distance (127 more are on another map). The rest are `null` by design. The GE ->
shop page excludes general stores and rows without a published shop buy price.

## Commands

```sh
pnpm typecheck      # tsc --noEmit
pnpm test           # vitest, no live network
pnpm shops          # data/shops.json (cold cache: ~35s incl. map + banks)
pnpm market         # data/market.json (cold cache: ~30s incl. stackability)
pnpm build:data     # both
pnpm report --write # data/opportunities.json (both modes)
pnpm report --shop="Lundail's Arena-side Rune Shop" --gold=100000
                    # one shop's multi-item basket
pnpm sinks --write  # data/shop-sinks.json (both buy modes)
pnpm build          # UI bundle
```

## Milestones

### M0 — Scaffold ✅
Strict TS, vitest, `src/api/http.ts` with UA + limiter + cache + backoff.
**Accept:** `pnpm smoke` prints the live item count from `/mapping`.

### M1 — Domain math (pure, no network) ✅
`tax.ts`, `shopPrice.ts`, `profit.ts`, `budget.ts`, `bankTrip.ts` are pure and
dependency-free.
- GE tax: `price < 50 ? 0 : min(5_000_000, floor(price * 0.02))`.
- Shop price: port of the wiki's `Module:Shop calculator`, including the
  **overstock division** branch and all four floors. Cite the source in a comment.
- Arbitrage: marginal-price planning (buy the k-th unit iff its marginal price
  is still <= net sell price), not naive `units * firstUnitPrice`.
- Budget/logistics: 28-slot backpack, one slot reserved for coins → 27
  non-stackable units per load; `bankTrips = ceil(N/27) - 1`; trip seconds =
  `2 * bankTiles * secondsPerTile + handover`; time =
  `max(worlds * hop + trips * trip, sellSeconds)`.
- Bank join: same `mapID` first, 40-tile cross-map fallback, otherwise `null`.
**Accept:** all boundary tests green; zero network calls in this milestone;
unknown bank time yields `gpPerHour = null`.

### M2 — Shop catalogue ✅
Scrape `Special:Bucket?bucket=storeline`, normalise, join item names to GE ids,
and enrich each shop with its nearest bank from the wiki map. Emit
`data/shops.json`. Every field either has a source or is `null`.
**Accept:** schema-validated, >= 200 shop/item rows, honest `null`s for ∞/N/A
and for shops with no bank on their map.

### M3 — Ranking engine ✅
Join catalog × latest prices × 24h volume × stackability. Filter illiquid /
negative margin. Sort by gp/4h, then margin, then name.
- **The GE buy limit is metadata, not a sell cap.** It limits how many one
  player can buy in 4h; market-wide sale throughput is bounded by the 24h volume
  slice. Report `geBuyLimit`, but never use `min(geBuyLimit, volume4h)` as the
  sellable quantity. <https://oldschool.runescape.wiki/w/Grand_Exchange/Buying_limits>
**Accept:** deterministic output; tests pin filtering and ordering.

### M4 — UI ✅
Static React table over `data/opportunities.json` (both sell modes). Zero network
calls from the browser. Shows "data as of", the pessimistic/patient toggle, and
budget sizing with per-shop bank time, travel speed and `—` for unknown distances.

### M5 — Ingestion ✅
`refresh-market.ts` + `refresh-shops.ts`, idempotent, logged, fails loudly.
Includes stackability (item pages) and per-shop bank coordinates (map bucket +
bank pages).

### M6 — Hardening ✅
Zod-parse every external JSON payload. Parse HTML tables by header name and
wikitext by key, failing loudly on schema drift. Mocked-fetch tests for caching
and error paths. README with attribution + data caveats. Stored text never
contains rendered HTML.

### M7 — Banking / logistics ✅
Banking time is per shop, not a global setting.
- Stackability is read from `|stackable` in the item infobox; unstated or
  contradictory values are `null` and treated as non-stackable.
- 28-slot backpack, one slot for the coin stack → 27 non-stackable units per load.
- `bankTiles` / `nearestBank` come from the wiki map. Same `mapID` only;
  a cross-map bank is trusted within 40 tiles; `mapID = -1` is a custom-map
  sentinel and never matched as a shared map.
- Straight-line distance is a lower bound on travel time; `secondsPerTile` defaults
  to 0.6 (walking; 0.3 running) and the bank handover to 3s.
- UI: per-shop seconds in the Banks cell, a travel-speed input, and `—` for shops
  with no known bank.
**Accept:** no global bank-time input; unknown distances never produce a number.

### M8 — Multi-item shop baskets ✅
A shop visit can buy every profitable item on that shop's stock table, so hops
and bank loads are shared rather than charged once per item.
- `src/domain/basket.ts` allocates a gold budget across a shop's items. World
  hops are the number of visits with any purchase, not the sum of per-item hop
  counts. A fresh world resets every item's price curve.
- Bank loads are shared: 27 non-stackable units per load, each distinct
  stackable item type reserves one slot, and stackable-only baskets never bank.
  If banking is needed and `bankTiles` is `null`, `gpPerHour` is `null`.
- Sell time schedules each item's 4h fill across the GE offer slots: 8 for
  members, 3 for free players. Offers for different items run concurrently up to
  that limit.
- Allocation takes the next marginal unit with the best profit per coin. A budget
  that covers a full world buys every profitable unit, so the heuristic is not
  used in the common case. Zero-margin units are never bought.
- UI: a **basket** button beside each shop opens the combined plan. CLI:
  `pnpm report --shop="<name>" --gold=N`.
**Accept:** tests pin shared hops, shared/mixed bank loads, unknown bank → `null`
only when a trip is needed, GE slot batching, caps, and the allocation rule.

### M9 — GE → shop (reverse arbitrage) ✅
Buy on the Grand Exchange, sell to a shop whose stock table publishes a buy
price. Two pages share one shell; the reverse direction has its own artifact.
- `planShopSale` mirrors `planPurchase`: sell while the shop's next price is
  strictly above the GE cost, incrementing its stock, floored at 10% of value.
  `maxUnits` is mandatory because the floor can make an unbounded loop.
- Buy modes: pessimistic = instant buy at GE `high` + `highVolume24h`; patient =
  resting offer at `low` + `lowVolume24h`. No GE tax on either leg. The GE buy
  limit is a genuine purchase cap here:
  `purchaseCap4h = min(limit, floor(volume24h/6))`.
- A shop only counts as buying an item when the wiki publishes a positive
  `store_buy_price`; `N/A` means it refuses the item even if the buy multiplier
  is non-zero. General stores are excluded by `Category:General stores`, never
  by name. Only items in a shop's stock table are considered.
- Time: items are collected from the GE as banknotes, so there is no 27-unit
  load split and no banking. One GE round trip at the shop's own `geTiles`
  (same mapID rule as banks) plus one hop per world. Each world resets the
  shop's stock, so the marginal batch is repeated; the plan stops at
  `min(purchaseCap4h, unitsPerWorld * 200)`. `time = max(trip + worlds * hop,
  units/purchaseCap4h * 4h)`. Unknown `geTiles` → `gpPerHour = null`.
- The plan is also capped by available gold: `floor(gold / GE price)`, with
  `budgetLimited` set when gold binds. Both browser pages share the same
  `rscalc.budget` localStorage value; 0 means no cap.
- UI: **GE → shop** tab (`#/ge-to-shop`); CLI: `pnpm sinks`.
**Accept:** tests pin the published-buy-price rule, general-store exclusion,
buy-limit cap, per-world batch, world-hop time, gold budget, unknown-distance
`null`, and deterministic ordering.

### M10 — GE → shop multi-item baskets ✅
A shop visit can sell every profitable item for that shop, so the world hop and
the single GE trip are shared rather than charged once per item.
- `src/domain/sinkBasket.ts` allocates one gold budget across items by marginal
  profit per coin, respecting each item's GE 4h purchase cap and the shared
  200-world ceiling. Units repeat in per-world batches; the basket needs
  `max(ceil(units_i / batch_i))` worlds, not the sum.
- Items bought on the GE are noted: one GE↔shop trip, no inventory loads or
  banking. Hop time is shared by every item in the basket.
- GE buy offers fill concurrently up to the player's slots (members 8, free 3),
  scheduled longest-first; time = max(trip + hops, buy makespan). Unknown
  `geTiles` → `gpPerHour = null`.
- UI: a **basket** button beside each shop opens the combined plan, using the
  same gold/hop/travel inputs as the page.
**Accept:** tests pin shared worlds, shared gold allocation, one GE trip, GE
buy makespan, caps, unknown-distance `null`, and per-item ordering.

## Engineering conventions

- Validate every external JSON shape with zod. Never `as`. Never `any`.
- Address HTML tables by header name and wikitext by parameter key — never by
  position. Missing columns throw; malformed rows become `null`, not guesses.
- `sold_item_json` text is rendered HTML: run it through `cleanHtmlText` before
  storing. Do not store tags, entities or wiki markup.
- Domain functions are pure so they're trivially testable. `src/domain/` performs
  no I/O and no network access.
- Every game-mechanic claim carries a URL citation, in code or in `docs/`.
- Every price value is tagged with the timestamp it came from.
- Prices are `number` (gp). Max is well under `Number.MAX_SAFE_INTEGER`.
- Sort comparisons must be total and deterministic; tests assert exact ordering.
- Time assumptions (straight-line distance, movement speed, handover) are
  documented and configurable, never hidden behind a single global trip time.

## Committing

Commit frequently — after each coherent, working change rather than at the end of
a long session. A commit must stand on its own: it builds, typechecks and passes
tests without relying on uncommitted work.

- Run `pnpm typecheck` and `pnpm test` before committing. If a zod schema changed,
  regenerate `data/*.json` and include the artifacts in the same commit.
- Keep commits thematic. Do not mix a refactor, a data refresh and a UI change in
  one commit unless they are inseparable; split them where the history would
  otherwise be impossible to review.
- Use the imperative mood and a type prefix: `NEW:` for a capability, `IMPROVE:`
  for a change to existing behaviour, `FIX:` for a bug. Explain *why* in the body,
  not just *which files* changed.
- Never commit `.env`, `.cache/`, `web/dist/` or any secret. `data/*.json` is
  committed on purpose so the UI builds and runs offline.
- If the harness gates commits behind a command (for example `/commit`), ask the
  operator to run it. Do not bypass the gate with a raw `git commit`, and do not
  leave a large change uncommitted waiting for the end of the task.

## Definition of done for any task

1. `pnpm test` passes. 2. `pnpm typecheck` clean. 3. Any new game-mechanic claim
has a URL citation. 4. No new outbound call bypassing `src/api/http.ts`. 5. If a
zod schema changed, regenerate `data/*.json` and commit the artifacts. 6. UI
changes: `pnpm build` passes. 7. Unknown data stays `null`; never introduce a
global default for a per-shop quantity. 8. The change is committed (frequently,
in thematic commits — see above).
