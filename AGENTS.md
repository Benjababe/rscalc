# AGENTS.md — rscalc

Shop → Grand Exchange profit calculator for Old School RuneScape.

## Mission

Given a shop and an item, answer: **can I buy it from that shop and sell it on the
GE for profit, and how much is that worth per 4 hours / per hour?**

Correctness of the shop pricing formula and the GE tax matters more than UI polish.
A wrong number presented confidently is the worst possible outcome for this project.

## Ground rules (non-negotiable)

- **Read-only HTTP only.** Never automate the OSRS client, log in, or send input.
  There is no botting path in this repo and there must never be one.
- Every request to `prices.runescape.wiki` MUST send a descriptive User-Agent:
  `rscalc/<version> (+<contact>)`. Do not remove or genericise it.
- **Global outbound rate limit: 1 req/s.** All outbound calls go through
  `src/api/http.ts`. Cache TTLs: latest 60s, mapping 24h, 24h 1h, timeseries 1h,
  shop catalog 24h. Honor `429` + `Retry-After` with exponential backoff.
- **Never commit secrets.** `.env` is gitignored; `.env.example` is committed.
  (Note: the core product requires **zero API keys** — see `docs/data-sources.md`.)
- **No fabricated game data.** If a shop's stock, restock, or delta is unknown,
  store `null` and exclude it from results. Do not guess, do not interpolate,
  do not "fill in" a plausible-looking number.
- All money is integer gp. Truncate (floor) at the same points the game does —
  see `docs/shop-mechanics.md`. Never round differently than the source formula.

## Stack

pnpm · TypeScript (strict, ESM) · Node >= 22 · Vite + React for the UI ·
`tsx` for scripts · `vitest` for tests · `zod` for every external payload.

No database. The pipeline is file-based: `scripts/` fetch → `data/*.json`
(build artifacts) → engine reads them → UI reads the engine output.

## Layout

```
src/api/http.ts        fetchJson: User-Agent, 1 req/s limiter, cache, 429 backoff
src/api/prices.ts      typed zod client for prices.runescape.wiki v2
src/api/storeBucket.ts typed parser for Special:Bucket?bucket=storeline
src/domain/tax.ts      GE tax rules
src/domain/shopPrice.ts dynamic shop price formula (the game's exact math)
src/domain/profit.ts   arbitrage planner: optimal buy quantity, margin, gp/hour
src/engine/rank.ts     joins catalog x prices x volume -> ranked opportunities
src/types.ts           shared domain types
scripts/refresh-shops.ts   build data/shops.json from the wiki bucket
scripts/refresh-market.ts  build data/market.json from the prices API
scripts/report.ts          CLI report
web/                       Vite + React UI
data/                      generated JSON (committed so the UI works offline)
tests/                     unit tests + frozen fixtures
docs/                      sourced mechanics + data-source documentation
```

## Milestones

### M0 — Scaffold ✅
Strict TS, vitest, `src/api/http.ts` with UA + limiter + cache + backoff.
**Accept:** `pnpm smoke` prints the live item count from `/mapping`.

### M1 — Domain math (pure, no network) ✅
`tax.ts`, `shopPrice.ts`, `profit.ts` are pure and dependency-free.
- GE tax: `price < 50 ? 0 : min(5_000_000, floor(price * 0.02))`.
- Shop price: port of the wiki's `Module:Shop calculator`, including the
  **overstock division** branch and all four floors. Cite the source in a comment.
- Arbitrage: marginal-price planning (buy the k-th unit iff its marginal price
  is still <= net sell price), not naive `units * firstUnitPrice`.
**Accept:** all boundary tests green; zero network calls in this milestone.

### M2 — Shop catalog ✅
Scrape `Special:Bucket?bucket=storeline`, normalise, join item names to GE ids.
Emit `data/shops.json`. Every field either has a source or is `null`.
**Accept:** schema-validated, >= 200 shop/item rows, honest `null`s for ∞/N/A.

### M3 — Ranking engine ✅
Join catalog x latest prices x 24h volume. Filter illiquid / negative margin.
**Accept:** deterministic output; golden-file test on frozen fixtures.

### M4 — UI ✅
Static React table over `market.json`. Zero network calls from the browser.
Shows "data as of" timestamp and the pessimistic/patient mode toggle.

### M5 — Ingestion ✅
`refresh-market.ts` + `refresh-shops.ts`, idempotent, logged, fails loudly.

### M6 — Hardening ✅
Zod-parse every external payload so schema drift fails loudly. Mocked-fetch tests
for rate limiting. README with attribution + data caveats.

## Engineering conventions

- Validate every external JSON shape with zod. Never `as`. Never `any`.
- Domain functions are pure so they're trivially testable.
- Every game-mechanic claim carries a URL citation, in code or in `docs/`.
- Every price value is tagged with the timestamp it came from.
- Prices are `number` (gp). Max is well under `Number.MAX_SAFE_INTEGER`.

## Definition of done for any task

1. `pnpm test` passes. 2. `pnpm typecheck` clean. 3. Any new game-mechanic claim
has a URL citation. 4. No new outbound call bypassing `src/api/http.ts`.
