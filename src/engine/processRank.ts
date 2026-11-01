/**
 * Item processing ranking engine.
 *
 * Takes the wiki's structured recipes (`RawRecipe`, from
 * `Special:Bucket?bucket=recipe`) and prices every deterministic transformation
 * against GE quotes. The question is: buy the inputs, perform the action, sell
 * the output on the GE — is there a profit, and how much per action / per hour?
 *
 * Scope and honesty rules:
 *
 *  - Only deterministic recipes are included. The bucket's `quantitynote` is
 *    the wiki's own warning that an output is a chance, an average or a
 *    level-scaled amount (iron bars, Superglass Make, cooking byproducts). A
 *    note containing chance/average/between/depends/scales/random/varies/
 *    expected/increases excludes the recipe, as does a non-integer quantity.
 *  - Cooking is excluded wholesale: burn chance depends on the player's level
 *    and the food, and the bucket does not publish a reliable expected yield.
 *  - Every material and the output must have a usable GE price. An unpriced
 *    item is skipped, never guessed.
 *  - The GE buy limit is a genuine purchase cap on the input side. On the
 *    output side the 24h volume is the cap; the output's buy limit is metadata.
 *  - All money is integer gp. The output leg pays the GE tax; the input leg
 *    does not. Coins in the recipe (tanner/sawmill/spell fees) are a cost, not
 *    a GE item.
 *
 * Sources:
 *  - https://oldschool.runescape.wiki/w/Special:Bucket?bucket=recipe
 *  - https://oldschool.runescape.wiki/w/Template:Recipe
 *  - https://oldschool.runescape.wiki/w/Module:Recipe (tick handling, 0 = 8/tick)
 *  - https://oldschool.runescape.wiki/w/Tax
 *  - https://oldschool.runescape.wiki/w/Grand_Exchange/Buying_limits
 */

import { geTax } from '../domain/tax.js';
import {
  actions4hForRate,
  actionsPerHour,
  capActionsPerHour,
  secondsPerAction,
} from '../domain/processTime.js';
import { wikiUrl } from '../util/wiki.js';
import type { RawRecipe } from '../api/wikiRecipes.js';
import type {
  MarketQuote,
  MarketSnapshot,
  ProcessItem,
  ProcessOpportunity,
  ProcessRanking,
  SellMode,
} from '../types.js';

/** The production skills this page is about, lowercased for comparison. */
export const PROCESSING_SKILLS = [
  'herblore',
  'crafting',
  'smithing',
  'fletching',
  'runecraft',
  'magic',
] as const;

/**
 * Excluded even when another allowed skill is present. Cooking is the only one
 * today: the bucket lists the recipe but not the burn chance, so a "profit"
 * would assume every raw food cooks perfectly.
 */
const EXCLUDED_SKILLS = new Set(['cooking']);

/**
 * The wiki's quantity notes are the only machine-readable warning that an
 * output is not one exact item per action. Keep this list deliberately broad;
 * a false exclusion loses a row, a false inclusion would fabricate a profit.
 */
const CHANCE_OR_AVERAGE_NOTE =
  /\b(chance|average|between|depends|scales|random|varies|expected|increases)\b/i;

const GE_WINDOW_HOURS = 4;
const HOURS_PER_DAY = 24;

export interface ProcessRankOptions {
  mode: SellMode;
  membersOnly?: boolean;
  /** Override the skill allowlist. Omitted means `PROCESSING_SKILLS`. */
  skills?: readonly string[];
  /**
   * Minimum profit per action, in gp. Default 1, so the processing page lists
   * only profitable recipes. A caller that wants the loss-making side — the
   * skilling page's cost-to-train rows — passes a negative floor, which turns
   * the filter off instead of silently keeping it at 1 gp.
   */
  minProfit?: number;
  /**
   * Player-entered ceiling on actions per hour, used to model inefficient play.
   * 0 or omitted uses each recipe's published rate. The cap can only slow a
   * recipe down: the effective rate is min(recipe rate, cap).
   */
  maxActionsPerHour?: number;
  /** Cap the returned list. */
  limit?: number;
}

/** The GE price a mode pays for an input. Null when the quote has no usable price. */
export function targetInputPrice(
  quote: MarketQuote,
  mode: SellMode,
): number | null {
  const price = mode === 'pessimistic' ? quote.high : quote.low;
  return price !== null && price > 0 ? price : null;
}

/** The GE price a mode receives for the output. Null when unusable. */
export function targetOutputPrice(
  quote: MarketQuote,
  mode: SellMode,
): number | null {
  const price = mode === 'pessimistic' ? quote.low : quote.high;
  return price !== null && price > 0 ? price : null;
}

/** 24h volume on the side an input buy takes liquidity from. */
export function inputVolume24h(quote: MarketQuote, mode: SellMode): number {
  return mode === 'pessimistic' ? quote.highVolume24h : quote.lowVolume24h;
}

