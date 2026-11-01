# Skilling activities — scan plan (provisional)

Status: **Crafting scanned (§8).** Nothing else scanned yet; the rest of this
file is the queue and the method.

The page answers: **for this skill, what can I do, what does one action earn or
cost at today's GE prices, and — only where the wiki publishes a time — what is
that worth per hour?**

Deliberately **not** sourced from the wiki's Money making guides: those pages
publish an author's gp/hour for a curated subset of methods and cannot be split
into "what does this action cost" plus "how many actions per hour". We model the
action, then the rate, then the hour — and each of the three is either sourced or
`null`.

## 1. What already exists (measured, not assumed)

`data/process.json` was regenerated from the wiki's `bucket=recipe` table: **402
priced recipe rows** across **7 skills**, already with inputs, outputs, GE tax,
fees, buy-limit caps, ticks and gp/hour.

| Skill | Rows | Profitable rows |
|---|---|---|
| Crafting | 93 | 93 |
| Magic | 69 | 69 |
| Smithing | 61 | 61 |
| Herblore | 41 | 41 |
| Fletching | 37 | 37 |
| Runecraft | 15 | 15 |
| Woodcutting | 1 | 1 |

Everything else — **16 of the skills — currently has zero coverage**: no recipe
template writes it, or the recipe is filtered out (Cooking for burn chance,
Firemaking and Prayer because no recipe exists, all gathering skills because a
resource node is not a recipe at all).

So the skilling page is mostly **new sourcing**, not new maths. The maths for a
deterministic transform is already in `processRank.ts`.

### 1.1 What the Crafting scan found (added after §8)

`data/process.json` is profitable-only by construction — `rankProcess` floors at
1 gp — so it could never answer "what does this cost me to train". The skilling
engine (`src/engine/skilling.ts`) therefore calls the same ranking with the floor
turned off (`NO_PROFIT_FLOOR`) and re-frames the result. `data/skilling.json` is
built by `pnpm skilling`.

| | Pessimistic (instant buy, instant sell) | Patient (rested offers) |
|---|---|---|
| Crafting — priced | 299 | 301 |
| Crafting — profitable / loss | 109 / 190 | 167 / 134 |
| Fletching — priced | 238 | 268 |
| Fletching — profitable / loss | 38 / 200 | 78 / 190 |
| Smithing — priced | 230 | 230 |
| Smithing — profitable / loss | 56 / 174 | 89 / 141 |

Bucket recipes naming the skill, and how many could not be priced at all: Crafting
727 / 428, Fletching 420 / 182, Smithing 416 / 186. See §8 for why.

## 2. Row model

One row = one repeatable action by a player at a stated level.

```text
id, skill, name, kind: gather | transform | collect | thieve | train
level, members, sourceUrl                    # every row cites a wiki page
inputs:  [{ itemId, itemName, qty }]         # paid at GE price
feeGp                                        # NPC/sawmill/butler coins (not a GE item)
outputs: [{ itemId, itemName, qty }]         # deterministic only
secondsPerAction | secondsPerCycle | null    # see §4
xp, xpNote                                   # optional, powers gp/xp
```

Derived at build time from `data/market.json` (never hand-typed):
`costPerAction`, `revenuePerAction` (minus GE tax), `profitPerAction`,
`profitPerHour` (null when the time cell is null), `gpPerXp`.

Same rules as the rest of the repo: integer gp, floor where the game floors,
unknown stays `null`, no `as`, no `any`, zod on the artifact.

## 3. Source policy per kind

| kind | inputs | outputs | time |
|---|---|---|---|
| `transform` | GE buy | recipe bucket (`bucket=recipe`) | recipe ticks |
| `gather` | none (tools are capital, not cost) | item page / skilling tables | node respawn or click interval — **skipped when unpublished** |
| `collect` (farming) | seed GE buy | patch yield (expected value) | patch growth timer (a game constant — the most defensible time model we have) |
| `thieve` | none | loot table (expected value) | action ticks — **skipped when unpublished** |
| `train` (loss) | GE buy | none | ticks or run duration |

Facility travel, banking and gear are **not** modelled in v1 (same exclusion the
processing page makes); they are documented as a known understatement of time.

### 3.1 Expected value for chance-based yields

Operator decision (recorded in §7): where the wiki publishes a **probability or
yield table** — a drop rate, a harvest quantity by level and compost, a cooking
burn chance, a loot roll — the row is priced at its expected value instead of
being excluded:

```text
EV per action = sum over outcomes ( probability × net value of outcome )
```

Two conditions keep this honest:

- **The distribution is sourced.** A published drop rate, a `1/128` rarity, a
yield-by-level table. A prose "anywhere from 1 to 6" is not: without
probabilities there is no expectation, so that row is skipped.
- **The artifact says it is an expectation.** The row stores the source of the
distribution and the EV formula's inputs, and the UI labels the figure `EV` so a
reader never mistakes a mean for a guaranteed drop. The same applies to multiple
sourced outcomes from one action (a stall giving coins and an item).

