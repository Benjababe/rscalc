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

### 1.1 What the scans found (added after §8)

`data/process.json` is profitable-only by construction — `rankProcess` floors at
1 gp — so it could never answer "what does this cost me to train". The skilling
engine (`src/engine/skilling.ts`) therefore calls the same ranking with the floor
turned off (`NO_PROFIT_FLOOR`) and re-frames the result. `data/skilling.json` is
built by `pnpm skilling`.

Counts are from the artifact at prices as of 2026-11-01 08:35 UTC and move with
the market: a run four hours later had Crafting at 106 profitable instead of 110.
Treat the split as a shape, not a constant.

| Skill | Bucket recipes | Priced | Profitable / loss | Patient priced |
|---|---|---|---|---|
| Crafting | 727 | 299 | 106 / 193 | 301 |
| Fletching | 420 | 238 | 37 / 201 | 268 |
| Smithing | 416 | 230 | 60 / 170 | 230 |
| Herblore | 400 | 140 | 39 / 101 | 144 |
| Magic | 228 | 146 | 66 / 80 | 147 |
| Runecraft | 195 | 51 | 18 / 33 | 52 |
| Construction | 959 | 756 | 2 / 754 | 745 |
| Cooking | 541 | 47 | 16 / 31 | 46 |

1,907 activities priced in total, from 3,886 bucket recipes. Cooking rows carry a
`noBurnLevel` and are gated on a level the player enters (§8.10). See §8 for why
the rest are unpriced, and for Construction's 736 `train` rows — activities whose
output cannot be sold at all, priced as the cost of one action.

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
| 4 | Herblore | **✅ scanned — see §8.8** |
| 5 | Runecraft | **✅ scanned — see §8.5** |
| 6 | Construction | **✅ scanned — see §8.6** (needed a new `train` row kind) |
| 7 | Magic | **✅ scanned — see §8.9** (high-alch as an output channel is still Q6) |
| 8 | Cooking | **✅ scanned — see §8.10.** Priced only above each food's published no-burn level, with the player's level as the gate. |

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

### 8.4 What the first three skills told us

- The recipe bucket is a genuinely complete activity list for these skills; the
  remaining gaps are market-side, not data-side. That makes Phase 1 cheap.
- **64%** of Crafting rows, **84%** of Fletching and **76%** of Smithing are
  loss-making at instant prices. The page needs a sane default (patient, or an
  explicit mode toggle) or it will read as "every skill loses money".
- The extreme rows are still item upgrades and conversions (rupture, Masori,
  rancour, onyx tips, Torva/Godsword paths), not repeatable training. The `kind`
  split described in §8.1 is now the biggest open design question.

### 8.5 Runecraft ✅

195 bucket recipes name Runecraft; **51 priced** (18 profitable, 33 loss-making),
52 in patient mode. 144 unpriced.

Priced leaders are all altar conversions off pure essence: Blood rune 322
gp/action, Wrath 290, Death 164, Nature 146, Astral 116, Law 113. The rest are the
tiara/bark-armour and combination-rune recipes (lava, smoke, steam), plus the
Varlamore "blank rune" line.

**The rate is the problem, and the page must say so.** The bucket's 1 tick is the
*altar* action; the bank-to-altar run and pouch management are not modelled, and
they dominate a real run. So `1,932,000/h` for blood runes is an altar-rate upper
bound: it is what the altar action alone allows, not what a run sustains. That is
the same "banking and travel excluded" caveat the processing page documents, but
it is far more visible here because Runecraft's margin per essence is small and
the rate is everything. Options when
the page is built: label the rate as an altar rate, or suppress `gp/hour` for
`BATCH_TICK_SKILLS = ['Runecraft']` until a sourced run model exists. Not decided
yet (§7 Q1 is about the general rule).

The 144 unpriced rows are untradeable outputs (elemental/bloodbark tiaras, bark
armour of the wrong tier) and combination runes whose template materials include
a talisman that is not consumed in game. Nothing was estimated.

### 8.6 Construction ✅

**Construction sells nothing, and the first pass proved it.** 959 recipes name
the skill; only 20 could be priced as transforms, and every priced output is a
*Sailing* ship component (Large teak hull parts, 3,516 gp/action). The other 936
build furniture that stands in the player's house — `Mahogany table`,
`Gilded adventure log`, `Crystal throne`, `Mounted coins` — none of which appear
in the GE mapping at all. There is no market to price.