/** 24h volume on the side an output sale takes liquidity from. */
export function outputVolume24h(quote: MarketQuote, mode: SellMode): number {
  return mode === 'pessimistic' ? quote.lowVolume24h : quote.highVolume24h;
}

/**
 * Re-exported for callers and tests that already import the tick conversion
 * from the engine. The implementation lives in `src/domain/processTime.ts` so
 * the UI can share the exact same formula.
 *
 * https://oldschool.runescape.wiki/w/Module:Recipe
 */
export { secondsPerAction };

/**
 * The slice of a 24h volume a 4h GE window can supply or absorb.
 *
 * Exported so the skilling engine prices a `train` row's input cap with the
 * same arithmetic instead of re-deriving it.
 */
export function fourHourSlice(volume24h: number): number {
  return Math.floor(Math.max(0, volume24h) / (HOURS_PER_DAY / GE_WINDOW_HOURS));
}

/** A whole, positive quantity; a fractional one is never estimated. */
export function isPositiveInteger(value: number): boolean {
  return Number.isInteger(value) && value > 0;
}

/**
 * True when the wiki flags the recipe's quantity as a chance, an average or a
 * level-scaled value. Exported so the skilling engine applies the same rule.
 */
export function hasChanceOrAverageNote(recipe: RawRecipe): boolean {
  if (
    recipe.output.note !== null &&
    CHANCE_OR_AVERAGE_NOTE.test(recipe.output.note)
  ) {
    return true;
  }
  return recipe.materials.some(
    (material) =>
      material.note !== null && CHANCE_OR_AVERAGE_NOTE.test(material.note),
  );
}

/**
 * Skill policy:
 *  - a recipe with an excluded skill is out, even if it also has an allowed one;
 *  - a recipe with skills must match the allowlist;
 *  - a recipe with no skill is included only when it names a facility or tool
 *    (tanning, sawmill work). That is the evidence it is processing rather than
 *    an NPC trade the template also catalogues.
 */
function isRecipeAllowed(
  recipe: RawRecipe,
  allowed: ReadonlySet<string>,
  explicitSkills: boolean,
): boolean {
  if (recipe.skills.some((skill) => EXCLUDED_SKILLS.has(skill.name.toLowerCase()))) {
    return false;
  }
  if (recipe.skills.length === 0) {
    if (explicitSkills) return false;
    return recipe.facilities !== null || recipe.tools !== null;
  }
  return recipe.skills.some((skill) => allowed.has(skill.name.toLowerCase()));
}

/**
 * Name -> quote index. Names are unique in the GE mapping; if a duplicate ever
 * appears, the lower item id wins so the choice is deterministic.
 */
/**
 * Name -> quote index, with the lower item id winning a duplicate name so the
 * choice is deterministic. Exported for the skilling engine's `train` rows.
 */
export function quoteIndex(market: MarketSnapshot): Map<string, MarketQuote> {
  const index = new Map<string, MarketQuote>();
  for (const quote of Object.values(market.quotes)) {
    const key = quote.name.toLowerCase();
    const existing = index.get(key);
    if (existing === undefined || quote.id < existing.id) {
      index.set(key, quote);
    }
  }
  return index;
}

/**
 * Rank every deterministic, fully priced recipe in one price mode.
 *
 * `pessimistic` = instant buy inputs at GE `high`, instant sell output at GE
 * `low`. `patient` = rest a buy at `low`, rest a sell at `high`. The volume side
 * follows the same logic as `sinkRank.ts`: an instant buy takes from the high
 * side, a resting low offer is filled by instant sellers, and vice versa.
 */
