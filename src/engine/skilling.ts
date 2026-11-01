/**
 * Skilling activities: every sourced action one skill offers, priced per action,
 * **including the loss-making ones**.
 *
 * The processing page answers "buy inputs, transform, sell — what is left?". The
 * skilling page answers the wider question a player actually asks: *for this
 * skill, what can I do, and does it earn or cost me gp?* Training a skill is a
 * cost, and a page that only lists the profitable half is hiding the other 66%
 * of Crafting.
 *
 * Three deliberate differences from `processRank.ts`:
 *
 *  1. **No profit floor.** `rankProcess` defaults to a 1-gp minimum, so
 *     `data/process.json` is profitable-only. Here the floor is turned off so a
 *     negative `profit` is reported as the cost of one action rather than
 *     dropped.
 *  2. **`train` rows.** Some skills produce nothing that can be sold —
 *     Construction's output is furniture standing in the player's house. Those
 *     recipes have no output price at all, so `rankProcess` cannot express them.
 *     For a skill in `TRAIN_SKILLS` this module emits a row with
 *     `kind: 'train'`, `output: null` and `profit = -spend`, i.e. the cost of
 *     one action and the cost per hour of training with it. Nothing is invented:
 *     the materials are still GE prices and the ticks are still the wiki's.
 *  3. **Coverage is reported, not hidden.** For every scanned skill we publish
 *     how many bucket recipes named it and how many could not be priced, so the
 *     page can state its own gaps instead of silently shrinking.
 *
 * The maths, the GE tax, the buy-limit caps and the tick conversion are the same
 * code the processing page uses (`rankProcess` for transforms, the exported
 * helpers for the train path). That is intentional: two pages must never
 * disagree about a recipe.
 *
 * Sources: <https://oldschool.runescape.wiki/w/Special:Bucket?bucket=recipe> and
 * <https://oldschool.runescape.wiki/w/Module:Recipe>.
 */

import type { RawRecipe } from '../api/wikiRecipes.js';
import {
  cooksWithoutBurning,
  noBurnLevelFor,
  type BurnIndex,
} from '../domain/cooking.js';
import {
  actions4hForRate,
  actionsPerHour,
  capActionsPerHour,
  secondsPerAction,
} from '../domain/processTime.js';
import {
  fourHourSlice,
  hasChanceOrAverageNote,
  inputVolume24h,
  isPositiveInteger,
  quoteIndex,
  rankProcess,
  targetInputPrice,
} from './processRank.js';
import type {
  MarketSnapshot,
  ProcessItem,
  SellMode,
  SkillActivity,
  SkillActivityRanking,
  SkillCoverage,
} from '../types.js';

/**
 * Skills with a scanned activity list, in the order they were scanned. Grows one
 * skill at a time — see `docs/skilling-plan.md` for the queue and the method.
 */
export const SKILLING_SKILLS = [
  'Crafting',
  'Fletching',
  'Smithing',
  'Runecraft',
  'Construction',
  'Herblore',
  'Magic',
  'Cooking',
] as const;
export type SkillingSkill = (typeof SKILLING_SKILLS)[number];

/**
 * Skills whose recipes produce an object that cannot be sold, so every row is a
 * training cost rather than a margin.
 *
 * Construction is the case that forced this: its 959 bucket recipes build
 * furniture inside the player's house, which has no GE price and no volume. The
 * only tradeable Construction outputs are the Sailing hull parts, and those
 * already price as normal transforms.
 */
export const TRAIN_SKILLS: ReadonlySet<string> = new Set(['Construction']);

/**
 * A floor low enough that no real recipe can pass it: `rankProcess` compares
 * `profit < minProfit`, so this admits every row including the losses. Written
 * as an explicit constant rather than `-Infinity` because the ranking echoes the
 * filter back into the artifact and `Infinity` is not JSON.
 */
export const NO_PROFIT_FLOOR = -Number.MAX_SAFE_INTEGER;

const GE_WINDOW_HOURS = 4;

export interface SkillActivityOptions {
  skill: SkillingSkill;
  mode: SellMode;
  /** Player-entered actions/hour ceiling; 0 or omitted uses each recipe rate. */
  maxActionsPerHour?: number;
  /**
   * The player's Cooking level, for Cooking only.
   *
   * Cooking rows are kept only when the player's level is at or above the food's
   * published no-burn level, so the margin is deterministic. Omitted means "no
   * level given": the rows are still listed (they are priced at 100% success) but
   * each carries its `noBurnLevel` so the page can gate them itself.
   */
  cookingLevel?: number;
  /** Curated no-burn levels; required to price Cooking at all. */
  burnLevels?: BurnIndex;
  /**
   * Curated upgrade recipes, keyed `skill|output` (lower-cased). A match moves the
   * row from `transform` to `upgrade` so a one-off item conversion is not ranked
   * against a repeatable action. Injected rather than imported so `src/` stays
   * free of `scripts/`; the curated list lives in `scripts/skillUpgrades.ts`.
   */
  upgradeKeys?: ReadonlySet<string>;
}

