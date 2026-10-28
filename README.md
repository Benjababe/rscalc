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
pnpm build:data     # fetch shop catalogue + GE prices  (~25s, no API key)
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
| `pnpm report --write` | also emit `data/opportunities.json` for the UI |
| `pnpm dev` / `pnpm build` | web UI |
| `pnpm test` / `pnpm typecheck` | 57 tests / `tsc --noEmit` |

`pnpm report` flags: `--mode=pessimistic|patient`, `--limit=N`, `--members`,
`--min-volume4h=N`, `--min-margin=N`, `--infinite`, `--write`.

## No API keys

Nothing here needs a key, a token, or an account. The OSRS Wiki prices API is
free and unauthenticated; it only asks for a descriptive `User-Agent`, which
`src/api/http.ts` sends on every request. See [docs/data-sources.md](docs/data-sources.md).

You may optionally set `RSCALC_CONTACT` to your own contact URL/email so the wiki
can reach you about your traffic.

## How it works

```
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
- **Illiquid items show stale GE prices.** If something trades twice a day, its
  `low` may be wildly out of date. Filter with `--min-volume4h`.
- **Not modelled:** travel time, teleport costs, competition from other players,
  instance/quest access requirements, shop gold limits when *selling* to shops.

## Project layout

```
src/api/       HTTP gateway (UA, 1 req/s, TTL cache, backoff) + typed clients
src/domain/    shopPrice.ts (game maths), tax.ts, profit.ts — pure, no I/O
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
