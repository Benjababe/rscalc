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
 * Two deliberate differences from `processRank.ts`:
 *
 *  1. **No profit floor.** `rankProcess` defaults to a 1-gp minimum, so
 *     `data/process.json` is profitable-only. Here the floor is turned off so a
 *     negative `profit` is reported as the cost of one action rather than
 *     dropped.
 *  2. **Coverage is reported, not hidden.** For every scanned skill we publish
 *     how many bucket recipes named it and how many could not be priced, so the
 *     page can state its own gaps instead of silently shrinking.
 *
 * The maths, the GE tax, the buy-limit caps and the tick conversion are the same
 * code the processing page uses (`rankProcess`); this module only re-frames the
 * result. That is intentional: two pages must never disagree about what a
 * recipe earns.
 *
 * Sources: <https://oldschool.runescape.wiki/w/Special:Bucket?bucket=recipe> and
 * <https://oldschool.runescape.wiki/w/Module:Recipe>.
 */

import type { RawRecipe } from '../api/wikiRecipes.js';
import type {
  MarketSnapshot,
  ProcessRanking,
  SellMode,
  SkillCoverage,
} from '../types.js';
import { rankProcess } from './processRank.js';

/**
 * Skills with a scanned activity list, in the order they were scanned. Grows one
 * skill at a time — see `docs/skilling-plan.md` for the queue and the method.
 */
export const SKILLING_SKILLS = ['Crafting', 'Fletching', 'Smithing'] as const;
export type SkillingSkill = (typeof SKILLING_SKILLS)[number];

/**
 * A floor low enough that no real recipe can pass it: `rankProcess` compares
 * `profit < minProfit`, so this admits every row including the losses. Written
 * as an explicit constant rather than `-Infinity` because the ranking echoes the
 * filter back into the artifact and `Infinity` is not JSON.
 */
export const NO_PROFIT_FLOOR = -Number.MAX_SAFE_INTEGER;

export interface SkillActivityOptions {
  skill: SkillingSkill;
  mode: SellMode;
  /** Player-entered actions/hour ceiling; 0 or omitted uses each recipe rate. */
  maxActionsPerHour?: number;
}

export interface SkillActivityResult {
  skill: SkillingSkill;
  ranking: ProcessRanking;
  coverage: SkillCoverage;
}

function namesSkill(recipe: RawRecipe, skill: string): boolean {
  const needle = skill.toLowerCase();
  return recipe.skills.some((entry) => entry.name.toLowerCase() === needle);
}

/**
 * Rank every priced activity for one skill, losses included.
 *
 * `coverage.recipes` counts the bucket rows that name the skill at all;
 * `coverage.unpriced` is the difference between that and what survived the
 * engine's own checks (both legs priced, 4h liquidity on both sides, integer
 * quantities, no chance/average note). The gap is reported, never filled.
 */
export function rankSkillActivities(
  recipes: readonly RawRecipe[],
  market: MarketSnapshot,
  options: SkillActivityOptions,
): SkillActivityResult {
  const mine = recipes.filter((recipe) => namesSkill(recipe, options.skill));

  const ranking = rankProcess(recipes, market, {
    mode: options.mode,
    skills: [options.skill],
    minProfit: NO_PROFIT_FLOOR,
    maxActionsPerHour: options.maxActionsPerHour ?? 0,
  });

  const activities = ranking.opportunities;
  let profitable = 0;
  let unknownRate = 0;
  for (const activity of activities) {
    if (activity.profit > 0) profitable += 1;
    if (activity.gpPerHour === null) unknownRate += 1;
  }

  return {
    skill: options.skill,
    ranking,
    coverage: {
      skill: options.skill,
      recipes: mine.length,
      activities: activities.length,
      profitable,
      lossMaking: activities.length - profitable,
      unknownRate,
      unpriced: mine.length - activities.length,
    },
  };
}
