# Skilling activities — scan plan

Status: **phases 1–3 scanned, the expected-value families (§8.17–§8.19), and the
first minigame (§8.20).** 2,114 priced activities across the 19 skills in
`SKILLING_SKILLS`; the remainder and the reason for every gap are in §8. The rest
of Phase 4 is queued or refused in §5, each with the published number it would
need.

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
| --- | --- | --- |
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
| Farming | 138 | 12 | 5 / 7 | 8 |
| Sailing | 153 | 124 | 0 / 124 | 119 |
| Mining | 2 + 13 nodes | 11 | 11 / 0 | 11 |
| Woodcutting | 27 + 14 nodes | 17 | 16 / 1 | 17 |
| Fishing | 18 + 5 charts | 5 | 5 / 0 | 5 |
| Hunter | 5 + 8 charts | 12 | 8 / 4 | 12 |
| Thieving | 0 + 17 tables | 15 | 15 / 0 | 15 |
| Prayer | 32 | 3 | 2 / 1 | 3 |
| Firemaking | 32 | 8 | 7 / 1 | 8 |
| Agility | 1 | 0 | 0 / 0 | 0 |
| Slayer | 13 | 0 | 0 / 0 | 0 |

2,114 activities priced in total, from 4,307 bucket recipes, 27 gathering nodes and
30 expected-value sources (14 stall and pickpocket loot tables, 5 fishing success
charts, 8 hunter creatures and 3 pickpocket charts already counted). Cooking rows
carry a
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
| --- | --- | --- | --- |
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

### 3.1a Ranged quantities are priced at the midpoint (operator decision)

The first version of this rule refused a ranged quantity outright: `Air rune 500-750`
says nothing about weights, so the midpoint would be an invented distribution. The
operator has since decided the other way — **a range is priced at its midpoint** —
because refusing the line deletes the outcome, which understates a row by more than the
midpoint overstates a single line.

The compromise is that the assumption is carried, not hidden:

- `parseQuantity` returns the midpoint **plus** `assumedQuantity: true` and the
  `quantityRange` it came from, and the artifact stores both on every distribution line.
- The page marks such a row `· ranges at midpoint`, and the tooltip shows each line as
  `Air rune ×625 (midpoint of 500-750)`, with a sentence saying the figure is an
  assumption rather than a quoted quantity.
- A quantity written as a word is still refused: `Varies` is not a range, so there is no
  midpoint to take (this is what keeps Fishing Trawler out).
- An unmarked fractional quantity is still refused, so a caller cannot invent a
  fraction without declaring where it came from.

The two original refusal conditions stand as consequences of that:

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

## 4. Time model — sourced, or filled by the player

Operator decision (revised; see Q1): the **artifact** never invents a rate — a
figure that cannot be stated without inventing one is not published. The **page**
may fill a missing rate with the player's own, because a player knows their own
rate and the alternative is showing them nothing.

1. **Sourced action time** — recipe ticks, patch growth timer, published node
   respawn or click interval. `profitPerHour` is computed from it and shown. A
   published rate always wins: the page will not let a typed number displace it,
   so a sourced figure can never be mistaken for an estimate.
2. **Deterministic per-action profit, no sourced time** — a transform or a loss
   (buy the bones, offer the bones). The artifact stores `profitPerHour = null` and
   the page shows `—`; the per-action figure stands on its own without a clock.
   If the player enters **Actions / hour**, those rows are shown at
   `profit x rate`, marked *your rate*, and still capped by what the market absorbs
   in 4h. This is presentation arithmetic only — `data/skilling.json` is not
   regenerated and `#/earn` keeps ranking on sourced rates.
3. **Profit *is* a rate** — gathering, where the income only exists as
   "ore per hour". There is no per-action figure to publish, so the row is
   **skipped and counted**, never estimated. A player rate cannot rescue it:
   there is no per-action profit to multiply.

Consequence to accept up front: Mining, Woodcutting, Fishing, Hunter and
Thieving keep only those rows where the wiki publishes both a yield per action
and an action time. The rest of those skills is dropped on purpose. Farming and
the transform skills are unaffected.

## 5. Skill list to scan, one at a time

Ordered so each phase reuses the previous phase's data plumbing. Rough row
estimates are for sanity-checking the output, not targets.

The list is the skills that produce something for sale (or cost something to
train), across four phases. **Combat is not on it and will not be added**: a kill
is monster drops × kill rate, a different engine (§7 Q4). Phase 4 is the
**minigames and skilling bosses**, which are in scope but gated on sourced data
rather than on a decision — they are queued, not parked.

### Phase 1 — `transform` (recipe-backed; extend what exists)

| # | Skill | Expected work |
| --- | --- | --- |
| 1 | Smithing | **✅ scanned — see §8.3** |
| 2 | Crafting | **✅ scanned — see §8.1** |
| 3 | Fletching | **✅ scanned — see §8.2** |
| 4 | Herblore | **✅ scanned — see §8.8** |
| 5 | Runecraft | **✅ scanned — see §8.5** |
| 6 | Construction | **✅ scanned — see §8.6** (needed a new `train` row kind) |
| 7 | Magic | **✅ scanned — see §8.9** |
| 8 | Cooking | **✅ scanned — see §8.10.** Priced only above each food's published no-burn level, with the player's level as the gate. |

### Phase 2 — gathering and collection (new sources)

| # | Skill | Time source | Risk |
| --- | --- | --- | --- |
| 9 | Farming | **✅ scanned — see §8.12** | compost prices; crops have no bucket recipe, and the nursery is an untradeable chain |
| 10 | Sailing | **✅ scanned — see §8.13** | 124 cost rows; every output is untradeable, and salvage has no recipe at all |
| 11 | Mining | **✅ gather model — see §8.15** | 11 nodes priced from respawn times |
| 12 | Woodcutting | **✅ gather model — see §8.15** | 14 nodes priced from respawn times |
| 13 | Fishing | **✅ scanned — see §8.14** | 0 priced: every bucket output is untradeable |
| 14 | Hunter | **✅ scanned — see §8.14** | 4 rows, all losses; catch rates are not a recipe |
| 15 | Thieving | **✅ scanned — see §8.14** | 0 recipes in the bucket at all |

Under §4 this is the thinnest phase: only rows with a published yield per action
**and** a published action time survive, and the rest are skipped and counted.
Do not pad it with a player-entered rate.

### Phase 3 — loss / cost-of-training (`kind: train`, negative gp)

| # | Skill | Status | Note |
| --- | --- | --- | --- |
| 16 | Prayer | **✅ scanned — see §8.16** | 3 rows: blessing symbols; bones have no recipe |
| 17 | Firemaking | **✅ scanned — see §8.16** | 8 pyre-log rows; burning has no output |
| 18 | Agility | **✅ scanned — see §8.16** | 1 recipe, unpriced at both ends |
| 19 | Slayer | **✅ scanned — see §8.16** | 13 recipes, all house trophies |

### Phase 4 — minigames and skilling bosses (**Blast Furnace priced, §8.20**)