**This deliberately overrides a ground rule.** `AGENTS.md` and
`docs/processing.md` forbid collapsing a chance/quantity note into one number
("exclude the recipe or model the distribution explicitly with a sourced
formula"). Skilling rows now use the expectation. `#/processing` keeps the strict
deterministic rule untouched until the same decision is applied there — see
Q11 in §7.

## 4. Time model — sourced, or the row is skipped

Operator decision (recorded in §7): **no player-entered actions/hour.** If a
figure cannot be stated without inventing a rate, it is not published.

1. **Sourced action time** — recipe ticks, patch growth timer, published node
   respawn or click interval. `profitPerHour` is computed from it and shown.
2. **Deterministic per-action profit, no sourced time** — a transform or a loss
   (buy the bones, offer the bones). The row is listed with
   `profitPerHour = null` and the UI shows `—`; the per-action figure stands on
   its own without a clock.
3. **Profit *is* a rate** — gathering, where the income only exists as
   "ore per hour". There is no per-action figure to publish, so the row is
   **skipped and counted**, never estimated and never filled in by the player.

Consequence to accept up front: Mining, Woodcutting, Fishing, Hunter and
Thieving keep only those rows where the wiki publishes both a yield per action
and an action time. The rest of those skills is dropped on purpose. Farming and
the transform skills are unaffected.

## 5. Skill list to scan, one at a time

Ordered so each phase reuses the previous phase's data plumbing. Rough row
estimates are for sanity-checking the output, not targets.

### Phase 1 — `transform` (recipe-backed; extend what exists)

| # | Skill | Expected work |
|---|---|---|
| 1 | Smithing | **✅ scanned — see §8.3** |
| 2 | Crafting | **✅ scanned — see §8.1** |
| 3 | Fletching | **✅ scanned — see §8.2** |
| 4 | Herblore | verify 41, potion finishing vs unfinished, cleaning |
| 5 | Runecraft | verify 15, add essence→rune with altar multipliers, combination runes |
| 6 | Construction | planks + sawmill fee, butler cost, flatpack vs furniture (may be loss-only) |
| 7 | Magic | verify 69, add high-alch as an **output channel** (see Q6), spell costs |
| 8 | Cooking | burn chance is now an expected value (§3.1), so the skill is priceable; needs a sourced burn-chance table by level and Cooking gauntlets |

### Phase 2 — gathering and collection (new sources)

| # | Skill | Time source | Risk |
|---|---|---|---|
| 9 | Farming | growth timer | harvest is a range → expected value (§3.1) |
| 10 | Sailing | salvage / port-task action time | mostly chance-based yields and rate-bound activities; expect a thin list |
| 11 | Mining | rock respawn / mining time | level- and pickaxe-dependent |
| 12 | Woodcutting | tree respawn | level-dependent log count |
| 13 | Fishing | fishing spot rate | level- and spot-dependent |
| 14 | Hunter | trap timer | catch chance → expected value (§3.1) |
| 15 | Thieving | pickpocket ticks | success chance + loot table → expected value (§3.1) |

Under §4 this is the thinnest phase: only rows with a published yield per action
**and** a published action time survive, and the rest are skipped and counted.
Do not pad it with a player-entered rate.

### Phase 3 — loss / cost-of-training (`kind: train`, negative gp)

| # | Skill | Note |
|---|---|---|
| 16 | Prayer | bones → altar/chaos altar; always negative, that is the point |
| 17 | Firemaking | logs burned; gp/hour stays `—` unless a burn rate is published |
| 18 | Agility | marks of grace as the only output; otherwise pure cost |
| 19 | Slayer | needs monster model — see Q4, may be deferred |

### Phase 4 — needs an explicit decision before any scanning

| # | Skill | Why it is parked |
|---|---|---|
| 20–24 | Attack, Strength, Defence, Ranged, Hitpoints | profit is monster drops × kill rate — a different engine, not a recipe |
| — | Minigames / skilling bosses | Wintertodt, Tempoross, Guardians of the Rift, Zalcano, Blast Furnace, Mahogany Homes: all loot-roll based, so they need a sourced table for the EV (§3.1) before they can be priced |

## 6. Per-skill scan contract (what "done" means for one skill)

1. Enumerate the skill's repeatable actions from its own wiki pages (not from a
   Money making page).
2. For each: inputs, outputs, quantity, fee, level, members, source URL.
3. Classify determinism. A fixed quantity is used as-is; a chance, range or
   level-scaled quantity becomes a sourced expected value (§3.1) — never a
   guessed average, and never "somewhere between X and Y".