export interface SkillActivityResult {
  skill: SkillingSkill;
  ranking: SkillActivityRanking;
  coverage: SkillCoverage;
}

function namesSkill(recipe: RawRecipe, skill: string): boolean {
  const needle = skill.toLowerCase();
  return recipe.skills.some((entry) => entry.name.toLowerCase() === needle);
}

/**
 * True when the output has no GE market at all — it is not a tradeable item, so
 * building it can only ever be a cost.
 *
 * The distinction matters: an illiquid *tradeable* output (a heraldic helm, a
 * Vale offering) is a market problem and must stay unpriced, while house
 * furniture is not a market at all. Only the second becomes a `train` row.
 * Absence from the quote index means absence from the GE mapping, because the
 * index is built from every mapped recipe item.
 */
function outputHasNoMarket(
  recipe: RawRecipe,
  quotes: ReturnType<typeof quoteIndex>,
): boolean {
  if (!isPositiveInteger(recipe.output.quantity)) return false;
  return quotes.get(recipe.output.name.toLowerCase()) === undefined;
}

interface TrainBuild {
  activity: SkillActivity | null;
  /** Input had no GE price or no 4h liquidity, so nothing can be said. */
  unpricedInput: boolean;
}

/**
 * Price one recipe as a training cost: the materials are GE prices, the ticks
 * are the wiki's, and nothing is sold.
 */
function trainActivity(
  recipe: RawRecipe,
  quotes: ReturnType<typeof quoteIndex>,
  mode: SellMode,
  maxActionsPerHour: number,
): TrainBuild {
  const quantities = new Map<string, number>();
  let feeGp = 0;

  for (const material of recipe.materials) {
    if (!isPositiveInteger(material.quantity)) {
      return { activity: null, unpricedInput: true };
    }
    if (material.name.toLowerCase() === 'coins') {
      feeGp += material.quantity;
      continue;
    }
    const key = material.name.toLowerCase();
    quantities.set(key, (quantities.get(key) ?? 0) + material.quantity);
  }

  const inputs: ProcessItem[] = [];
  let itemCost = 0;
  let inputActions = Number.POSITIVE_INFINITY;

  for (const [name, quantity] of quantities) {
    const quote = quotes.get(name);
    if (quote === undefined) return { activity: null, unpricedInput: true };
    const price = targetInputPrice(quote, mode);
    if (price === null) return { activity: null, unpricedInput: true };

    const volume4h = fourHourSlice(inputVolume24h(quote, mode));
    const limit = quote.limit ?? Number.POSITIVE_INFINITY;
    const actions = Math.floor(Math.min(limit, volume4h) / quantity);
    if (actions < 1) return { activity: null, unpricedInput: true };

    inputActions = Math.min(inputActions, actions);
    itemCost += price * quantity;
    inputs.push({
      itemId: quote.id,
      itemName: quote.name,
      quantity,
      price,
      volume4h,
      geBuyLimit: quote.limit,
    });
  }

  const spend = itemCost + feeGp;
  if (inputs.length === 0 || spend <= 0 || !Number.isFinite(inputActions)) {
    return { activity: null, unpricedInput: true };
  }

  const seconds = secondsPerAction(recipe.ticks);
  const rateUsed = capActionsPerHour(actionsPerHour(seconds), maxActionsPerHour);
  const timeActions4h = actions4hForRate(rateUsed);
  const actions4h =
    timeActions4h === null ? inputActions : Math.min(inputActions, timeActions4h);
  if (actions4h < 1) return { activity: null, unpricedInput: false };

  const gpPer4h = -actions4h * spend;
  return {
    activity: {
      kind: 'train',
      recipeId: recipe.id,
      output: null,
      outputName: recipe.output.name,
      inputs,
      method: recipe.method,
      facility: recipe.facilities,
      tools: recipe.tools,
      members: recipe.members,
      skills: recipe.skills.map((skill) => ({
        name: skill.name,
        level: skill.level,
      })),
      source: wikiUrl(recipe.page),
      itemCost,
      feeGp,
      spend,
      grossRevenue: 0,
      tax: 0,
      netRevenue: 0,
      profit: -spend,
      marginPct: -100,
      noBurnLevel: null,
      ticks: recipe.ticks,
      secondsPerAction: seconds,
      marketActions4h: inputActions,
      timeActions4h,
      actions4h,
      gpPer4h,
      gpPerHour: timeActions4h === null ? null : gpPer4h / GE_WINDOW_HOURS,
    },
    unpricedInput: false,
  };
}

