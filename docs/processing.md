# Item processing — sourced reference

The processing page answers: **buy an item on the Grand Exchange, transform it,
and sell the result back to the Grand Exchange — is the result worth more than
the inputs after fees and tax, and how much can the market absorb?**

The worked example is cleaning a grimy herb:

- <https://oldschool.runescape.wiki/w/Avantoe>
- <https://oldschool.runescape.wiki/w/Grimy_avantoe>

Everything below is sourced. Where the source does not publish a value, the
engine stores `null` and the UI shows `—`; it never invents a processing rate.

## 1. Recipe source

Recipes come from the wiki's own structured bucket:

- <https://oldschool.runescape.wiki/w/Special:Bucket?bucket=recipe>
- <https://oldschool.runescape.wiki/w/Template:Recipe>
- <https://oldschool.runescape.wiki/w/Module:Recipe>

`Module:Recipe` writes one `production_json` object per recipe. The bucket has
ten columns, verified live:

```text
page_name, page_name_sub, uses_material, uses_tool, uses_facility,
is_members_only, is_boostable, uses_skill, source_template, production_json
```

The parser is `src/api/wikiRecipes.ts`. It addresses columns by **header name**,
not index, and zod-validates `production_json`. The bucket is paginated at 500
rows; the full table was 7,855 rows / 16 pages at the last refresh. TTL 24h.

`production_json` looks like this (Bronze bar, normal furnace):

```json
{
  "ticks": "5",
  "materials": [
    { "quantity": "1", "name": "Copper ore" },
    { "quantity": "1", "name": "Tin ore" }
  ],
  "facilities": "Furnace",
  "skills": [
    { "experience": "6.2", "level": "1", "name": "Smithing" }
  ],
  "members": false,
  "output": { "cost": 57, "quantity": "1", "name": "Bronze bar" }
}
```

Two consequences worth stating explicitly:

- **Only the primary output is stored.** `Module:Recipe` puts `output[1]` in the
  JSON. A recipe with a secondary product is therefore priced on its main item
  only; its byproduct is not credited. This is a source limitation, not a
  modelling assumption.
- **`Coins` in `materials` is a fee.** Tanners, sawmills and spells such as Plank
  Make charge coins. The parser keeps them as a material; the engine moves them
  to `feeGp` and never asks for a GE quote.

## 2. Which recipes are included

The page is about **deterministic transformations**, not expected yields.

Included:

- Recipes whose skill list contains at least one of: Herblore, Crafting,
  Smithing, Fletching, Runecraft, Magic.
- Skill-less recipes that name a facility or tool (tanning at a Tannery, plank
  making at a Sawmill). The facility/tool is the evidence that the template is
  describing processing rather than an NPC trade.
- Only recipes where **every material and the output** resolve to a GE item with
  a usable price in the selected mode.

Excluded:

- **Cooking.** Burn chance depends on the player's level and the food, and the
  bucket does not publish a reliable expected yield.
