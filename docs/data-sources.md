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
- `limit` is the GE 4-hour buy limit. Absent for 517 items. It is a per-player
  purchase cap; the engine reports it but caps sale throughput by 24h volume.
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

`store_buy_price` is also the evidence for the reverse (GE → shop) calculator:
the wiki publishes it only for items the shop actually buys at default stock, and
writes `N/A` when it does not — Eblis's ancient staff is the example, with
`hidebuy=y` and `buy=N/A` even though its `store_buy_multiplier` is 1000. The
sink engine therefore requires a published, positive buy price; the multiplier
alone would invent a buyer. See `docs/shop-mechanics.md` §12.6.

`store_sell_price` and `store_buy_price` can differ from
`item value × multiplier` for rows with a per-item price override (for example
Eblis's ancient staff sells for 80,000 despite a 100% multiplier and a 100,000
value). The *buy* prices were cross-checked against the formula and match for
finite-stock rows, apart from a 1 gp floor edge on an excluded general-store
row.

## 3. Wiki MediaWiki API — `oldschool.runescape.wiki/api.php`

Used for shop categories and item stackability (`prop=categories`, batched 50
titles/request).

Shop categories are filtered to `/shop|store/i` so that both `Magic shops` and
`Category:General stores` survive. The GE → shop page excludes general stores by
that category rather than by shop name. See §12.6 of `docs/shop-mechanics.md`.

Note: this wiki has **no Cargo** (`action=cargoquery` returns
`Unrecognized value for parameter "action"`), and `Special:Buckets` (plural) does
not exist. Do not design around either.

### 3.1 Item stackability

| Query | Purpose | TTL | Cost |
|---|---|---|---|
| `action=query&prop=revisions&rvslots=main&rvprop=content&redirects=1&titles=…` | the `stackable` infobox parameter | 24h | ~25 requests for 1,239 items |

The prices API does not publish stackability, and the wiki's `infobox_item`
bucket does not either (verified live: 18 columns, none of them `stackable`). The
parameter is parsed **by key** out of the page wikitext, so a template reorder
cannot shift it. `redirects=1` plus the response's `normalized` and `redirects`
arrays let a page that has moved still join back to the GE mapping name.

Absent, empty, or contradictory values (item variants that disagree) are stored
as `null`. `budget.ts` treats `null` as non-stackable, which overstates time
rather than understating it. See `docs/shop-mechanics.md` §10 for the time model.

Template: <https://oldschool.runescape.wiki/w/Template:Infobox_Item>

### 3.2 Shop, bank and Grand Exchange coordinates

| Source | Purpose | TTL | Cost |
|---|---|---|---|
| `Special:Bucket?bucket=map` | centre `{x,y,plane,mapID}` for shop pages | 24h | 2,177 rows / 5 requests |
| `Category:Banks` (`list=categorymembers`) | bank page titles | 24h | 1 request |
| `prop=revisions` on those titles | the `Map` template's coordinates | 24h | ~2 requests |
| `prop=revisions` on `Grand Exchange` | the GE's `Map` template coordinate | 24h | 1 request |

Only pages whose map template passes `bucket=yes` are in the map bucket, which
covers the shops (588/593) but almost none of the banks. Banks and the Grand
Exchange are therefore read from their infobox wikitext. `mapID` separates the
overworld (0) from underground and instanced maps, and comes from the bucket's
`options` cell for shops and from the `mapID=` parameter for banks.

Distances are computed in `src/domain/bankTrip.ts`: same `mapID` first, then a
cross-map fallback limited to 40 tiles. Shops with no usable bank are stored
with `bankTiles: null` and never assigned a made-up trip. The GE origin is
stored once as `gePoint`, and each shop gets its own `geTiles` from the same
`mapDistanceTiles` rule; shops on another map (127/593 at the last build) are
`null`, which is why the GE → shop page shows `—` for their gp/hour. See
`docs/shop-mechanics.md` §10.1 and §12.5.

### 3.3 Shop access requirements

The wiki has no single structured access field: `Template:Infobox Shop` has no
requirement parameter, `Template:Infobox Location` carries `|requirement =` for
some areas (Fishing Guild, Legends' Guild) but not others (Keldagrim, Zanaris,
Ape Atoll), and the storeline `store_notes` column only hints at post-quest stock
variants. The access table is therefore **curated**, not scraped: rules live in
`scripts/shopAccessRules.ts` and every rule cites the wiki page that states the
requirement. `pnpm access` applies them to `data/shops.json` and writes
`data/shop-access.json` offline. A shop absent from the artifact has unknown
access, not guaranteed access. See [shop-access.md](shop-access.md).

### 3.4 Recipe bucket — `Special:Bucket?bucket=recipe`

<https://oldschool.runescape.wiki/w/Special:Bucket?bucket=recipe>

`Template:Recipe` / `Module:Recipe` writes every recipe into a bucket with ten
columns: `page_name`, `page_name_sub`, `uses_material`, `uses_tool`,
`uses_facility`, `is_members_only`, `is_boostable`, `uses_skill`,
`source_template`, `production_json`. The processing page reads it.

| Property | Value |
|---|---|
| TTL | 24h |
| Pagination | 500 rows/page, 7,855 rows / 16 pages at the last check |
| Parsing | HTML table by **header name**, then zod on `production_json` |
| Source of truth | <https://oldschool.runescape.wiki/w/Module:Recipe> |

`production_json` carries `ticks`, `materials`, `skills`, `members`, `output`,
`facilities` and `tools`. Two limits matter:

- **Only the primary output is stored** (`output[1]` in Module:Recipe). A recipe
  with a secondary product is priced on its main output only.
- **`Coins` in `materials` is a fee** (tanner, sawmill, spell), not a GE item.
  The engine moves it to `feeGp`.

The bucket includes many untradeable quest/minigame items and `skill info` rows;
`source_template = recipe` is the filter, and recipes whose legs lack a GE quote
are dropped. See [processing.md](processing.md) for the deterministic-only
filter and the worked Avantoe example.

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
