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

import type { GatheringNode } from '../api/wikiGathering.js';
import type { FishingSource } from '../api/wikiFishing.js';
import type { HunterSource } from '../api/wikiHunter.js';
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
import { analyseDistribution, priceDistribution } from '../domain/ev.js';
import type { MinigameRate } from '../domain/minigame.js';
import type { EvDrop } from '../domain/ev.js';
import type { ThievingSource } from '../api/wikiThieving.js';
import { DEFAULT_BANK_HANDOVER_SECONDS, DEFAULT_UNITS_PER_LOAD } from '../domain/budget.js';
import { bankTripSeconds } from '../domain/bankTrip.js';
import { geTax } from '../domain/tax.js';
import {
  fourHourSlice,
  hasChanceOrAverageNote,
  inputVolume24h,
  isPositiveInteger,
  outputVolume24h,
  quoteIndex,
  rankProcess,
  targetInputPrice,
  targetOutputPrice,
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
  'Farming',
  'Sailing',
  'Mining',
  'Woodcutting',
  'Fishing',
  'Hunter',
  'Thieving',
  'Prayer',
  'Firemaking',
  'Agility',
  'Slayer',
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
export const TRAIN_SKILLS: ReadonlySet<string> = new Set([
  'Construction',
  'Sailing',
]);

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
   * Curated gathering nodes for this skill, from the wiki's respawn data. When
   * present, `gather` rows are appended and counted; when absent the skill has no
   * gathering rows at all.
   */
  gatheringNodes?: readonly GatheringNode[];
  /**
   * Curated Thieving sources (stalls with a published action time and loot table,
   * and pickpockets with a success chart). When present, `ev` rows are appended
   * for that skill.
   */
  thievingSources?: readonly ThievingSource[];
  /**
   * Curated Fishing methods, each a page whose success chart is the distribution.
   * Their rows carry `gpPerHour = null`: no fishing page publishes an attempt
   * interval.
   */
  fishingSources?: readonly FishingSource[];
  /**
   * Curated Hunter creatures. A box-trap creature gets a rate (the trap's own
   * published 1.8s attempt); every other trap type keeps `gpPerHour = null`.
   */
  hunterSources?: readonly HunterSource[];
  /**
   * Curated `{{DropsLine}}` / `{{DropsLineReward}}` reward tables (minigame and boss
   * payouts). Their pages publish no per-hour rate, so every row is a per-action
   * expectation with `gpPerHour = null`.
   */
  lootSources?: readonly EvSource[];
  /** Tiles from each EV source page to its nearest bank, keyed by page title. */
  bankTilesByPage?: ReadonlyMap<string, number | null>;
  /** Tiles from a gathering node to its nearest bank, keyed by item name. */
  gatherBankTilesByItem?: ReadonlyMap<string, number | null>;
  /** Stackability per item; unknown counts as non-stackable. */
  stackableByItem?: ReadonlyMap<string, boolean | null>;
  /**
   * Minigame throughput and fees, forwarded to `rankProcess`. A recipe run inside a
   * minigame takes the minigame's published actions/hour and pays its fee instead
   * of the bucket's per-item tick count (see `src/domain/minigame.ts`).
   */
  minigameRates?: readonly MinigameRate[];
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
      distribution: null,
      bankTiles: null,
      effectiveSecondsPerAction: seconds,
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

/**
 * Price a curated `gather` node: one unit per respawn, no inputs, no fee.
 *
 * The rate is the wiki's respawn time, so `gp/hour` is what a single node
 * sustains with nobody else mining it — an upper bound, labelled as such in
 * `docs/skilling-plan.md` §8.15. Rows whose item has no GE price are returned as
 * `unpriced`, never priced at zero.
 */
export function rankGatherActivities(
  nodes: readonly GatheringNode[],
  market: MarketSnapshot,
  options: {
    skill: SkillingSkill;
    mode: SellMode;
    /** Tiles from the node's page to its nearest bank, keyed by item name. */
    bankTilesByItem?: ReadonlyMap<string, number | null>;
    /** Stackability per item; unknown counts as non-stackable (a trip is charged). */
    stackableByItem?: ReadonlyMap<string, boolean | null>;
    secondsPerTile?: number;
    handoverSeconds?: number;
  },
): { activities: SkillActivity[]; unpriced: number } {
  const quotes = quoteIndex(market);
  const activities: SkillActivity[] = [];
  let unpriced = 0;

  for (const node of nodes) {
    if (node.skill !== options.skill) continue;
    const quote = quotes.get(node.item.toLowerCase());
    if (quote === undefined) {
      unpriced += 1;
      continue;
    }
    const price = targetOutputPrice(quote, options.mode);
    if (price === null) {
      unpriced += 1;
      continue;
    }

    const volume4h = fourHourSlice(outputVolume24h(quote, options.mode));
    if (volume4h < 1) {
      unpriced += 1;
      continue;
    }

    const tax = geTax(price);
    const profit = price - tax;
    const seconds = node.respawnSeconds;

    // Banking: a full load of 27 mined/felled units, then a trip. Ore and logs do
    // not stack, so the trip is charged per unit; a stackable node would not need
    // one. The distance is the nearest of the node's published locations.
    const tiles = options.bankTilesByItem?.get(node.item) ?? null;
    const stackable = options.stackableByItem?.get(node.item.toLowerCase()) === true;
    const loadSize = stackable ? null : DEFAULT_UNITS_PER_LOAD;
    const tripSeconds =
      loadSize === null || tiles === null
        ? null
        : bankTripSeconds(
            tiles,
            options.secondsPerTile ?? 0.6,
            options.handoverSeconds ?? DEFAULT_BANK_HANDOVER_SECONDS,
          );
    const effectiveSeconds =
      tripSeconds === null || loadSize === null
        ? seconds
        : seconds + tripSeconds / loadSize;

    const timeActions4h = Math.floor((GE_WINDOW_HOURS * 3600) / effectiveSeconds);
    if (timeActions4h < 1) {
      unpriced += 1;
      continue;
    }
    const actions4h = Math.min(volume4h, timeActions4h);
    const gpPer4h = actions4h * profit;

    activities.push({
      kind: 'gather',
      recipeId: `gather:${node.item}`,
      output: {
        itemId: quote.id,
        itemName: quote.name,
        quantity: 1,
        price,
        volume4h,
        geBuyLimit: quote.limit,
      },
      outputName: node.item,
      noBurnLevel: null,
      distribution: null,
      inputs: [],
      method: null,
      facility: null,
      tools: null,
      members: quote.members,
      skills: [{ name: node.skill, level: node.level }],
      source: node.source,
      itemCost: 0,
      feeGp: 0,
      spend: 0,
      grossRevenue: price,
      tax,
      netRevenue: profit,
      // Nothing is spent, so the margin is the whole sale.
      profit,
      marginPct: 100,
      // Derived from the respawn, not a published action tick: 0.6s per tick.
      ticks: Math.round((seconds / 0.6) * 10) / 10,
      secondsPerAction: seconds,
      bankTiles: tiles,
      effectiveSecondsPerAction: effectiveSeconds,
      marketActions4h: volume4h,
      timeActions4h,
      actions4h,
      gpPer4h,
      gpPerHour: gpPer4h / GE_WINDOW_HOURS,
    });
  }

  return { activities, unpriced };
}

/**
 * Price a loot table at its expectation.
 *
 * This is the §3.1 rule in code: a chance-based yield is priced only when the wiki
 * publishes the distribution, and the row says `EV` rather than pretending the
 * mean is a guarantee. Coins are face value (they are already money); every other
 * item is sold on the GE, so its line is the sell price minus the tax.
 *
 * A table is rejected, not averaged, when it has a ranged quantity (`1-4`), an
 * unreadable rarity, or rolled probabilities summing above one. A table with one
 * unpriced item is rejected too: quietly dropping the expensive outcome would be
 * worse than no row.
 *
 * Two source-side facts are applied here rather than in the parser, so every
 * expected-value family is priced by the same arithmetic:
 *
 *  - `successChance` — a pickpocket's loot table, and a hunter creature's drops,
 *    are what a *successful* attempt yields. The expectation is therefore the
 *    table times the published chance (`src/domain/successChance.ts`). A stall has
 *    no roll and passes `1`.
 *  - `secondsPerAction` may be `null` — fishing publishes no attempt interval at
 *    all. The row is still published (its per-attempt profit is sourced), and
 *    `gpPerHour` stays null, exactly like a recipe with no published ticks.
 */

/**
 * The parts of an expected-value source this engine needs.
 *
 * `ThievingSource`, `FishingSource` and `HunterSource` all satisfy it, so the
 * three families cannot drift into three slightly different pricings.
 */
export interface EvSource {
  /** Page name, used for the bank join and the row id. */
  source_pages: string;
  name: string;
  /** What the row calls the method, e.g. `Pickpocket`, `Stall`, `Fishing`. */
  kind: string;
  level: number | null;
  /** Seconds per attempt; null when the wiki publishes no attempt interval. */
  secondsPerAction: number | null;
  /** Chance one attempt succeeds and pays out the table. Absent means 1. */
  successChance?: number | null;
  drops: readonly EvDrop[];
  /** A trap or tool name, shown in the row when the source has one. */
  trap?: string | null;
  /**
   * Table lines dropped as unreadable. Non-zero invalidates the row: pricing the
   * readable remainder would understate or overstate the very thing the row is
   * meant to answer.
   */
  droppedLines?: number;
  url: string;
}

export function rankEvActivities(
  sources: readonly EvSource[],
  market: MarketSnapshot,
  options: {
    skill: SkillingSkill;
    mode: SellMode;
    /** Tiles from each source page to its nearest bank, keyed by page title. */
    bankTilesByPage?: ReadonlyMap<string, number | null>;
    /** Stackability per loot item, from the item infobox. Unknown is treated as
     * non-stackable, which charges the trip rather than assuming it away. */
    stackableByItem?: ReadonlyMap<string, boolean | null>;
    secondsPerTile?: number;
    handoverSeconds?: number;
  },
): { activities: SkillActivity[]; unpriced: number; rejected: number } {
  const quotes = quoteIndex(market);
  const activities: SkillActivity[] = [];
  let unpriced = 0;
  let rejected = 0;

  const priceOf = (item: string): number | null => {
    if (item.toLowerCase() === 'coins') return 1;
    const quote = quotes.get(item.toLowerCase());
    if (quote === undefined) return null;
    const price = targetOutputPrice(quote, options.mode);
    return price === null ? null : price - geTax(price);
  };

  for (const source of sources) {
    // A table with a line missing is not a table: refuse it and count it rather
    // than pricing the remainder.
    if ((source.droppedLines ?? 0) > 0) {
      unpriced += 1;
      continue;
    }
    const analysis = analyseDistribution(source.drops);
    if (analysis.distribution === null) {
      rejected += 1;
      continue;
    }
    const priced = priceDistribution(analysis.distribution, priceOf);
    if (priced === null) {
      unpriced += 1;
      continue;
    }

    // A pickpocket's table and a creature's drops describe a *successful*
    // attempt. The published success chance scales the whole expectation, so the
    // row is the mean of one attempt rather than of one success.
    const successChance = source.successChance ?? 1;
    if (!Number.isFinite(successChance) || successChance <= 0 || successChance > 1) {
      rejected += 1;
      continue;
    }
    const perAction = Math.round(priced.perAction * successChance);
    const lines = priced.lines.map((line) => ({
      ...line,
      chance: line.chance * successChance,
      expectedGp: Math.round(line.expectedGp * successChance),
    }));

    // The headline item is the biggest share of the expectation, so the row reads
    // as what you actually get, not as an arbitrary first entry.
    const headline = [...lines].sort((a, b) => b.expectedGp - a.expectedGp)[0];
    if (headline === undefined || perAction === 0) {
      unpriced += 1;
      continue;
    }
    const quote = quotes.get(headline.item.toLowerCase());
    // `null` when the source publishes no attempt interval (every fishing method).
    const seconds =
      source.secondsPerAction !== null && source.secondsPerAction > 0
        ? source.secondsPerAction
        : null;

    // Banking. One load is 27 non-stackable units with a slot kept for coins; a
    // table whose every outcome stacks never needs a trip. The trip itself is
    // 2 x tiles x secondsPerTile plus the handover, spread over the load.
    const stackableByItem = options.stackableByItem;
    const allStackable = analysis.distribution.drops.every(
      (drop) =>
        drop.item.toLowerCase() === 'coins' ||
        stackableByItem?.get(drop.item.toLowerCase()) === true,
    );
    const loadSize = allStackable ? null : DEFAULT_UNITS_PER_LOAD;
    const tiles = options.bankTilesByPage?.get(source.source_pages) ?? null;
    const tripSeconds =
      loadSize === null || tiles === null
        ? null
        : bankTripSeconds(
            tiles,
            options.secondsPerTile ?? 0.6,
            options.handoverSeconds ?? DEFAULT_BANK_HANDOVER_SECONDS,
          );
    const effectiveSeconds =
      seconds === null
        ? null
        : tripSeconds === null || loadSize === null
          ? seconds
          : seconds + tripSeconds / loadSize;

    const timeActions4h =
      effectiveSeconds === null
        ? null
        : Math.floor((GE_WINDOW_HOURS * 3600) / effectiveSeconds);
    if (timeActions4h !== null && timeActions4h < 1) {
      unpriced += 1;
      continue;
    }

    const profit = perAction;
    // With no published attempt interval there is no rate, so the only cap left is
    // what the market can absorb in the window — the same fallback a recipe with
    // no ticks gets. `gpPerHour` stays null either way. A coin outcome has no
    // market of its own, so it keeps the floor rather than pretending to be capped.
    const marketActions4h =
      timeActions4h ??
      (quote === undefined
        ? 1
        : Math.max(1, fourHourSlice(outputVolume24h(quote, options.mode))));
    const actions4h = timeActions4h ?? marketActions4h;
    activities.push({
      kind: 'ev',
      recipeId: `ev:${source.source_pages}`,
      output: {
        itemId: quote?.id ?? 0,
        itemName: headline.item,
        quantity: 1,
        price: quote === undefined ? 1 : Math.max(1, targetOutputPrice(quote, options.mode) ?? 1),
        volume4h: marketActions4h,
        geBuyLimit: quote?.limit ?? null,
      },
      outputName: `${source.name} (${source.kind.toLowerCase()})`,
      noBurnLevel: null,
      distribution: lines,
      inputs: [],
      method: source.kind,
      facility: null,
      tools: source.trap ?? null,
      members: true,
      skills: [{ name: options.skill, level: source.level }],
      source: source.url,
      itemCost: 0,
      feeGp: 0,
      spend: 0,
      grossRevenue: profit,
      tax: 0,
      netRevenue: profit,
      profit,
      marginPct: 100,
      // Derived from the published action time, not a tick count.
      ticks:
        effectiveSeconds === null ? null : Math.round((effectiveSeconds / 0.6) * 10) / 10,
      secondsPerAction: seconds,
      bankTiles: tiles,
      effectiveSecondsPerAction: effectiveSeconds,
      // Each loot outcome has its own market; the action rate is the only cap
      // modelled here, and the page says so.
      marketActions4h,
      timeActions4h,
      actions4h,
      gpPer4h: profit * actions4h,
      gpPerHour: timeActions4h === null ? null : (profit * actions4h) / GE_WINDOW_HOURS,
    });
  }

  return { activities, unpriced, rejected };
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
    minigameRates: options.minigameRates,
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
    distribution: null,
    bankTiles: null,
    effectiveSecondsPerAction: row.secondsPerAction,
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

  // Gathering rows come from the wiki's respawn data rather than a recipe, so
  // they are appended after the recipe rows and sorted in with them.
  if (options.gatheringNodes !== undefined && options.gatheringNodes.length > 0) {
    const gathered = rankGatherActivities(options.gatheringNodes, market, {
      skill: options.skill,
      mode: options.mode,
      bankTilesByItem: options.gatherBankTilesByItem,
      stackableByItem: options.stackableByItem,
    });
    activities.push(...gathered.activities);
  }

  // Expected-value rows: a loot table the wiki publishes, priced at its mean.
  // Thieving, Fishing and Hunter all satisfy the same `EvSource` shape, so they
  // are priced by one function rather than three near-copies.
  const evSources: EvSource[] = [
    ...(options.thievingSources ?? []),
    ...(options.fishingSources ?? []),
    ...(options.hunterSources ?? []),
    ...(options.lootSources ?? []),
  ];
  let ignoredDrops = 0;
  for (const source of options.hunterSources ?? []) ignoredDrops += source.ignoredDrops;
  if (evSources.length > 0) {
    const expect = rankEvActivities(evSources, market, {
      skill: options.skill,
      mode: options.mode,
      bankTilesByPage: options.bankTilesByPage,
      stackableByItem: options.stackableByItem,
    });
    activities.push(...expect.activities);
  }

  activities.sort(compareActivities);

  let profitable = 0;
  let unknownRate = 0;
  let upgradeCount = 0;
  let gatherCount = 0;
  for (const activity of activities) {
    if (activity.profit > 0) profitable += 1;
    if (activity.gpPerHour === null) unknownRate += 1;
    if (activity.kind === 'upgrade') upgradeCount += 1;
    if (activity.kind === 'gather') gatherCount += 1;
  }
  const nodeCount = options.gatheringNodes?.length ?? 0;
  const evSourceCount = evSources.length;

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
      nodes: nodeCount,
      evSources: evSourceCount,
      activities: activities.length,
      profitable,
      lossMaking: activities.length - profitable,
      unknownRate,
      gathered: gatherCount,
      trainOnly,
      upgrades: upgradeCount,
      // Table lines a Hunter creature published that are not part of a catch (a pet
      // roll, a rumour-only drop). Counted so the page can say what was left out.
      ignoredDrops,
      // Candidates that produced no row: bucket recipes, curated nodes and curated
      // EV sources all count, so `unpriced === recipes + nodes + evSources -
      // activities` always holds.
      unpriced:
        mine.length + nodeCount + evSourceCount - activities.length,
    },
  };
}