4. Add rows to `scripts/skillActivities.ts` (curated + cited, compiler-checked,
   same pattern as `scripts/shopAccessRules.ts`), **or** to the recipe path when
   the bucket already publishes it.
5. `scripts/refresh-skilling.ts` joins `data/market.json` and writes
   `data/skilling.json`; tests pin the join, the tax, the EV arithmetic, the
   skip rule for rate-only activities and the ordering.
6. Report to the operator: rows added, rows excluded and why.

## 7. Decisions and open questions

### Answered

- **Q1 — time model.** No player-entered rate. A figure is sourced or the row is
  skipped; gathering activities whose profit only exists as a rate are dropped
  and counted. (§4)
- **Q2 — chance-based yields.** Use the expected value of the sourced
  distribution rather than excluding the row: drop rates, harvest ranges, burn
  chances and loot rolls are all allowed, and the row is labelled `EV`. (§3.1)
- **Q3 — Sailing.** Released 19 November 2025 and already in the shop-access
  table (`scripts/shopAccessRules.ts`, docking levels 45–67). It is scanned like
  any other skill, in Phase 2.

### Still open

- **Q4 — combat and Slayer monsters:** in or out of this page? Monster drops are
  a drop-table × kill-rate model, so they would need both halves of the EV rule.
- **Q5 — overlap with `#/processing`.** ~300 of the Phase 1 rows are the same
  actions. Duplicate them under Skilling, or make Skilling the superset and
  leave Processing as the GE-flip view?
- **Q6 — alternative output channels.** Some output is worth more to a shop or
  as a high-alch than on the GE. Include alch (nature rune cost, fire staff) and
  shop-sale as per-row channels, or GE only?
- **Q7 — granularity cap.** Every variant or the profitable subset? Some skills
  have hundreds of near-identical item combos; is a curated top-N per skill
  acceptable, with the cut documented?
- **Q8 — leaderboard.** Does `#/skilling` stay a standalone page, or do its rows
  feed `earnings.ts` in a later commit?
- **Q9 — farming shape.** Per-patch profit, or a whole herb-run cycle (patches ×
  expected yield × growth time)?
- **Q10 — default view.** Show loss-making rows (cost to train) by default, or
  hide behind a filter? "Profit/loss" suggests they are wanted.
- **Q11 — Cooking and the chance-based recipes.** The EV decision unblocks
  Cooking and the rows `processRank.ts` currently drops on a `quantitynote` that
  mentions a chance or an average. Do we re-admit those here only, or relax
  `#/processing` the same way? Two answers are defensible; leaving the pages
  disagreeing is not.
- **Q12 — EV sourcing floor.** Is a published drop rate enough on its own, or do
  you also want level-scaled tables (harvest yield by level and compost, burn
  chance by level and gauntlets) accepted as the distribution? A level-scaled
  row without the table has no expectation, so it stays skipped.

## 8. Scanned: Crafting, Fletching, Smithing ✅

All three are recipe-backed, so none needed a new source: every action the wiki
template knows is already in `Special:Bucket?bucket=recipe`. The 93/37/61 rows in
`data/process.json` were only the profitable slice of each skill.

- Engine: `src/engine/skilling.ts` — `rankSkillActivities` wraps `rankProcess`
  with the profit floor off, and reports coverage instead of hiding it.
- Artifact: `data/skilling.json` (`pnpm skilling`), both price modes, 767 rows
  across the three skills.
- Command: `pnpm skilling`, part of `pnpm refresh`.
- Test: `tests/skilling.test.ts` pins the loss side, the coverage
  reconciliation, and the null-rate rule.

### 8.1 Crafting ✅

Scanned first because it is the largest recipe-backed skill. 727 bucket recipes
name it; **299 priced** in pessimistic mode (109 profitable, 190 loss-making),
301 in patient (the counts differ because a mode's 4h liquidity cap can fall
below one action on one side of the book).

#### What is priced

| Group | Rows | Note |
|---|---|---|
| Jewellery (gold/silver + gems) | 63 | Dragonstone bracelet 319 gp/action (547k gp/h) is the pessimistic leader |
| Dragonhide armour | 32 | every body/chaps/vambraces/shield tier, mostly loss-making at instant prices |
| Gem cutting | 13 | uncut → cut for all seven gems, incl. Amethyst tips |
| Spinning / string | 9 | flax → bow string (170 gp/action), crossbow string, ball of wool |
| Glassblowing | 9 | vial, unpowered orb, lantern lens, beer glass, lanterns |
| Battlestaves | 4 | air/water/earth/fire; only water is positive at instant prices |
| Pottery | 3 | unfired pot/bowl/pot lid |
| Item upgrades | 9 | Masori (f), Necklace of rupture, Amulet of rancour, toxic trident, Berserker icon |

#### What is not priced, and why