export function rankProcess(
  recipes: readonly RawRecipe[],
  market: MarketSnapshot,
  options: ProcessRankOptions,
): ProcessRanking {
  const mode = options.mode;
  const membersOnly = options.membersOnly ?? false;
  const explicitSkills = options.skills !== undefined;
  const allowed = new Set(
    (options.skills ?? PROCESSING_SKILLS).map((skill) => skill.toLowerCase()),
  );
  const minProfit = Math.floor(options.minProfit ?? 1);
  const maxActionsPerHour = Math.max(0, options.maxActionsPerHour ?? 0);
  const quotes = quoteIndex(market);

  const opportunities: ProcessOpportunity[] = [];

  for (const recipe of recipes) {
    if (membersOnly && !recipe.members) continue;
    if (!isRecipeAllowed(recipe, allowed, explicitSkills)) continue;
    if (hasChanceOrAverageNote(recipe)) continue;
    if (!isPositiveInteger(recipe.output.quantity)) continue;

    const outputQuote = quotes.get(recipe.output.name.toLowerCase());
    if (outputQuote === undefined) continue;

    const outputPrice = targetOutputPrice(outputQuote, mode);
    if (outputPrice === null) continue;

    const outputVolume4h = fourHourSlice(outputVolume24h(outputQuote, mode));
    const outputActions = Math.floor(
      outputVolume4h / recipe.output.quantity,
    );
    if (outputActions < 1) continue;

    // Aggregate repeated material names first. A recipe can list the same item
    // twice (the template has independent mat1..mat11 slots), and consuming 60
    // units twice needs 120 units of supply, not two separate 60-unit checks.
    const materialQuantities = new Map<string, number>();
    let feeGp = 0;
    let valid = true;

    for (const material of recipe.materials) {
      if (!isPositiveInteger(material.quantity)) {
        valid = false;
        break;
      }

      // Coins in a recipe are the tanner/sawmill/spell fee. They are spent, not
      // bought on the GE, so they never get a quote.
      if (material.name.toLowerCase() === 'coins') {
        feeGp += material.quantity;
        continue;
      }

      const key = material.name.toLowerCase();
      materialQuantities.set(
        key,
        (materialQuantities.get(key) ?? 0) + material.quantity,
      );
    }

    if (!valid || materialQuantities.size === 0) continue;

    const inputs: ProcessItem[] = [];
    let itemCost = 0;
    let inputActions = Number.POSITIVE_INFINITY;

    for (const [name, quantity] of materialQuantities) {
      const quote = quotes.get(name);
      if (quote === undefined) {
        valid = false;
        break;
      }

      const price = targetInputPrice(quote, mode);
      if (price === null) {
        valid = false;
        break;
      }

      const volume4h = fourHourSlice(inputVolume24h(quote, mode));
      // A missing buy limit is "no limit", not zero. The 24h volume still caps.
      const limit = quote.limit ?? Number.POSITIVE_INFINITY;
      const supply4h = Math.min(limit, volume4h);
      const actions = Math.floor(supply4h / quantity);
      if (actions < 1) {
        valid = false;
        break;
      }

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

    if (!valid || inputs.length === 0 || !Number.isFinite(inputActions)) {
      continue;
    }

    const marketActions4h = Math.min(inputActions, outputActions);
    if (marketActions4h < 1) continue;

    const grossRevenue = outputPrice * recipe.output.quantity;
    // Tax is charged per item sold, not on the whole stack at once. The 2% is
    // capped per item, so multiplying the per-unit tax is the correct sum.
    const tax = geTax(outputPrice) * recipe.output.quantity;
    const netRevenue = grossRevenue - tax;
    const spend = itemCost + feeGp;
    const profit = netRevenue - spend;
    if (profit < minProfit) continue;

    const seconds = secondsPerAction(recipe.ticks);
    const rateUsed = capActionsPerHour(
      actionsPerHour(seconds),
      maxActionsPerHour,
    );
    const timeActions4h = actions4hForRate(rateUsed);
    const actions4h =
      timeActions4h === null
        ? marketActions4h
        : Math.min(marketActions4h, timeActions4h);
    if (actions4h < 1) continue;

    const gpPer4h = actions4h * profit;
    const gpPerHour =
      timeActions4h === null ? null : gpPer4h / GE_WINDOW_HOURS;

    opportunities.push({
      recipeId: recipe.id,
      output: {
        itemId: outputQuote.id,
        itemName: outputQuote.name,
        quantity: recipe.output.quantity,
        price: outputPrice,
        volume4h: outputVolume4h,
        geBuyLimit: outputQuote.limit,
      },
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
      grossRevenue,
      tax,
      netRevenue,
      profit,
      marginPct: spend > 0 ? (profit / spend) * 100 : 0,

      ticks: recipe.ticks,
      secondsPerAction: seconds,
      marketActions4h,
      timeActions4h,
      actions4h,
      gpPer4h,
      gpPerHour,
    });
  }

  // Unknown time is never better than a known time, whichever way the column is
  // sorted; profit remains the tie-breaker among unknown-time rows. Every
  // comparison ends in a stable key so the artifact does not depend on input
  // order.
  opportunities.sort((a, b) => {
    if (a.gpPerHour !== b.gpPerHour) {
      if (a.gpPerHour === null) return 1;
      if (b.gpPerHour === null) return -1;
      return b.gpPerHour - a.gpPerHour;
    }
    if (b.gpPer4h !== a.gpPer4h) return b.gpPer4h - a.gpPer4h;
    if (b.profit !== a.profit) return b.profit - a.profit;
    if (b.marginPct !== a.marginPct) return b.marginPct - a.marginPct;
    const byOutput = a.output.itemName.localeCompare(b.output.itemName);
    if (byOutput !== 0) return byOutput;
    return a.recipeId.localeCompare(b.recipeId);
  });

  const limited =
    options.limit === undefined
      ? opportunities
      : opportunities.slice(0, Math.max(0, Math.floor(options.limit)));

  return {
    generatedAt: new Date().toISOString(),
    pricesAsOf: market.pricesAsOf,
    mode,
    filters: {
      skills: [...allowed].sort((a, b) => a.localeCompare(b)),
      membersOnly,
      minProfit,
      maxActionsPerHour,
    },
    count: limited.length,
    opportunities: limited,
  };
}