So Construction needed a row shape the artifact did not have: `kind: 'train'`,
`output: null`, `profit = -spend`. 736 rows are now cost-only, and they answer the
only question the skill can answer — what training costs per action and per hour:

| Build | Cost / action | Cost / hour |
|---|---|---|
| Vale offerings (oak logs + oak shield x4) | −116 gp | −203 |
| Wooden hull (hull parts x10 + 300 bronze nails) | −1,930 gp | −965 |
| Gold candlesticks (6 bars + 6 candles) | −1,770 gp | −2,655 |
| Crystal throne (15 magic stones) | −15,000,000 gp | −63,750,000 |
| Mounted coins (marble + gold leaf + **100,000,000 gp fee**) | −100,471,805 gp | — |

`Mounted coins` is a real row: the recipe template charges a 100M gp fee. It is
the useful kind of absurd — it shows the page is reading the source rather than
guessing.

Rule that keeps `train` honest: a recipe becomes a cost row **only when its
output has no GE market at all** (absent from the mapping = not a tradeable item).
An output that is tradeable but has no 4h volume — a heraldic helm, a Vale
offering — stays *unpriced*, because that is a market problem, not a cost. Tests
pin both branches. The 203 unpriced rows are recipes whose inputs are untradeable
(Pharaoh's sceptre, ancient signet, marble blocks as quest rewards).

### 8.8 Herblore ✅

400 bucket recipes name Herblore; **140 priced** (39 profitable, 101 loss-making),
144 in patient mode; 260 unpriced.

Priced: herb cleaning (Grimy kwuarm 125 gp/action), every unfinished potion against
a vial of water (Cadantine 246, Toadflax 201, Dwarf weed 225, Snapdragon 210), and
potion finishing (Defence potion(3) from Ranarr potion (unf) + white berries). The
lone outlier is Sacred oil(4) at 2,782 gp/action — olive oil + sanctity, a
Varlamore-era item with a thin market, so treat that number as fragile.

**The 260 unpriced are correct, and worth understanding** — I checked three by
hand rather than trusting the count:

- `Antipoison potion (4)` — the output itself is not in the GE mapping (a
  Varlamore gourd-vial potion, untradeable), and its materials (water-filled gourd
  vial, noxifer, cicely) are untradeable too.
- `Divine bastion potion(4)` — output and bastion potion are priced, but **crystal
  dust** is not a GE item; the input cannot be bought.
- The `mix` family (Agility mix, Ancient mix, …) mostly needs untradeable
  secondary ingredients.

So the Herblore gap is "you cannot buy the inputs", not "we failed to look": no
mix, antidote or divine potion can be priced from GE legs alone. If the page ever
wants them, the honest route is an expected-value model over the *player-made*
input, which is a different feature.

### 8.9 Magic ✅

228 bucket recipes name Magic; **146 priced** (66 profitable, 80 loss-making), 147
in patient mode; 82 unpriced.

This is the most varied skill so far because the bucket files every spell that
produces an item: jewellery and bolt enchantment (Ring of recoil 737 gp/action,
Ring of dueling(8) 207, Diamond ascension bolts (e) 699 per 10), teleport tablets
(Waterbirth 488, Annakarl 1,470, Lumbridge 311, Varrock 292), and the
item-transmutation spells — `Tan Leather` (Green dragon leather x5 720, Red x5
860) and `Plank Make` (Camphor plank x2 594, including the 1,750 gp sawmill fee
the template charges).

**High-alch is not here**, and that is the gap that matters: `High Level
Alchemy` produces no item, so the bucket cannot express it. Alching is the exit
for most Crafting and Fletching output, so this stays Q6 — an output channel, not
a skill.

For comparison, the best Magic row (1,474,000/h) is a jewellery enchant at 1 tick;
its rate is honest for the spell but ignores the walk to a bank, which is the same
caveat as Runecraft (§8.5) at a much smaller magnitude.

The 82 unpriced rows are spells whose output is untradeable (Berserker necklace,
Avernic treads, ecumenical key), spell pages that are not items (`Enchant
dragonstone`), a handful of tablets needing untradeable dark essence, and the
`(m)`/`(e)`-style variants where the note flags a chance.

### 8.10 Cooking ✅ — gated on the player's level

541 bucket recipes name Cooking; **47 priced** (16 profitable, 31 loss-making),
46 in patient mode. The other 494 are brewing, gnome-cooking assembly, dough and
pizza assembly — recipes that never touch a range — and are unpriced because
nothing publishes a burn level for them.

**Why this skill needed a level input.** Cooking's profit depends on whether the
food burns, and burning destroys the input. The bucket publishes no burn chance
and no no-burn level, so the skill was previously excluded outright. The wiki does
publish the level at which each food **stops** burning
(<https://oldschool.runescape.wiki/w/Cooking/Burn_level>), and above that level the
action is deterministic — a plain "buy raw, sell cooked" margin, exact, no
probability needed.

So the row shape gained one field:

- `noBurnLevel: number | null` — the level at which that food never burns on a
  plain fire or range. `null` for every non-Cooking row, and for the foods that
  never stop burning on a plain source (Shark, Anglerfish, Manta ray, Dark crab:
  the source shows `-` in both plain columns).
- The artifact keeps every gated row; the **player's Cooking level** filters them:
  `pnpm skilling --cooking-level=90` prints only monkfish-and-below, and the page
  will do the same from an input, exactly like the gold budget. A row above the
  player's level is not shown, because at that level its margin is a gamble.
- A food with no entry in the table is never assumed safe. That is why the table in
  `scripts/cookingBurnLevels.ts` also lists the never-safe foods explicitly: so
  "absent" and "safe" cannot be confused.

The table is **curated, cited**, not parsed. The source page is wikitext with a
two-row header (`Food` spans two columns; `Hosidius` and `Gauntlets` span several)
and body rows that sometimes write the food as two cells, so a header-addressed
parser cannot line its columns up without guessing — the one thing this repo does
not do. Same policy as `scripts/shopAccessRules.ts`: hand-read from a page that
states it, with the URL in the file.

Leaders: Monkfish 63 gp/action (204k/h), Cooked karambwan 105, Bass 29, Redberry
pie 95, Red crab meat 316 — the last two are the honest costs of cooking something
you assembled earlier. Biggest losses: Mushroom pie −6,615 per action.

**A caveat the page must carry.** These are 100%-success margins at the stated
level. The ticks are the wiki's cooking ticks, so `gp/hour` still ignores the walk
to a range, like every other row.

## 9. Phase 1 complete (8 of 8 skills)

| Skill | Status | Rows |
|---|---|---|
| Smithing | ✅ §8.3 | 230 |
| Crafting | ✅ §8.1 | 299 |
| Fletching | ✅ §8.2 | 238 |
| Herblore | ✅ §8.8 | 140 |
| Runecraft | ✅ §8.5 | 51 |
| Construction | ✅ §8.6 | 756 |
| Magic | ✅ §8.9 | 146 |
| Cooking | ✅ §8.10 — gated on the player's Cooking level | 47 |

**1,907 activities priced from 3,886 bucket recipes**, with no hand-typed item,
price or rate anywhere: every number is a GE quote joined to the wiki's own recipe
table. The one curated input is the Cooking no-burn table, which is a game
constant read off a wiki page that states it.

What the eight skills taught, in the order it will bite when the page is built:

1. **Three of them are not "profit per hour" skills.** Construction sells nothing
   (`train` rows, §8.6), Runecraft's rate is an altar rate that ignores the run
   (§8.5), and Cooking cannot be priced at all without a burn table (§8.10). The
   page must be able to say "this is a cost" and "this rate is an upper bound",
   not just print a ranked list.
2. **The `kind` field is half-built.** `transform | train` exists; `upgrade` — for
   one-off 40M conversions like Necklace of rupture — does not, and it is what
   decides how the table sorts (a −5.98M/action conversion cannot sit next to a
   322 gp blood rune).
3. **Instant pricing makes almost everything look like a loss** (Fletching 85%,
   Construction 99.7%, Crafting 65%). Patient mode is not a nicety; it is the
   only mode that answers "should I do this?" for a skill you repeat.
4. **Coverage is honest but thin for some skills**: Magic 64%, Herblore 35%,
   Crafting 41%. Every gap I checked was "the input or output is untradeable",
   which is a fact about the game, not about the data.

### Next

Phase 2 (Farming, Mining, Woodcutting, Fishing, Hunter, Thieving, Sailing) is the
hard half: those skills have no recipe table, so each one needs its own sourced
time model. Under §4 an activity whose profit only exists as a rate is skipped, so
expect Phase 2 to contribute far fewer rows and to take far longer per row.

Before that, the page itself is one commit away from being buildable on the seven
scanned skills — and items 1–3 above are design decisions, not data work.