- **428 bucket recipes naming Crafting** did not survive the engine. The causes
  are all the same rules the processing page uses: a leg with no GE price (the
  item is untradeable), a leg with no 4h liquidity, a quantity that is not a
  whole number, or a `quantitynote` flagging a chance/average. Nothing is filled
  in to close the gap; the page states the count.
- **Tanning hides** is a real gp activity with no Crafting experience and no
  recipe template (an NPC service), so it belongs to neither a skill nor the
  processing page. Left out, noted here.
- **High-alch and shop sale** are still not output channels (Q6), which matters
  for Crafting more than for any other skill: d'hide bodies, battlestaves and
  most jewellery are commonly alched, so a GE-only view understates them.

#### Caveats the page must carry

- **Pessimistic mode makes most of the skill look negative.** Instant-buy inputs
  at `high` and instant-sell output at `low` crosses the spread on every action,
  so 190 of 299 Crafting rows lose money. That is a true statement about *that
  execution style*, not about the skill. Patient mode (167 of 301 profitable) is
  the fairer read for a skill where you can batch 27 items and slow-sell.
- **Item upgrades dominate both tails.** Necklace of rupture (-5,982,866 gp per
  action) and Amulet of rancour (+682,060 gp per action in patient mode) are
  one-off conversions of 40M+ items, not repeatable training. They are legitimate
  recipes and stay listed, but they are not comparable to spinning flax. A
  `kind` split (transform vs upgrade) is worth adding before the page ships.
- **Three rows have no published tick count** and therefore no rate:
  Berserker icon, Warrior icon, Uncharged toxic trident. They keep `gpPerHour:
  null` and the UI shows `—` (the §4 rule).

### 8.2 Fletching ✅

420 bucket recipes name Fletching; **238 priced** in pessimistic mode (38
profitable, 200 loss-making), 268 in patient (78 profitable) — the larger patient
count is rows whose *input* side only has volume on the resting offer.

Coverage is good: every arrow, dart, javelin, bolt and bolt-tip tier, unstrung
and strung bows, crossbow stocks, broad bolts, amethyst variants, wooden
"fletching shields". Pessimistic leaders are bolt tips, because one gem becomes
twelve: Diamond bolt tips 521 gp/action (625k gp/h), Ruby bolt tips 455, Ascension
bolts 142, Magic longbow 195 (487k gp/h). The worst is Onyx bolt tips at
**-1,792,871 gp per action**: one 1.98M onyx becomes 24 tips worth ~194k. That is a
genuinely useful warning the processing page never showed.

182 recipes are unpriced, and the reason is liquidity rather than missing data.
Checked by hand: `Rune crossbow` needs a Runite crossbow (u) whose high-side 24h
volume is **5 units** (4h slice → 0 actions), `Steel javelin` needs steel javelin
tips with **zero** volume, and the `Godsword shards 2 & 3` recipe names an item
that does not exist in the GE mapping at all. None is a bug in the join; all are
the "the market cannot supply this in this mode" rule doing its job.

### 8.3 Smithing ✅

416 bucket recipes name Smithing; **230 priced** in pessimistic mode (56
profitable, 174 loss-making), 230 in patient (89 profitable).

Bars from ore (Bronze/Iron/Steel/Mithril/Adamantite/Runite, plus Gold, Silver,
Lead, Cupronickel, Lunar, Lovakite), all bar → item smithing, dart tips, nails,
cannonballs (every metal, incl. the incendiary and chainshot variants), spirit
shields and the Godsword blade path. Pessimistic leaders are high-tier armour and
bars: Rune plateskirt 1,120 gp/action (848k gp/h), Runite bar 1,143, Rune 2h sword
876, Steel cannonball 526 per 8 (from 2 steel bars).

186 recipes are unpriced for the same liquidity reason: `Dragon platebody` needs a
Dragon metal shard with **zero** 24h volume on both sides; `Godsword blade` has
three recipes whose combined-shard material has no GE mapping. The rest are
untradeable (Shayzien supply sets, Blisterwood, Crystal items, Infernal pieces,
Gauntlet tools) or Varlamore-era items with no market yet.

### 8.4 What these three skills now tell us

- The recipe bucket is a genuinely complete activity list for these skills; the
  remaining gaps are market-side, not data-side. That makes Phase 1 cheap.
- **64%** of Crafting rows, **84%** of Fletching and **76%** of Smithing are
  loss-making at instant prices. The page needs a sane default (patient, or an
  explicit mode toggle) or it will read as "every skill loses money".
- The extreme rows are still item upgrades and conversions (rupture, Masori,
  rancour, onyx tips, Torva/Godsword paths), not repeatable training. The `kind`
  split described in §8.1 is now the biggest open design question.

### Next skill

Construction or Runecraft: both are Phase 1 leftovers with real non-recipe work
(plank fees and butler costs; altar multipliers and pouch capacity).
