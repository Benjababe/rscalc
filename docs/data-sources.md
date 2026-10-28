# Data sources

Everything this project reads, why, and what it costs.

## Summary

**No API keys are required.** Not one. The entire product runs on free,
unauthenticated endpoints. The only requirement is a descriptive `User-Agent`
header, which `src/api/http.ts` sends on every request.

## 1. OSRS Wiki Real-time Prices — `prices.runescape.wiki`

Base: `https://prices.runescape.wiki/api/v2/osrs/`

Docs: <https://oldschool.runescape.wiki/w/RuneScape:Real-time_Prices>

| Endpoint | Purpose | TTL | Verified |
|---|---|---|---|
| `/mapping` | item id → name, `value`, `limit`, alch | 24h | 4,674 items |
| `/latest` | latest `high`/`low` trade prices | 60s | 200 OK |
| `/24h` | 24h averages + volumes | 1h | 200 OK |
| `/timeseries` | per-item history | 1h | 200 OK |

Notes:

- `value` is genuinely **absent for 19 of 4,674 items**. Modelled as `null`;
  a shop row whose item has no `value` is excluded rather than priced at 0.
- `limit` is the GE 4-hour buy limit. Absent for 517 items.
- The API requires a descriptive User-Agent with contact details. We send
  `rscalc/<version> (+<contact>)`.

## 2. Shop stock tables — `Special:Bucket?bucket=storeline`

<https://oldschool.runescape.wiki/w/Special:Bucket?bucket=storeline>

The wiki's `Bucket` extension serves its own shop stock tables as HTML. This is
the only machine-readable source of per-shop stock, restock timers and price
multipliers. Columns (verified, 15 of them):

`page_name`, `page_name_sub`, `sold_by`, `sold_item`, `sold_item_image`,
`store_buy_price`, `store_sell_price`, `store_currency`, `store_delta`,
`store_stock`, `store_buy_multiplier`, `store_sell_multiplier`, `restock_time`,
`store_notes`, `sold_item_json`

Two things that cost time to discover:

- **It is paginated.** 20 rows by default; `&limit=500` max. The full table is
  ~5,657 rows / 13 pages / 593 shops. `fetchStoreLines()` follows pagination.
- **It is HTML, not JSON.** `?format=json` is ignored, and
  `api.php?action=bucket` requires a `query` parameter that rejects arrays.
  We parse the HTML table by *header name*, so a column reorder fails loudly.

## 3. Wiki MediaWiki API — `oldschool.runescape.wiki/api.php`

Used only for shop categories (`prop=categories`, batched 50 titles/request).

Note: this wiki has **no Cargo** (`action=cargoquery` returns
`Unrecognized value for parameter "action"`), and `Special:Buckets` (plural) does
not exist. Do not design around either.

## 4. Deliberately not used

- **GE Tracker API** — paid subscription + partner approval. Not needed.
- **Game cache (`shops.dat`, `obj.dat`)** — would be authoritative but requires
  reverse-engineering a Jagex client cache. Out of scope and legally murkier.
- **Jagex HiScores** — public, keyless, but irrelevant to shop arbitrage.
- **Any form of game-client automation** — forbidden by Jagex ToS and by
  AGENTS.md. This project is read-only HTTP against public wiki data.

## 5. Coverage: what resolves and what doesn't

Of 5,657 stock rows:

| Bucket | Rows |
|---|---|
| Resolved to a GE item **and** finite-stock **and** Coins | **3,595** |
| Infinite stock (excluded by default, 10-item purchase cap) | 1,357 |
| Non-Coins currency (Tokkul, points, tickets, …) | 586 |
| Unresolved item name | 1,227 |

The 1,227 unresolved are **correctly** unresolved, not a bug:

- Most are **shop-only packs** (`Empty bucket pack` ×58, `Empty jug pack` ×50,
  `Bait pack`, `Feather pack`, `Fire rune pack`, …). These are not tradeable on
  the GE — the only "pack" items on the GE are construction *flatpacks*.
- The rest are untradeable or quest items (`Keris`, `Newcomer map`,
  `Ivandis flail`).

### The normalisation trap (documented so nobody "fixes" it)

Stripping trailing parentheticals would resolve only 11 of the 502 unresolved
finite-stock Coins rows — and would map them to the **wrong items**:

```text
Silver sickle (b)  -> Silver sickle    # (b) is the BLESSED variant
Rune spear(kp)     -> Rune spear       # (kp) is a different poison variant
Net trap (item)    -> Net trap         # this one is genuinely safe
```

A wrong match silently produces a confidently wrong profit number, which is the
single worst failure mode for this tool. We leave them `null`.