The first minigame is priced, and it needed a **third** shape rather than the two
this section first guessed. Thieving stalls had already added `kind: 'ev'` and the
`distribution` field (§8.17), so a points→loot minigame is the same arithmetic. The
Blast Furnace turned out to be neither that nor a plain transform: its recipes are
already in the bucket with the correct half-coal materials, but the bucket's tick
count is the *process* time of one bar, and the dwarven workers smelt them
concurrently. So the minigame contributes an **overlay** on recipes that already
exist — published actions/hour in place of the tick count, and its fee added per
action (`src/domain/minigame.ts`, `scripts/minigameSources.ts`).

| Shape | How it prices | What must be sourced first |
| --- | --- | --- |
| **Overlay on bucket recipes** | published actions/hour replaces the ticks; fee per action | the minigame's fee per hour and its published throughput per output |
| **Fixed fee − fixed materials** | the `train`/`transform` maths | the fee and the round duration |
| **Points → loot table** | `kind: 'ev'` over the reward table | points (or rounds) per hour **and** the published reward distribution |

| # | Minigame | Skill | Shape | Status |
| --- | --- | --- | --- | --- |
| 20 | Blast Furnace | Smithing | overlay | **✅ priced — see §8.20** |
| 21 | Mahogany Homes | Construction | fee − planks | queued: no published contracts/hour |
| 22 | Giants' Foundry | Smithing | fee − materials | queued: no published rounds/hour |
| 23 | Wintertodt | Firemaking | points → loot | refused: no fixed-quantity crate table, no rounds/hour |
| 24 | Tempoross | Fishing / Cooking | points → loot | refused: same |
| 25 | Guardians of the Rift | Runecraft | points → loot | refused: rewards cost abyssal pearls, and neither half is published |
| 26 | Zalcano | Mining / Smithing | damage → loot | **refused:** every drop quantity is a published range with no weights, and no kills/hour |
| 27 | Volcanic Mine | Mining | points → loot | refused: no published points/hour |
| 28 | Tithe Farm | Farming | points → loot | refused: no published points/hour |

Rules that apply the moment one is scanned, none of them new:

- **A round is the action, not a tick.** `secondsPerAction` is the published
  round or fee-hour; if nothing publishes one, the row keeps
  `gpPerHour = null` and shows `—` (§4), exactly like a recipe with no ticks.
- **The loot table is the source, and the row says so.** A table whose chances do
  not sum to one roll, that carries a ranged quantity with no published weights,
  or that has any unpriced outcome is refused rather than approximated (§8.17).
- **Minigame rewards are not the same question as the skill.** A Wintertodt row
  is "what does a Wintertodt round pay", not "what does Firemaking pay"; it must
  not be ranked as though it were a repeatable burn, which is the same
  distinction the `upgrade` kind drew (§9).
- **Q12 decides how thin Phase 4 gets.** If only a flat drop rate qualifies as a
  distribution, the level- and points-scaled reward tables stay unpriced.

Included here, and still unpriced until a source exists: Sailing's salvage and
port tasks (§8.13) and the minigame reward tables (§5 Phase 4). Fishing catch
rates, Hunter trap rates and pickpockets are **done** — see §8.19.

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

- **Q1 — time model. ANSWERED, then revised by the operator.** The artifact never
  invents a rate: a figure is sourced or the row stays `null`, and gathering
  activities whose profit only exists as a rate are dropped and counted. The page
  now accepts a player-entered **Actions / hour** that fills only the rows with no
  published rate — labelled *your rate*, never displacing a sourced figure, still
  capped by 4h market volume (`web/src/skillingRate.ts`). (§4)
- **Q2 — chance-based yields.** Use the expected value of the sourced
  distribution rather than excluding the row: drop rates, harvest ranges, burn
  chances and loot rolls are all allowed, and the row is labelled `EV`. (§3.1)
- **Q3 — Sailing.** Released 19 November 2025 and already in the shop-access
  table (`scripts/shopAccessRules.ts`, docking levels 45–67). It is scanned like
  any other skill, in Phase 2.
- **Q4 — combat. ANSWERED: out of scope, permanently.** Attack, Strength,
  Defence, Ranged and Hitpoints are not scanned and are not a parked phase: a
  kill is monster drops × kill rate, so it needs a drop-table × kill-rate engine
  with its own sourced rates, not the recipe/EV join on this page. Slayer's own
  recipes are already priced (§8.16); Slayer *monsters* are combat and are out
  with the rest.
- **Q4b — minigames. ANSWERED: in scope, Phase 4.** Skilling bosses and
  minigames are queued rather than excluded (§5). Their row is a round of put-in
  and a loot table out, which the existing `kind: 'ev'` and `distribution`
  fields already express; the work is sourcing a round time and a reward table
  per minigame, not building an engine.

### Still open

- **Q5 — overlap with `#/processing`.** ~300 of the Phase 1 rows are the same
  actions. Duplicate them under Skilling, or make Skilling the superset and
  leave Processing as the GE-flip view?
- **Q6 — alternative output channels. ANSWERED: GE only.** No high-alch and no
  shop-sale channel anywhere on the skilling page. Every row is "buy the inputs on
  the GE, sell the output on the GE, pay the GE tax", which is the same contract
  `#/processing` already has. Rows where a shop or an alch would pay more are
  therefore understated *by design*, and the page must not hint otherwise — see
  §8.1 for the consequence.
- **Q7 — granularity cap.** Every variant or the profitable subset? Some skills
  have hundreds of near-identical item combos; is a curated top-N per skill
  acceptable, with the cut documented?
- **Q8 — leaderboard. ANSWERED: skilling populates `#/earn`.** `earnings.ts` gains
  a fourth family (`skilling`) and re-plans each row at the player's gold exactly
  like a recipe. Three rules keep the merged ranking honest:
  - **cost-to-train rows never enter it** — they sell nothing, so they cannot earn;
  - a row whose `recipeId` is already in `data/process.json` is **dropped as a
    duplicate** and counted, because one action must not be ranked twice;
  - a row with no published rate is `unranked`, like a recipe without ticks.
  Cooking rows carry their no-burn level in `requirements` (`Cooking 90 to not
  burn`), so the leaderboard says why a monkfish row is only safe at 90.
- **Q9 — farming shape.** Per-patch profit, or a whole herb-run cycle (patches ×
  expected yield × growth time)?
- **Q10 — default view. ANSWERED: instant (`pessimistic`) by default.** The page
  opens on instant buy / instant sell, not on rested offers. Loss-making rows are
  still listed (loss is the answer for most of a skill), but the default mode is
  the pessimistic one. The patient ranking stays in the artifact for a toggle.
  §8.11 records what that default does to the numbers, because it is not neutral.
- **Q11 — Cooking and the chance-based recipes.** The EV decision unblocks
  Cooking and the rows `processRank.ts` currently drops on a `quantitynote` that
  mentions a chance or an average. Do we re-admit those here only, or relax
  `#/processing` the same way? Two answers are defensible; leaving the pages
  disagreeing is not.