- **Chance/average/level-scaled outputs.** The wiki's `quantitynote` is the
  machine-readable warning. A note matching
  `chance|average|between|depends|scales|random|varies|expected|increases`
  excludes the recipe. Examples:
  - normal-furnace `Iron bar`: “50% chance without ring of forging”
    (<https://oldschool.runescape.wiki/w/Iron_bar>);
  - `Superglass Make`: “On average”
    (<https://oldschool.runescape.wiki/w/Superglass_Make>).
  The Blast Furnace iron-bar variant has no such note and is included; the
  normal-furnace variant is excluded.
- **Fractional quantities.** A quantity like `28.8` is an expected value, not
  one item per action.
- **Unpriced or untradeable items.** If any leg lacks a GE quote, the recipe is
  dropped. The bucket references many quest/minigame items; those recipes are
  visible only as an “unmapped” count in the refresh log.

Skill levels and facilities are shown, but the page does **not** check your
account. Quests, area access, minigame requirements and tool ownership are all
outside the model.

## 3. Prices

Two modes, named from the player's point of view:

| mode | buy inputs | sell output | input volume side | output volume side |
|---|---|---|---|---|
| `pessimistic` (instant) | GE `high` | GE `low` | `highVolume24h` | `lowVolume24h` |
| `patient` | GE `low` | GE `high` | `lowVolume24h` | `highVolume24h` |

This mirrors the buy-side logic in `docs/shop-mechanics.md` §12: an instant buy
takes liquidity from sellers hitting the high side; a resting low offer is filled
by instant sellers. A resting high sell is filled by instant buyers.

The input leg pays no tax. The output leg pays the GE tax:

- 2% of the sale price,
- capped at 5,000,000 gp per item,
- exempt below 50 gp,
- floored to whole gp.

Sources: <https://oldschool.runescape.wiki/w/Tax>.

Per action:

```text
itemCost    = Σ(input price × input quantity)
feeGp       = Σ(Coins quantity)
spend       = itemCost + feeGp
grossRevenue = output price × output quantity
tax          = geTax(output price) × output quantity
netRevenue   = grossRevenue − tax
profit       = netRevenue − spend
```

Tax is charged per item sold, not once on the stack, so multiplying the
per-unit tax by the output quantity is correct.

## 4. Throughput

The 4-hour window is the same one used by the shop pages, because it is the GE
buy-limit window.

```text
volume4h          = floor(volume24h / 6)
inputSupply4h     = min(limit ?? ∞, volume4h)      // limit = GE 4h buy limit
inputActions      = floor(inputSupply4h / inputQty)
outputDemand4h    = floor(outputVolume4h)
outputActions     = floor(outputDemand4h / outputQty)
marketActions4h   = min(all inputActions, outputActions)
```

The **input** buy limit is a genuine purchase cap. The **output** buy limit is
not used: a buy limit caps how many of an item one player can buy, not how many
the market can absorb. Output throughput is the 24h volume slice. See
<https://oldschool.runescape.wiki/w/Grand_Exchange/Buying_limits> and
`docs/shop-mechanics.md` §9.

A zero volume, a zero 4h slice, or a cap smaller than the recipe quantity drops
the recipe in that mode.

## 5. Time

The wiki publishes ticks per action in the recipe template.

```text
secondsPerAction = ticks × 0.6
recipeRate       = 3600 / secondsPerAction
rateUsed         = maxActionsPerHour > 0
                   ? min(recipeRate, maxActionsPerHour)
                   : recipeRate
timeActions4h    = floor(rateUsed × 4)
actions4h        = min(marketActions4h, timeActions4h, budgetActions)
gpPer4h          = actions4h × profit
gpPerHour        = gpPer4h / 4
```

The page shows two action columns:

- **Actions / 4h** — the effective plan, `min(marketActions4h, timeActions4h,
  budgetActions)`.
- **Actions / hour** — the rate used: the recipe's published rate,
  `3600 / secondsPerAction`, capped by the player's **Actions / hour cap**
  (`maxActionsPerHour`; 0 means the recipe rate). The cap can only slow a recipe
  down, so 3,000/hour halves a 6,000/hour recipe but leaves a 1,200/hour recipe
  alone. The cell note shows the effective plan rate, `actions4h / 4`, when GE
  or gold caps reduce it further.

When ticks are unknown, both the raw rate and the effective hourly rate are
`—`; the **Actions / 4h** column still shows the market cap, labelled
accordingly.

- One tick is 0.6 seconds.
- A **zero-tick** action is not instant. `Module:Recipe` uses `1/8` tick because
  eight actions can be performed per tick; the engine follows that:
  `secondsPerAction = 0.6 / 8 = 0.075`.
- A missing, `N/A` or `Varies` tick count is `null`. `gpPerHour` is then `null`
  and the UI shows `—`; it does not copy Module:Recipe's “assume 5 ticks”
  fallback.

**Not modelled:** banking, travel to the furnace/spinning wheel/sawmill, tool
acquisition, and the time between GE offers. `gpPerHour` is therefore a
processing-only ceiling, not a full money-making-guide rate. This is the main
caveat on the page.

## 6. Gold budget

`spend` is the cost of one action, including the Coin fee. The UI caps actions
by the user's available gold:

```text
budgetActions = gold > 0 ? floor(gold / spend) : ∞
actions       = min(marketActions4h, timeActions4h ?? ∞, budgetActions)
```

The gold field is the same `rscalc.budget` value as the Shop → GE and GE → shop
pages. `0` means no cap; a row marked **gold** was cut by the budget rather than
by the recipe or the GE.

## 7. Worked example — cleaning grimy avantoe

Snapshot from the refresh used while this page was built; prices move.

| leg | item | price | quantity | tax | net |
|---|---|---|---:|---:|---:|
| buy | Grimy avantoe | 1,118 (`low`, patient) | 1 | — | −1,118 |
| sell | Avantoe | 1,300 (`high`, patient) | 1 | 26 | +1,274 |

- Profit per action: `1,274 − 1,118 = 156 gp`.
- Herblore level: 48.
- Ticks: `0` → `0.075s` per action.
- Input 4h volume: 54,241; buy limit 13,000 → 13,000 actions.
- Output 4h volume: 34,428 → 34,428 actions.
- Market cap: `min(13,000, 34,428) = 13,000` actions.
- Time cap: `floor(48,000 × 4) = 192,000` actions.
- Effective actions: `13,000`.
- Profit / 4h: `13,000 × 156 = 2,028,000 gp`.
- `gpPerHour`: `2,028,000 / 4 = 507,000 gp`.

With a player **Actions / hour cap** of 1,000, the time cap becomes
`floor(1,000 × 4) = 4,000` actions, so the plan is 4,000 actions and the rate is
`4,000 × 156 / 4 = 156,000 gp/hour`. The cap models slower play; it never
raises the 48,000/hour recipe rate.

In the pessimistic mode the instant-buy price for the grimy herb is higher than
the instant-sell price for the clean herb, so the row is a loss and is absent.
That is why the page has two modes.

## 8. Artifact and commands

```text
data/process.json   recipes for both modes, with inputs, output, fees,
                    per-action economics, market caps and time caps
```

- `pnpm process` — fetch the recipe bucket + prices, write the artifact, print
  the top rows.
- `pnpm process --mode=patient --limit=50`
- `pnpm process --members --skill=herblore`
- `pnpm process --min-profit=100`
- `pnpm process --actions-per-hour=3000` (slower-play cap)
- `pnpm refresh` includes `pnpm process`.

The browser reads only the static artifact; it makes no API calls.

## 9. Known gaps

- **No banking or facility travel.** A recipe that needs a furnace in another
  city, or a bank trip between inventories, is priced as pure processing time.
- **Primary output only.** The bucket drops secondary outputs.
- **Chance and average recipes are omitted**, including all Cooking. A player
  with a high level and the right gear may profit from a recipe this page hides.
- **No access check.** Skill levels are shown; quests, areas, minigames and tool
  ownership are not evaluated.
- **No GE offer-slot scheduling.** Unlike the multi-item baskets, the page prices
  one recipe at a time and assumes the GE fills the 4h slice.
- **Thin markets move.** High-value, low-volume items can have a stale `high` or
  `low`; the market cap is visible so the row can be judged, but the price is
  still a snapshot.
- **Recipe bucket coverage is the wiki's.** A recipe absent from the bucket is
  absent here.