function wikiUrl(page: string): string {
  return `https://oldschool.runescape.wiki/w/${encodeURIComponent(
    page.replace(/ /g, '_'),
  )}`;
}

/** Total ordering shared by transform and train rows. */
function compareActivities(a: SkillActivity, b: SkillActivity): number {
  if (a.gpPerHour !== b.gpPerHour) {
    if (a.gpPerHour === null) return 1;
    if (b.gpPerHour === null) return -1;
    return b.gpPerHour - a.gpPerHour;
  }
  if (b.gpPer4h !== a.gpPer4h) return b.gpPer4h - a.gpPer4h;
  if (b.profit !== a.profit) return b.profit - a.profit;
  if (b.marginPct !== a.marginPct) return b.marginPct - a.marginPct;
  const aName = a.outputName;
  const bName = b.outputName;
  const byName = aName.localeCompare(bName);
  if (byName !== 0) return byName;
  return a.recipeId.localeCompare(b.recipeId);
}

/**
 * Rank every priced activity for one skill, losses included.
 *
 * `coverage.recipes` counts the bucket rows that name the skill at all;
 * `coverage.unpriced` is the difference between that and what survived. The gap
 * is reported, never filled.
 */
export function rankSkillActivities(
  recipes: readonly RawRecipe[],
  market: MarketSnapshot,
  options: SkillActivityOptions,
): SkillActivityResult {
  const mine = recipes.filter((recipe) => namesSkill(recipe, options.skill));
  const maxActionsPerHour = options.maxActionsPerHour ?? 0;

  const priced = rankProcess(recipes, market, {
    mode: options.mode,
    skills: [options.skill],
    minProfit: NO_PROFIT_FLOOR,
    maxActionsPerHour,
    // Cooking is handled by the no-burn gate below instead of a blanket drop.
    excludedSkills: options.skill === 'Cooking' ? [] : undefined,
  });

  const upgrades = options.upgradeKeys ?? new Set<string>();
  const activities: SkillActivity[] = priced.opportunities.map((row) => ({
    ...row,
    kind: upgrades.has(`${options.skill}|${row.output.itemName}`.toLowerCase())
      ? 'upgrade'
      : 'transform',
    outputName: row.output.itemName,
    noBurnLevel: null,
  }));

  // Cooking: keep only the foods that are deterministic at the stated level.
  // A food with no published no-burn level (or one that still burns at 99) is
  // unpriced — its profit depends on a burn chance we do not have.
  if (options.skill === 'Cooking') {
    const index = options.burnLevels;
    const kept: SkillActivity[] = [];
    for (const row of activities) {
      const level = index === undefined ? undefined : noBurnLevelFor(index, row.outputName);
      // No published level: unpriced. The gap shows up in `coverage.unpriced`.
      if (index === undefined || typeof level !== 'number') continue;
      if (
        options.cookingLevel !== undefined &&
        (index === undefined || !cooksWithoutBurning(index, row.outputName, options.cookingLevel))
      ) {
        continue;
      }
      kept.push({ ...row, noBurnLevel: level });
    }
    activities.length = 0;
    activities.push(...kept);
  }

  let trainOnly = 0;
  if (TRAIN_SKILLS.has(options.skill)) {
    const quotes = quoteIndex(market);
    const alreadyPriced = new Set(activities.map((row) => row.recipeId));
    for (const recipe of mine) {
      if (alreadyPriced.has(recipe.id)) continue;
      if (hasChanceOrAverageNote(recipe)) continue;
      if (!outputHasNoMarket(recipe, quotes)) continue;
      const { activity } = trainActivity(
        recipe,
        quotes,
        options.mode,
        maxActionsPerHour,
      );
      if (activity === null) continue;
      activities.push(activity);
      trainOnly += 1;
    }
  }

  activities.sort(compareActivities);

  let profitable = 0;
  let unknownRate = 0;
  let upgradeCount = 0;
  for (const activity of activities) {
    if (activity.profit > 0) profitable += 1;
    if (activity.gpPerHour === null) unknownRate += 1;
    if (activity.kind === 'upgrade') upgradeCount += 1;
  }

  return {
    skill: options.skill,
    ranking: {
      ...priced,
      opportunities: activities,
      count: activities.length,
    },
    coverage: {
      skill: options.skill,
      recipes: mine.length,
      activities: activities.length,
      profitable,
      lossMaking: activities.length - profitable,
      unknownRate,
      trainOnly,
      upgrades: upgradeCount,
      unpriced: mine.length - activities.length,
    },
  };
}