- **Q12 — EV sourcing floor. ANSWERED: any published distribution, including a
  level-scaled one, as long as the page publishes both the parameters and the
  formula.** A flat drop rate qualifies, and so does a `{{Skilling success chart}}`
  entry: its `low`/`high`/`req` numbers plus the published success function
  (<https://oldschool.runescape.wiki/w/Skilling_success_chart>) give a probability
  at any level, which is exactly a sourced distribution. What stays refused is a
  rate that exists only as prose — "around 93% at level 1" with no parameters —
  because there is nothing to compute from it (§8.19).

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
| --- | --- | --- |
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
- **High-alch and shop sale are deliberately not output channels** (Q6, decided):
  the page prices GE buy -> GE sell only. That matters for Crafting more than for
  any other skill, because d'hide bodies, battlestaves and most jewellery are
  commonly alched. A row that reads as a loss here may be profitable to a player
  who alchs it, and the page must say so rather than imply the row is dead.

#### Caveats the page must carry

- **Pessimistic mode makes most of the skill look negative.** Instant-buy inputs
  at `high` and instant-sell output at `low` crosses the spread on every action,
  so 190 of 299 Crafting rows lose money. That is a true statement about *that
  execution style*, not about the skill. Patient mode (167 of 301 profitable) is
  the fairer read for a skill where you can batch 27 items and slow-sell.
- **Item upgrades dominate both tails.** Necklace of rupture (millions of gp per
  action either way — −3.7M on the snapshot in §8.11) and Amulet of rancour
  (+682,060 gp per action in patient mode) are one-off conversions of 40M+ items,
  not repeatable training. They are legitimate
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
| --- | --- | --- |
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

**High-alch is not here, by decision.** `High Level Alchemy` produces no item, so
the bucket cannot express it, and Q6 settled that the page is GE-only: alch and
shop sale are not output channels. Alching is the exit for most Crafting and
Fletching output, so a GE-only view understates those rows — the page states that
once, in its caveats, rather than pricing a second channel it does not model.

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

### 8.12 Farming ✅ (the first Phase 2 skill, and why it is thin)

138 bucket recipes name Farming; **12 priced** (5 profitable, 7 loss-making), 8 in
patient mode. All twelve are the **compost economy**: Ultracompost from
supercompost + volcanic ash (176 gp/action), and the bin recipes (Watermelon x30 +
50 ash + 30 buckets -> 30 ultracompost, 6,300 gp per bin action).

The other 126 are unpriced for two structural reasons, both checked rather than
assumed. Neither is a data problem in the usual sense, which is why this is the
first skill where Phase 1's method runs out.

**1. Crop harvesting is not in the recipe bucket.** There is no
`Ranarr seed -> Grimy ranarr` row at all. The bucket's Farming recipes are the
nursery and the compost bin, not the patch. So the thing a player means by
"Farming money" — plant a herb, harvest five to nine of them after 80 minutes — has
no source row. Modelling it needs three things this project does not yet have:
growth timers per crop (a game constant, easy), the **expected harvest yield** per
crop (level- and compost-dependent: an EV, §3.1), and an answer to Q9 — per patch,
or a whole multi-patch run. Without all three the row would be an invented number.

**2. The nursery is a chain through untradeable items.** This is the interesting
one. Every sapling recipe looks like this:

```text
Acorn + Filled plant pot  ->  Oak seedling        (untradeable)
Oak seedling              ->  Oak seedling (w)    (untradeable)
Oak seedling (w)          ->  Oak sapling         (tradeable, GE #5370)
```

The bucket has each step as its own recipe, and the engine prices one recipe at a
time, so both ends fail: the seedling recipes have no sellable output, and the
sapling recipe has no buyable input. Correctly — a row that ignored the acorn would
be a fantasy — but it means the tradeable sapling market is invisible to the site.

Unlocking it is a **chained-recipe** feature: walk back through untradeable
intermediates, sum the leaf costs (Acorn + filled plant pot), keep the final
tradeable output, and expose the chain in the row (`Acorn -> Oak sapling, via two
untradeable steps`). That is a real engine addition, not a curation entry, and it
would also cover the Crafting cases where an intermediate happens to be tradeable
today but might not always be.

Everything else here is already right: the compost rows price cleanly because every
leg is tradeable, and the construction plants (hedges, topiary) stay unpriced
because house plants have no market at all.

### 8.13 Sailing ✅ — the second Construction

153 bucket recipes name Sailing; **124 priced, and every one is a cost** (124
`train` rows, 0 profitable), 119 in patient mode.

The first pass priced **nothing at all** — 0 of 153 — and the mapping says why:
every Sailing recipe output is absent from the GE run (`Bronze cannon`, `Iron keel`,
`Camphor hull`, `Blue sail`, `Bronze salvaging hook`, `Oak cargo hold`, the
trawling nets). Boat parts are installed on your own boat and cannot be sold. What
*is* tradeable is the intermediate stock — `Bronze keel parts`, `Camphor hull
parts`, `camphor plank`, `ironwood plank` — which the recipes consume.

So Sailing is the same shape as Construction, and adding it to `TRAIN_SKILLS`
turned 124 silent refusals into the cost table the skill actually needs:

| Build | Cost / action | Cost / hour |
| --- | --- | --- |
| Wooden hull (hull parts ×10 + 300 bronze nails + tar) | −1,660 gp | −830 |
| Shark trim (2 shark paint) | −6,990 gp | −3,495 |
| Oak hull (16 large hull parts + 600 iron nails) | −26,499 gp | −13,249 |
| Dragon keel (16 large dragon keel parts + cupronickel) | −6,009,876 gp | −7.5M |
| Rosewood hull (… + dragon nails + cupronickel) | −5,166,095 gp | −7.7M |

The 29 unpriced rows are the ones whose inputs are themselves untradeable
(paint, facilities built from quest items).

**What Sailing does not model, and cannot from this source:** sailing's actual
income is salvage (chance-based loot rolls), port tasks and chum — none of which is
a recipe, and all of which need a sourced distribution before they can be priced
under §3.1. Until then Sailing is honestly a cost skill, like Construction.

**Multi-skill recipes now appear twice in the artifact** — 164 recipe ids are
reachable from two skills (`String Jewellery` is Magic *and* Crafting; the hull
parts are Sailing *and* Construction). That is correct for a per-skill listing and
wrong for a leaderboard, so `buildEarnings` now deduplicates within the skilling
family as well as against processing: one action, one margin, counted once.

### 8.13b Sailing's salvage: checked line by line, still refused

§8.13 left Sailing as a cost-only skill with one open question: salvage is its
income, so can it be priced? The answer is no, and the reason is now measured rather
than assumed.

The loot lives on the **salvage item** pages (`Small salvage`, `Fishy salvage`,
`Barracuda salvage`, `Large salvage`), each with a `{{Sailing info}}` block and a
`{{DropsLineSkill}}` table whose rarities do add up to one roll:

| Page | Lines | Ranged quantities |
| --- | --- | --- |
| `Small salvage` | 22 | **8** |
| `Fishy salvage` | 24 | **6** |
| `Barracuda salvage` | 22 | **5** |
| `Large salvage` | 23 | **8** |

Every table mixes fixed drops with ranged ones — `Bronze nails 1-5`, `Air rune 1-10`,
`Bronze cannonball 2-7`, `Coins 1-200` — and the wiki publishes no weights for those
ranges. That is the same refusal `ev.ts` makes of `Potato seed 1-4` and of Zalcano
(§8.20): a range without weights has no expectation, and averaging it would invent a
distribution. Refusing the whole table is deliberate; pricing the fixed remainder
would silently delete the largest outcomes.

There is also **no published sort time**. `Sort-salvage` is an option on the
`Salvaging station` scenery, whose page publishes coordinates and an examine line but
no interval, and `Sorting` is a transcript with no table. So even a clean reward
table would have no rate — the same "per attempt, no hour" shape fishing has (§8.19),
except that fishing at least has the distribution.

**What would unblock it:** per-quantity weights (or a published average) for the
ranged lines, plus a sourced sort interval. Until then Sailing stays honestly a cost
skill, and the page says so: its 124 rows are all `Cost`, and the skill filter shows
the count next to the name so a cost-only skill cannot look absent.

### 8.14 Phase 2 complete: Mining, Woodcutting, Fishing, Hunter, Thieving

All five are scanned. Together they priced **7 rows**, which is the point of this
section: Phase 2 is not a data gap to be closed with more effort, it is a **source**
gap. The recipe bucket answers "what does item A become?", and a gathering skill
never asks that question — a rock is not a recipe.

| Skill | Bucket recipes | Priced | Why the rest are not |
| --- | --- | --- | --- |
| Mining | 2 | 0 | both untradeable at one end |
| Woodcutting | 27 | 3 | the bucket holds Forestry/ritual side-actions, not tree chopping |
| Fishing | 18 | 0 | all 18 outputs untradeable (mounted trophies, infernal harpoon) |
| Hunter | 5 | 4 | only the Varlamore fur-crafting line is a recipe |
| Thieving | 0 | 0 | the bucket has nothing at all for the skill |

**Mining — 2 recipes, 0 priced.** `Infernal pickaxe` (output untradeable) and
`Pure essence ×5` from tainted essence (input untradeable). There is no
`Runite ore ← runite rock` row anywhere in the bucket, so "ore per hour" cannot be
built from it by any amount of curation.

**Woodcutting — 27 recipes, 3 priced.** `Split log` (56 gp), `Neitiznot shield`
(135 gp) and `Secateurs attachment` (−770 gp). The other 24 are the Forestry and
Varlamore ritual side-actions — `Forester's ration` (cooked chicken + leaves),
`Nature offerings` (ritual mulch + herb), `Clothes pouch` — plus untradeable
`Infernal axe`. Useful rows, all of them secondary: chopping a yew has no recipe.

**Fishing — 18 recipes, 0 priced.** Every output is untradeable: eleven mounted
fishing trophies and the infernal harpoon. Zero rows about catching fish.

**Hunter — 5 recipes, 4 priced, all losses.** `Mixed hide boots/legs/top/cape` from
Varlamore furs plus a 17.5k–20k coin fee, between −1,957 and −8,624 gp per action.
The net trap is untradeable. **Note:** these four rows are the same recipes Crafting
already carries (`Mixed hide boots` was a profitable Crafting row at 2,218 gp
earlier in the scan), which is exactly the multi-skill duplication §8.13 now
deduplicates on the leaderboard.

**Thieving — 0 recipes.** Not one. Pickpocketing and stalls are loot tables, not
transformations.

#### What Phase 2 actually needs

Under §4 an activity whose profit only exists as a rate is skipped, and all five of
these are exactly that: ore/logs/fish/catches per hour. Even after building the
rate, there would be no row to put it on, because the bucket has no gathering
recipe at all.

So Phase 2 needs a second data source and a second row shape:

1. **A gathering model per activity** — node respawn time or click interval, yield
   per action, and how both scale with level. Some of that is a game constant
   (respawn timers), some is level-scaled (`§3.1` EV territory).
2. **A row kind for it.** `transform` means "buy inputs, sell output"; a gather has
   no inputs, so it needs something like `gather` with `inputs: []` and a
   time-based yield. The current engine prices an action; a gather row prices an
   hour.
3. **A decision on §4.** If the answer is still "skip rate-only activities", then
   Mining, Fishing and Thieving stay at zero rows permanently, and the plan should
   say so instead of listing them as pending work.

None of that is impossible — it is simply not the recipe bucket's job, and no
amount of scanning will change that. Phase 2's honest status is: **scanned,
nothing to price, needs a new source and a new row kind.**

### 8.15 The gathering model (Mining and Woodcutting)

§8.14 said Phase 2 needs a second source. This is it, for the two skills where the
wiki publishes a constant: **the respawn time**.

Every ore and log page carries a `{{Mining info}}` / `{{Woodcutting info}}`
template with `level`, `xp`, the node name and `|time=` — and the prose states what
that is ("after runite rocks are mined, it will take twelve minutes until it
reappears"). `src/api/wikiGathering.ts` reads those parameters **by key** through
the same batched page fetch the stackability reader uses, one request per 50
pages, 24h cache. `scripts/gatheringNodes.ts` says which 27 pages to read; four
candidates have no such block and are listed there as excluded.

The row: **one unit per respawn, no inputs**. `secondsPerAction` is the respawn,
`profit = price − GE tax`, and `gp/hour` is what a single uncontested node
sustains. `kind: 'gather'` is the fourth row kind, with its own badge.

| Node | Respawn | gp/action | gp/hour |
| --- | --- | --- | --- |
| Runite ore | 720s | 9,738 | 48,690 |
| Copper ore | 2.4s | 24 | 36,000 |
| Iron ore | 5.4s | 49 | 32,659 |
| Coal | 30s | 121 | 14,520 |
| Loganberry → Arctic pine logs | 8.4s | 565 | 242,103 |
| Yew logs | 59.4s | — | 18,780 |

Mining: **11 gather rows** (plus the 3 recipe rows), Woodcutting **14**.

Two parsing traps worth recording, both of which bit during implementation:

1. `time` carries **alternatives** separated by `<br>` — `12 minutes<br/>6 minutes
   in Mining Guild`. The guild branch needs a guild and a diary, so the **slowest**
   branch is the one priced. A compound inside one branch (`1 minute 30 seconds`)
   is summed instead. Taking the longest number in the whole cell would have priced
   runite at 6 minutes; summing everything would have added the two branches
   together.
2. A regex escape written through a shell pipeline arrived as a literal backspace
   character, which made `//` match nothing and silently emptied the parser. The
   pattern now has no trailing boundary at all, and the reason is in the code.

**What this still does not model**, all of it stated on the page: competition (so
the rate is an upper bound), the mining/chopping *time* itself (the wiki publishes a
depletion curve — runite is 19/256 per 3 ticks at 99 — which is level- and
axe-dependent, and adding it to the respawn would double-count the same wait), and
multi-node rotations, which beat a single node's respawn and need a run model.

Fishing, Hunter and Thieving are untouched by this: their rate depends on a
success chance or a loot distribution, which is the EV work in §3.1, not a respawn
constant.

### 8.16 Phase 3 complete: Prayer, Firemaking, Agility, Slayer

Eleven rows between the four, and the split is instructive: two of these skills
price a *real* activity, two price nothing at all.

| Skill | Recipes | Priced | What priced, and what did not |
| --- | --- | --- | --- |
| Prayer | 32 | 3 | blessing unblessed symbols; heraldic armour is untradeable |
| Firemaking | 32 | 8 | pyre logs (logs + sacred oil); burning has no output |
| Agility | 1 | 0 | a single recipe, untradeable at both ends |
| Slayer | 13 | 0 | mounted head trophies, all untradeable |

**Prayer** prices the one thing Prayer actually produces for sale: `Holy symbol ←
Unblessed symbol`, 205 gp an action, twice (two recipe variants). Its other 29
recipes are heraldic and painted armour — Guthix/Saradomin/Zamorak helms,
kiteshields and banners — which are untradeable. Offering bones at an altar has no
recipe at all: the bone is consumed for experience and produces nothing, so there is
no output to price.

**Firemaking** prices pyre logs, which is genuine Firemaking work: `Yew pyre logs ←
Yew logs + Sacred oil(4)` at 233 gp, and seven more, from 69 to 458 gp. Ironwood
pyre logs lose 1,044. Burning a log produces no item, so the skill's main loop is
invisible here for the same reason as Prayer's.

**Agility** has exactly one recipe in the bucket — `Snake basket full` — untradeable
in and out. Laps, marks of grace and the rooftop courses are not transformations.

**Slayer** has 13, every one a mounted head trophy for the player's house. Killing
monsters is a loot table, not a recipe.

#### Why the untradeable half was **not** turned into `train` rows

Fifty-ish of these recipes build things you cannot sell, which is the same shape as
Construction and Sailing. They stay unpriced on purpose:

- a mounted basilisk head, a Fire of Eternal Light and a Guthix banner are
  **furniture**, built at a Construction bench. Pricing them as Prayer or Slayer
  training would put the wrong skill on the row and double-count work Construction
  already costs honestly;
- unlike Construction and Sailing, the skill tag on those recipes is incidental —
  the player is building a display, not training Prayer.

The rule that falls out: `TRAIN_SKILLS` holds skills whose **own** product is
untradeable (Construction's furniture, Sailing's boat parts). A skill that merely
*touches* an untradeable item does not qualify.

#### One classification fix this exposed

`Arcane spirit shield` was pricing as a **Prayer** money maker at −2,907,706 gp,
because the bucket tags that recipe with both Smithing and Prayer. It is an upgrade —
a sigil fused into a blessed shield — so it joined the curated upgrade list under
both tags (`scripts/skillUpgrades.ts`) and now reads `Upgrade` in either view.

### 8.17 Expected value: Thieving stalls

§3.1 said a chance-based yield may be priced at its expectation **when the wiki
publishes the distribution**, and the row must say it is an expectation. This is
that rule with code behind it.

The source is the stall pages (`{{Thieving info}}` with `|time=` plus a
`{{DropsLineSkill}}` loot table):

```text
{{Thieving info|name = Bakery stall|level = 5|type = Stall|time = 2.4 seconds}}
{{DropsLineSkill|name=Bread|quantity=1|rarity=5/20|skill=Thieving}}
{{DropsLineSkill|name=Cake|quantity=1|rarity=13/20|skill=Thieving}}
{{DropsLineSkill|name=Chocolate slice|quantity=1|rarity=2/20|skill=Thieving}}
```

`src/domain/ev.ts` turns that into an expectation: `Σ chance × quantity × value`,
where coins count at face value and every other item at its GE sell price less the
tax. `kind: 'ev'` is the fifth row kind, and the row carries its `distribution` so
the page can show what the mean is made of.

**Thieving: 12 rows**, all stalls — tea 102 gp/action (153k/h), crafting stall 98,
scimitar stall 241, gem stall 215 (82% sapphire, 13% emerald, 4% ruby, 1% diamond),
fish stall 32, fur stall 10.

#### The refusals, which are the point

- **Ranged quantities are rejected, not averaged.** `Potato seed 1-4` says four
  outcomes are possible and nothing about their weights; the midpoint would be an
  invented distribution. This is why pickpockets contribute nothing yet — their
  seed drops are all ranges.
- **A table with one unpriced outcome is refused.** Dropping the expensive line
  would understate the row, which is worse than no row.
- **Chances summing above 1 are refused**: that is not one roll. `Silver stall (Port
  Roberts)` fails this.
- **A source with no published action time is refused.** All the Port Roberts stalls
  publish no `time`, so there is no rate to divide by.

#### What was still not EV here (and is now, in §8.19)

This section first said pickpockets "keep their loot in a transcluded or plain
`{{DropsLine}}` table rather than `{{DropsLineSkill}}`". **That was wrong**, and
the correction is worth keeping because it was a parser bug wearing a data
explanation: pickpocket pages do use `{{DropsLineSkill}}`, in a `== Loot ==`
section that sits *after* the `=== Tertiary ===` pet roll, and the parser cut the
page at the first `Tertiary` heading — so it read zero drops and reported a layout
difference instead of its own slice. Three separate problems, all handled in
§8.19: the section address, the `time` field being a **stun timer** rather than an
action time, and ranged quantities.

**Cooking**'s burn curve stays a curated per-level table (the no-burn gate, §8.10).
**Sailing**'s salvage is still unpriced: the `Salvaging` page publishes an average
duration per shipwreck, but what a shipwreck yields is *salvage*, which is sorted
into loot by a second set of tables — a two-stage model, not a drop table.

### 8.18 Banking, for the rows that have a location

§8.17's tea stall read 153,000/h from the stall action alone, which ignored the
fact that a cup of tea occupies a slot. This fixes that, and records what the wiki
does and does not publish.

**Where the coordinates live.** Not in `bucket=map` (that is shop pages only — 587
of 596 shops, and the other 733 mapped pages are music tracks and quests), and not
in the scenery infobox, which for the tea stall says `|map = No`. They are in
`{{ObjectLocLine}}` blocks:

```text
{{ObjectLocLine
|name = Tea stall
|location = [[Varrock]]
|mapID = 0
|plane = 0
|x:3269,y:3410
|mtype = pin
}}
```

One page can carry several (the tea stall has Varrock and the Kourend Castle
courtyard), one block can carry several pins on one line
(`|x:2635,y:8853|x:2638,y:8844`), and `mapID = -1` marks a custom map. So per-source
bank distance **is** sourceable after all: `parseObjectLocLines` reads the pins and
`nearestBankFor` does the same join the shop catalogue uses.

**The time model.** One load is 27 non-stackable units with a slot kept for coins;
a table whose every outcome stacks never banks; the trip is
`2 × tiles × 0.6 + 3s handover`, spread over the load:

```text
effective seconds per action = action seconds + trip seconds / 27
```

Tea stall, 12.3 tiles to the Varrock bank: `2 × 12.3 × 0.6 + 3 = 17.8s` per trip,
`/ 27 = 0.66s` per cup, so **3.06s effective instead of 2.4s — 120,090/h instead of
153,000/h**. Crafting stall 73,500 → 65,876. Twelve of the fourteen stalls have a
pin; the two without charge no walk and say so.

**Gathering nodes, same join.** The item page (`Runite ore`) carries no
coordinates, but its `|rock=` / `|tree=` page does — `Runite rocks` has 39 pins,
`Yew tree` 20, `Iron rocks` 371 — so the join runs over the *node* page and takes the
nearest of its published locations (a player picks the mine closest to a bank).
**17 of 27 nodes** get a distance; the ten without charge none and show `—`.

Mining, before and after: iron ore 32,659 → **26,840/h** (5.4s → 6.57s effective),
copper 36,000 → **20,646/h**, runite 48,690 → **46,374/h** (a 720s respawn dwarfs a
40-tile trip). Woodcutting: teak 25,282 → **21,821/h**, redwood 18,780 → **17,813/h**.

`gp/hour` now uses whole 4h actions (`actions4h x profit / 4`) for both gather and
EV rows, matching the processing engine, so a floored window cannot make the same
row disagree with itself in two places.

**Still charged nothing, and why.** A shop run already models its own distance
(`src/domain/bankTrip.ts`); a GE → shop flip needs none (banknotes). Processing and
the recipe-driven skilling rows name a *facility* — "Furnace", "Range" — and a
recipe works at any of them, so there is no single location to join; `Range` and
`Furnace` pages that do carry pins list many, and picking one would be a guess about
where the player trains. Those rows therefore charge the action time only, which the
page states.

### 8.19 Fishing, Hunter and pickpockets: the success chart as the distribution

The §3.1 rule needed a sourced distribution, and the answer turned out to be one
template used across three skills: `{{Skilling success chart}}`. It carries `low`
(the roll's value at level 1), `high` (at 99) and `req` per option, and the wiki
publishes the function that turns those into a probability:

```text
P(level) = (1 + floor(low*(99-level)/98 + high*(level-1)/98 + 0.5)) / 256,  clamped
```

<https://oldschool.runescape.wiki/w/Skilling_success_chart>. So a chart **is** a
sourced, level-scaled distribution — Q12's open question — and `low` may be
negative (`Carnivorous chinchompa`'s `Red` is −78 at level 1), which the formula
clamps rather than rejecting.

- `src/domain/successChance.ts` — the formula, the cascade
  (`P_i x PRODUCT(1 - P_j)` for `cascade=yes`, best reward first), and
  `chartOptionAtLevel`.
- `src/api/wikiSuccessChart.ts` — the parser. Parameters are addressed **by key**.
- `src/api/wikiParams.ts` — shared top-level-pipe splitting, extracted because of
  the bug below.

| Skill | Rows | With a rate | What makes the row |
| --- | --- | --- | --- |
| Thieving (pickpockets) | 3 | 3 | `Loot` table x success chance, time from `2 + stun x (1 - p)` |
| Hunter | 8 | 0 | guaranteed `Always` drops x success chance; no attempt interval is usable (§ below) |
| Fishing | 5 | 0 | the chart alone; no attempt interval is published |

**Pickpockets.** A pickpocket's loot table describes a *successful* attempt, and the
only `time` on the page is the **stun timer** (`|timename = Stun Timer`), so neither
could be used as-is. The timing model is published on the skill page instead:
"NPCs may be pickpocketed every two ticks (1.2 seconds)", a failure stuns for eight
ticks, so an attempt averages `10 - 8p` ticks
(<https://oldschool.runescape.wiki/w/Thieving#Pickpocketing>). Rows: `Paladin` 118
gp/action at 3.68s (115k/h), `Man` and `Woman` 2 gp/action (2.8k/h) — which is the
useful finding, and it is a real row rather than a missing one.

**Fishing prices the attempt, not the hour, and says so.** Every fishing page that
quantifies anything has a chart, and a cascading chart (`cascade=yes`) is the full
distribution (trout+salmon, barbarian fishing). **No fishing page publishes an
interval between attempts** — `Fishing`, `Fishing spot`, `Barbarian Fishing` and the
spot pages were all checked — so the five rows carry `gpPerHour = null` and the page
shows `—`. `Raw karambwan` 72 gp per attempt, `Raw monkfish` 21, `Raw lobster` 19,
`Raw trout` 14, `Raw shrimps` 9.

**Hunter has no rate, and that is a decision rather than a gap.** `Box trap` states
"an attempt every 3 ticks (1.8 seconds)", which was briefly turned into gp/hour —
`Carnivorous chinchompa` read 506 gp/action and **1.01M/h**. That number is a
single trap's ceiling with an animal already in range: it ignores spawn density,
competition, the walk between traps and how many traps a player runs. Real hunting
yields roughly 600 catches an hour *across five traps*, which is below one trap's
theoretical 914, so the published interval is not the binding constraint. Publishing
1.01M/h would have put an unattainable number at the top of `#/earn`, so the interval
is recorded (`trapAttemptSeconds`) and the row keeps `gpPerHour = null`. Every Hunter
row is therefore "what one catch is worth at this creature's level" — 3,245 gp for a
`Pyre fox`, 506 for a `Carnivorous chinchompa`, 31–40 for the bird snares. Only the
creature's guaranteed drops are priced: a pet roll or a Hunter's-Rumour drop is not
part of a catch and is counted in `coverage.ignoredDrops` (10 today).

#### Four bugs this scan found, all in the parsers rather than the data

1. **Inline templates lost their parameters.** `{{Skilling success chart|...}}` is
   written on one line on some pages and across several on others. Splitting the body
   on newlines read only the first parameter, so every inline chart parsed as "no
   chart" — which reads exactly like "the wiki publishes no chart". The fix is
   `src/api/wikiParams.ts`: split on **top-level** pipes, so a `{{plink|Box trap}}`
   inside `trap=` stays one value.
2. **A chart may hold one option per variant.** The chinchompa chart lists `Grey`
   (req 53), `Red` (63) and `Black` (73); taking the first option priced *grey*
   chinchompa odds for a carnivorous one — 0.676 instead of 0.457. The option is now
   chosen by the page's own level (`chartOptionAtLevel`), falling back to the first.
3. **A chart label is not an item name.** Labels are written for a chart: the shark
   chart says `Harpoon`, the anglerfish chart `Sandworms`, the dark-crab chart
   `Normal`. Fishing therefore refuses a chart unless every label matches an item on
   the page's own `{{DropsLineSkill}}` table (`matchChartToTable`), following
   `|spot =` to the page that publishes that table. That is what rejects five
   otherwise-plausible methods rather than pricing a harpoon.
4. **Several `Always` lines are not one roll.** `ev.ts` refused any table summing
   above one, which rejected `Paladin` (80 coins *and* 2 chaos runes per pickpocket)
   and every creature that drops bones + fur + meat. Guaranteed lines are now counted
   individually and only the probability lines must fit inside one roll. A *ranged*
   quantity still refuses the row, and a dropped line refuses it too: pricing the
   readable remainder of `Vyre` (coins 230-315, the biggest outcome) would be worse
   than no row.

`SkillCoverage.ignoredDrops` was added for (4)'s counterpart, so the page can state
how many table lines an expectation leaves out.

Sandbox note for the next reader: `data/skilling.json` is now 7.9 MB raw and the
`#/skilling` + `#/earn` chunk is 3.67 MB (390 kB gzip). The slimmer `earn` projection
described in §9 is now the largest single win available on the site.

### 8.20 The Blast Furnace: an overlay, not a recipe

`#/processing` already priced nine Blast Furnace bars, because the bucket carries the
Blast Furnace variant of each bar recipe — **half the coal** of a normal furnace
(steel is 1 coal + 1 iron ore, not 2). What it priced was wrong in two ways, and the
second was invisible:

- **The rate.** The bucket's `ticks` is the per-item process time. At the Blast
  Furnace the dwarven workers smelt bars **concurrently**, so the wiki's own table
  gives steel 2,900–3,400 bars/hour where the bucket's 11 ticks imply 545. The page
  was understating by a factor of five.
- **The fee.** Nothing charged it. Themed worlds take 72,000 gp/hour into the coffer
  (1,200/minute, 12 gp per tick).

So a minigame is not a new recipe and not an EV table: it is an **overlay** on
recipes that already exist (`src/domain/minigame.ts`), applied inside `rankProcess`
so `#/processing` and `#/skilling` cannot disagree about a bar.

| Reading | Value | Why |
| --- | --- | --- |
| Throughput | lower bound of the published range | 2,900 not 3,400: the same pessimistic reading the gathering model takes of a respawn table |
| Coal-bag columns | not used | they are faster and gear-dependent; the "Default" column is the plain case |
| Gold-gauntlets / cape / hybrid rows | not priced | they describe a different method, not this bar |
| Fee per action | `ceil(72,000 / actionsPerHour)` | the fee is per tick, so it is fractional per bar; rounding up keeps the row conservative and keeps money integer |
| `ticks` | `null` | the rate no longer comes from the tick count, and a stale tick next to a published rate would be a lie |

Steel bar at today's prices: 298 gp profit per bar after a 25 gp fee, 2,900 bars/hour,
**864,200 gp/hour** — a row the site previously reported as 175,570.

The overlay also makes a stale curation visible: `refresh-process.ts` checks every
curated `facility|item` key against the bucket and warns when one matches no recipe,
so a renamed bar cannot silently stop being priced.

#### The full survey: 29 pages read, one minigame priced

Every minigame a player would look for was checked, and each was read on its own page
or on its reward page. A row needs **both** halves — a reward distribution with exact
quantities and published chances, and a published rate — and one of the two fails
everywhere except the Blast Furnace.

| Group | Minigames | Which half fails |
| --- | --- | --- |
| Reward table exists, quantities do not | Zalcano (21/26 ranged), Wintertodt crate (63/75), Hallowed sack (20/30), Rewards Guardian (13/44, priced in abyssal pearls), Fishing Trawler (18/23 `Varies`/`Varies`), Tempoross pool | the distribution: a range or `Varies` with no weights has no expectation |
| Point shops | Volcanic Mine, Tithe Farm, Pest Control, Nightmare Zone, Barbarian Assault, Mage Training Arena, Soul Wars, Castle Wars, Last Man Standing, Bounty Hunter | the rate: a reward costing 1,000 points is not an hourly figure unless something publishes how fast points arrive |
| Fees or commissions | Mahogany Homes, Giants' Foundry | both: a `train`-shape row needs the material cost **and** contracts/rounds per hour |
| Nothing tabulated | Pyramid Plunder, Trouble Brewing, Rat Pits, Fist of Guthix, Stealing Creation, Blast Mine | no reward table at all (Blast Mine publishes XP/hour, not profit, and its ores already price as gather rows) |

The Blast Furnace is the only entry with a published throughput **and** a published
fee, which is why it is the only one with an overlay. `scripts/minigameSources.ts`
carries that list with one sentence per minigame, and `tests/minigame.test.ts` asserts
it covers the set and that the priced list stays at exactly one — so a future
minigame cannot be added by quietly widening the prices without a source.

#### Zalcano: the clearest refusal

**Zalcano** is the clearest refusal on the whole page. Every line of its drop table is
a **ranged quantity** — `Blood rune 64-480`, `Silver ore 86-800`, `Runite ore 3-31` —
and the article publishes no weights for those ranges, so there is no expectation to
compute; the midpoint would be an invented distribution, which is the same refusal
`ev.ts` makes of `Potato seed 1-4`. Its loot is also a damage-contribution share with
no published kills-per-hour, so even a clean table would have no rate.

The rest are refused for the same reason in either half, and `scripts/minigameSources.ts`
lists each with its own sentence: Wintertodt and Tempoross (no fixed-quantity crate
table, no rounds/hour), Guardians of the Rift (rewards cost abyssal pearls, and neither
pearls-per-round nor the pearl price is published), Volcanic Mine and Tithe Farm (point
rewards, no points/hour), Mahogany Homes and Giants' Foundry (contract fees, no
contracts/hour).

That is a deliberate outcome, not an unfinished one: under §4 a figure is sourced or
it is absent, and a minigame row needs **both** halves — a published reward and a
published rate.

### 3.1b An outcome with no market counts as 0 gp (operator decision)

When a loot line's item has **no GE market** — `gemw=no` on the template, or simply
absent from the item mapping — the line is now valued at **0 gp** instead of refusing
the whole row. The alternative is what kept Zalcano off the page: its guaranteed
`Crystal shard` has no GE entry, so the entire table was refused.

What keeps this honest:

- the line still appears in the row's `distribution`, with `unpriced: true` and
  `expectedGp: 0`, and the page's tooltip reads `Crystal shard ×2 — 100% (no GE market,
  counted as 0 gp)`, with `· 2 at 0 gp` on the row itself;
- so the row's mean is a **floor**: the item has value, this site just cannot price it;
- a table where **nothing** has a market is still refused, because a mean of 0 there
  would say the loot is worthless rather than "we know no prices for any of it".

### 8.21 Minigame payouts: reading `{{DropsLine}}` tables

The bucket only knows recipes, so a boss or minigame payout needed its own source:
`src/api/wikiLootTable.ts` reads `{{DropsLine}}` and `{{DropsLineReward}}`, keeps each
table's **heading path**, and groups consecutive tables into **rolls** — a group that
adds up to 1.0. That grouping is checked against the sum, so a mis-curated page becomes
a warning rather than a wrong number.

Three shapes came out of it, and they are why the parser is worth having:

| Page | Structure | Outcome |
| --- | --- | --- |
| `Hallowed sack` | three tiers, each four tables summing to 1.000 | **3 rows priced** (low/mid/high), one sack each |
| `Zalcano` | `100%` (two `Always`) + `Runes` 0.167 + `Materials` 0.833 = one roll | **refused today**: its guaranteed `Crystal shard` drop has no GE mapping, and one unpriced outcome refuses the table |
| `Supply crate (Wintertodt)` | `Unique` 0.064 + `Other` 0.280 | refused: no per-crate roll at all, because contents scale with points |

Every row is `secondsPerAction: null`. No minigame page publishes kills, rounds, sacks or
crates per hour, so the row is a per-action expectation with `gpPerHour = null` — the
same shape as every fishing method (§8.19), and the page shows `—` for the hour. That is
the deliberate split: the **distribution** is now sourced (with ranged quantities at
their published midpoint, §3.1a), and the **rate** is not invented.

`scripts/lootTableSources.ts` holds the curation: four rows (Zalcano, three sack tiers)
and six refusals, each with the measured reason. `tests/lootTable.test.ts` pins the
three readings above — including that a table summing to 1.167 is refused rather than
priced, which is the check that caught a wrong fixture while this was being built.

### 8.11 The instant default, and why the page must own it

Q10 settled that `#/skilling` opens in **instant** mode (buy at `high`, sell at
`low`, pay the tax) and Q6 settled that there is **no alch and no shop-sale
channel**. Both are deliberate and both cost coverage. Here is what the page will
actually show at the moment of writing, from the artifact as generated:

| Skill | Instant rows | Profitable | Loss-making | Best instant row |
| --- | --- | --- | --- | --- |
| Smithing | 230 | 60 | 170 | Rune plateskirt 1,218 gp (923k/h) |
| Crafting | 299 | 109 | 190 | Diamond necklace 270 gp (540k/h) |
| Fletching | 238 | 41 | 197 | Diamond bolt tips 522 gp (626k/h) |
| Herblore | 140 | 40 | 100 | Sacred oil(4) 2,782 gp (934k/h) |
| Magic | 146 | 68 | 78 | Ring of recoil 993 gp (1.99M/h) |
| Runecraft | 51 | 17 | 34 | Blood rune 322 gp (1.93M/h) |
| Construction | 756 | 2 | 754 | Large teak hull parts 3,516 gp (17.6k/h) |
| Cooking | 47 | 16 | 31 | Monkfish 63 gp (205k/h) |

Three consequences the page has to carry, none of which are negotiable if the
numbers are to stay honest:

1. **Instant pricing crosses the spread on every action**, so 84% of Fletching and
   99.7% of Construction read as losses. That is a true statement about instant
   execution, not about the skill — the loss column is the *cost of impatience*.
   It must be labelled that way, not hidden and not "fixed" by defaulting to
   patient.
2. **Some rows are genuinely a cost** — Construction builds furniture that cannot
   be sold (`kind: 'train'`), so its 754 losses are the cost of training, not a
   failed flip. The table needs the kind, or those rows are nonsense.
3. **GE-only understates alchable output.** D'hide bodies, battlestaves and most
   jewellery are alched in practice. A row that reads −1,663 here may be fine for
   a player who alchs. The page says this once; it does not price a second channel.

The `upgrade` split is what keeps the instant ranking readable: it does not change
a single number, only which rows are allowed to sit next to each other.

What the default does **not** change: the artifact still carries both modes, so a
patient toggle is a UI-only change later. Nothing needs regenerating for it.

## 9. Phase 1 complete (8 of 8 skills)

| Skill | Status | Rows |
| --- | --- | --- |
| Smithing | ✅ §8.3 | 230 |
| Crafting | ✅ §8.1 | 299 |
| Fletching | ✅ §8.2 | 238 |
| Herblore | ✅ §8.8 | 140 |
| Runecraft | ✅ §8.5 | 51 |
| Construction | ✅ §8.6 | 756 |
| Magic | ✅ §8.9 | 146 |
| Cooking | ✅ §8.10 — gated on the player's Cooking level | 47 |

**2,098 activities priced from 4,307 bucket recipes, 27 gathering nodes and 14 loot
tables**, with no hand-typed item,
price or rate anywhere: every number is a GE quote joined to the wiki's own recipe
table. The one curated input is the Cooking no-burn table, which is a game
constant read off a wiki page that states it.

What the eight skills taught, in the order it will bite when the page is built:

1. **Three of them are not "profit per hour" skills.** Construction sells nothing
   (`train` rows, §8.6), Runecraft's rate is an altar rate that ignores the run
   (§8.5), and Cooking cannot be priced at all without a burn table (§8.10). The
   page must be able to say "this is a cost" and "this rate is an upper bound",
   not just print a ranked list.
2. **`kind` needed a third value, and now has it.** `upgrade` (curated,
   `scripts/skillUpgrades.ts`, 22 recipes) moves one-off item conversions out of
   the `transform` ranking: Necklace of rupture, Masori (f) x3, rancour, the boots
   crystals, the visage shields, the re-hafted axes. Before it, Crafting's worst
   transform row was a −3.5M rupture conversion in the same sorted list as a 322 gp
   blood rune; after it, the worst is Warrior icon at −1,298 gp, which is a real
   number about a real repeatable action. No value changed — only which rows may
   sit next to each other.
3. **Instant pricing makes almost everything look like a loss** (Fletching 85%,
   Construction 99.7%, Crafting 65%). Patient mode is not a nicety; it is the
   only mode that answers "should I do this?" for a skill you repeat.
4. **Coverage is honest but thin for some skills**: Magic 64%, Herblore 35%,
   Crafting 41%. Every gap I checked was "the input or output is untradeable",
   which is a fact about the game, not about the data.

### The page

`#/skilling` exists (`web/src/Skilling.tsx`): instant mode by default, a patient
toggle, skill + kind filters, search across outputs *and* inputs, paging, and a
Cooking level input that hides foods you cannot yet cook without burning. Rows
carry their kind badge (`Make` / `Upgrade` / `Cost`) and, for cooking, the level at
which the food stops burning. The coverage strip reports activities by kind,
profitable count, and the number of bucket recipes that could not be priced.

The artifact is code-split, but since Q8 it is shared with `#/earn`, so the front
page now pulls it too: 3.0 MB raw / ~350 kB gzip on top of the other three
artifacts. That is the biggest open cost on the site. The fix is a slimmer
projection — `buildEarnings` reads roughly a third of each row (no per-input
`volume4h`, `geBuyLimit`, `marketActions4h` or `timeActions4h`), so a derived
`earn` view of the artifact would cut most of it.

### Next

Phase 2 (Farming, Mining, Woodcutting, Fishing, Hunter, Thieving, Sailing) is the
hard half: those skills have no recipe table, so each one needs its own sourced
time model. Under §4 an activity whose profit only exists as a rate is skipped, so
expect Phase 2 to contribute far fewer rows and to take far longer per row.
