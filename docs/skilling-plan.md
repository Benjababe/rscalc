# Skilling activities — scan plan (provisional)

Status: **plan only, nothing scanned, nothing fetched.** This file is the plan of
record for the `#/skilling` page and gets amended as each skill is scanned.

The page answers: **for this skill, what can I do, what does one action earn or
cost at today's GE prices, and what is that worth per hour?**

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
| `gather` | none (tools are capital, not cost) | item page / skilling tables | node respawn or click interval |
| `collect` (farming) | seed GE buy | patch yield table | patch growth timer (a game constant — the most defensible time model we have) |
| `thieve` | none | loot table | action ticks |
| `train` (loss) | GE buy | none | ticks or run duration |

Facility travel, banking and gear are **not** modelled in v1 (same exclusion the
processing page makes); they are documented as a known understatement of time.

## 4. Time model — three tiers, in priority order

1. **Sourced action time** (recipe ticks, growth timer, published respawn):
   `profitPerHour` is a computed number.
2. **Player rate**: an "Actions / hour" input, seeded empty. A row priced this
   way is labelled *your rate*, never presented as sourced.
3. **Unknown**: `profitPerHour = null`, UI shows `—`, and the row still shows
   its per-action profit/loss.

Tier 2 is what keeps gathering skills usable without inventing a rate. It is the
same escape hatch the processing page already has (`maxActionsPerHour`).

## 5. Skill list to scan, one at a time

Ordered so each phase reuses the previous phase's data plumbing. Rough row
estimates are for sanity-checking the output, not targets.

### Phase 1 — `transform` (recipe-backed; extend what exists)

| # | Skill | Expected work |
|---|---|---|
| 1 | Smithing | verify 61 rows, add bars→items the bucket misses, cannonball |
| 2 | Crafting | verify 93 rows (largest), glass, jewellery, battlestaves |
| 3 | Fletching | verify 37, add unstrung/string/dart-tip split, broad bolts |
| 4 | Herblore | verify 41, potion finishing vs unfinished, cleaning |
| 5 | Runecraft | verify 15, add essence→rune with altar multipliers, combination runes |
| 6 | Construction | planks + sawmill fee, butler cost, flatpack vs furniture (may be loss-only) |
| 7 | Magic | verify 69, add high-alch as an **output channel** (see Q5), spell costs |

### Phase 2 — gathering and collection (new sources, best time models)

| # | Skill | Time source | Risk |
|---|---|---|---|
| 8 | Farming | growth timer | yields are level/compost dependent → range or single sourced row |
| 9 | Mining | rock respawn / mining time | level- and pickaxe-dependent |
| 10 | Woodcutting | tree respawn | level-dependent log count |
| 11 | Fishing | fishing spot rate | level- and spot-dependent |
| 12 | Hunter | trap timer | catch chance → expected value needed |
| 13 | Thieving | pickpocket ticks | success chance + loot table |

### Phase 3 — loss / cost-of-training (`kind: train`, negative gp)

| # | Skill | Note |
|---|---|---|
| 14 | Prayer | bones → altar/chaos altar; always negative, that is the point |
| 15 | Firemaking | logs burned; Wintertodt excluded until Q2 is answered |
| 16 | Agility | marks of grace as the only output; otherwise pure cost |
| 17 | Slayer | needs monster model — see Q3, may be deferred |

### Phase 4 — needs an explicit decision before any scanning

| # | Skill | Why it is parked |
|---|---|---|
| 18 | Cooking | burn chance violates the deterministic-only rule; either exclude or model the burn curve |
| 19–23 | Attack, Strength, Defence, Ranged, Hitpoints | profit is monster drops × kill rate — a different engine, not a recipe |
| 24 | Sailing | scope depends on release status (Q7) |
| — | Minigames / skilling bosses | Wintertodt, Tempoross, Guardians of the Rift, Zalcano, Blast Furnace, Mahogany Homes: all loot-roll based |

## 6. Per-skill scan contract (what "done" means for one skill)

1. Enumerate the skill's repeatable actions from its own wiki pages (not from a
   Money making page).
2. For each: inputs, outputs, quantity, fee, level, members, source URL.
3. Classify determinism. Chance/range/scaling → excluded or ranged, never averaged.
4. Add rows to `scripts/skillActivities.ts` (curated + cited, compiler-checked,
   same pattern as `scripts/shopAccessRules.ts`), **or** to the recipe path when
   the bucket already publishes it.
5. `scripts/refresh-skilling.ts` joins `data/market.json` and writes
   `data/skilling.json`; tests pin the join, the tax, the caps, the null-time
   rule and the ordering.
6. Report to the operator: rows added, rows excluded and why.

## 7. Open questions (blockers for Phase 1, item 1)

1. **Time model authority.** Accept the three tiers in §4, with the player rate
   labelled as such? Without tier 2, phases 2–3 are mostly `—` for gp/hour.
2. **Chance-based yields** (farming harvest ranges, trap catches, thieving
   stalls, loot crates): exclude outright, or publish a sourced min/max range?
3. **Combat and Slayer** monsters: in or out of this page?
4. **Overlap with `#/processing`.** ~300 of the Phase 1 rows are the same
   actions. Duplicate them under Skilling, or make Skilling the superset and
   leave Processing as the GE-flip view?
5. **Alternative output channels.** Some gathering output is worth more to a shop
   or as a high-alch than on the GE. Include alch (nature rune cost, fire staff)
   and shop-sale as per-row channels, or GE only?
6. **Granularity cap.** Every variant or the profitable subset? Some skills have
   hundreds of near-identical item combos; is a curated top-N per skill
   acceptable, with the cut documented?
7. **Sailing** and the exact skill list for the current game version.
8. **Leaderboard.** Does `#/skilling` stay a standalone page, or do its rows feed
   `earnings.ts` in a later commit?
9. **Farming shape.** Per-patch profit, or a whole herb-run cycle (patches ×
   yield × growth time)?
10. **Default view.** Show loss-making rows (cost to train) by default, or hide
    behind a filter? "Profit/loss" suggests they are wanted.
