/**
 * The GP-earning leaderboard: one comparable row per executable money maker.
 *
 * The site models three ways to turn time and gold into gp, each with its own
 * source artifact and its own planner:
 *
 *  - **shop run** — buy stock from an NPC shop, sell it on the GE
 *    (`data/opportunities.json`, `planWithBudget`);
 *  - **shop dump** — buy on the GE, sell it to an NPC shop
 *    (`data/shop-sinks.json`, `planShopSink`);
 *  - **processing** — buy inputs, transform them with a deterministic recipe,
 *    sell the output (`data/process.json`);
 *  - **skilling** — the same idea across every scanned skill
 *    (`data/skilling.json`), including the rows the processing artifact does not
 *    carry because they are unprofitable there or belong to another skill.
 *
 * This module answers the one question that spans all three: **at this much
 * gold, what earns the most per hour, what do I need up front, and how long
 * does a run take?**
 *
 * Two rules come straight from AGENTS.md:
 *
 *  1. **Every row is re-planned at the player's own gold** through the same
 *     pure planners the detail pages use. `Opportunity.gpPerHour` in the
 *     artifact is a documented placeholder equal to `gpPer4h`; reading it here
 *     would overstate a shop run's hourly rate by a factor of four, so it is
 *     never used.
 *  2. **A row whose time model cannot answer is counted and dropped, never
 *     guessed.** That covers a shop whose bank distance is unknown but which
 *     needs banking, a GE -> shop flip whose shop has no wiki-map distance to
 *     the GE, and a recipe with no published tick time. The UI reports how many
 *     rows fell out and why.
 */

import {
  DEFAULT_HOP_SECONDS,
  DEFAULT_MAX_WORLDS,
  DEFAULT_SECONDS_PER_TILE,
  planWithBudget,
} from './budget.js';
import { planShopSink } from './shopSink.js';
import type { ShopRow } from './shopPrice.js';
import type {
  Opportunity,
  ProcessOpportunity,
  ShopAccessEntry,
  ShopSinkOpportunity,
  SkillActivity,
} from '../types.js';

/** The four money-making families the site can price. */
export type EarnKind = 'shop-run' | 'shop-dump' | 'processing' | 'skilling';

/** Player-facing name of each family. */
export const EARN_KIND_LABELS: Record<EarnKind, string> = {
  'shop-run': 'Shop run',
  'shop-dump': 'Sell to shop',
  processing: 'Processing',
  skilling: 'Skilling',
};

/**
 * What each family actually is, in one sentence, for the badge tooltip.
 * Short because it sits in a table cell.
 */
export const EARN_KIND_TITLES: Record<EarnKind, string> = {
  'shop-run': 'Buy stock from an NPC shop and sell it on the Grand Exchange',
  'shop-dump': 'Buy on the Grand Exchange and sell it to an NPC shop',
  processing: 'Buy inputs on the GE, transform them, and sell the output',
  skilling:
    'Train a skill on GE-bought inputs and sell the product: crafting, smithing, cooking and the rest',
};

/** Which detail page explains a row, and with what search text. */
export interface EarnTarget {
  page: 'shop-to-ge' | 'ge-to-shop' | 'processing' | 'skilling';
  /** Prefills that page's search box, so the row is easy to find again. */
  query: string;
}

export interface EarnMethod {
  /** Stable identity across rebuilds, used as the React key and for sorting. */
  id: string;
  kind: EarnKind;
  /** The item you buy low or produce. */
  name: string;
  /** The shop, or the recipe's inputs. */
  where: string;
  /** Location, facility or method: the second, quieter line. */
  detail: string | null;
  members: boolean;
  /** gp per hour while executing the plan. Never null: unranked rows are dropped. */
  gpPerHour: number;
  /** Coins tied up by the plan (shop stock, GE purchases, inputs plus fees). */
  capitalGp: number;
  /** Profit across the whole plan, after the GE tax where one applies. */
  profitGp: number;
  /** Seconds the plan takes, from the same time model the detail page uses. */
  timeSeconds: number;
  /** Known prerequisites, e.g. `Herblore 48` or `Regicide`. */
  requirements: readonly string[];
  /** Wiki page backing the first requirement, when the table cites one. */
  requirementSource: string | null;
  /**
   * True when the row carries a known shop access requirement from the curated
   * table. Skill levels are displayed but never treated as a lock: the site
   * does not check an account's levels (see `docs/processing.md`).
   */
  locked: boolean;
  target: EarnTarget;
}

/**
 * One skilling activity plus the skill it was scanned under.
 *
 * `data/skilling.json` groups rows per skill, and a few recipes are reachable
 * from more than one skill, so the pair is the identity, not the recipe alone.
 */
export interface SkillActivityRow {
  skill: string;
  activity: SkillActivity;
}

export interface EarnInput {
  /** Shop -> GE rows from `data/opportunities.json` for one price mode. */
  shopRuns: readonly Opportunity[];
  /** GE -> shop rows from `data/shop-sinks.json` for the same mode. */
  shopDumps: readonly ShopSinkOpportunity[];
  /** Deterministic recipes from `data/process.json` for the same mode. */
  recipes: readonly ProcessOpportunity[];
  /**
   * Priced skilling activities from `data/skilling.json` for the same mode.
   *
   * Cost-to-train rows sell nothing, so they are not candidates here; rows whose
   * recipe already has a processing row are dropped as duplicates (see
   * `duplicated` in the result), because one action must not be ranked twice.
   */
  skilling?: readonly SkillActivityRow[];
}

export interface EarnOptions {
  /** Gold available. 0 means "no cap", as on the detail pages. */
  goldGp?: number;
  /** Seconds to hop world and get back. Shared with the detail pages. */
  hopSeconds?: number;
  /** Ceiling on worlds visited; the shop is assumed available on each. */
  maxWorlds?: number;
  /** Seconds per game tile: 0.6 walking, 0.3 running. */
  secondsPerTile?: number;
  /** Known shop access requirements, keyed by shop page. Absence = unknown. */
  access?: ReadonlyMap<string, ShopAccessEntry>;
}

export interface EarnResult {
  /** Ranked by gp/hour, then profit, then a total tie-break. Never contains nulls. */
  methods: EarnMethod[];
  /** Rows dropped because the time model has no answer for them. */
  unranked: number;
  /** Rows with no 4h market capacity on their own side of the book. */
  unexecutable: number;
  /** Rows the current gold cannot execute at all. */
  unaffordable: number;
  /**
   * Skilling rows skipped because `data/process.json` already ranks the same
   * recipe. Counted so the coverage line can say why the two families do not
   * simply add up.
   */
  duplicated: number;
}

/** Seconds in the GE's 4-hour buy-limit / volume window. */
const FOUR_HOURS_SECONDS = 4 * 3600;

/**
 * Rebuild the shop price curve from a shop -> GE row's pricing parameters.
 * Kept here so the domain owns the join, and `web/src/opportunity.ts` re-exports
 * it for the shop page and the basket panel.
 */
export function shopRowFromOpportunity(opp: Opportunity): ShopRow {
  return {
    itemValue: opp.itemValue,
    sellMultiplier: opp.sellMultiplier,
    buyMultiplier: opp.buyMultiplier,
    delta: opp.delta,
    baseStock: opp.baseStock ?? 0,
    infiniteStock: opp.infiniteStock,
  };
}

/**
 * Rebuild the shop price curve for a GE -> shop row.
 *
 * Only the buy side of the curve matters here: `shopUnitSellPrice` reads
 * `itemValue`, `buyMultiplier`, `delta`, `baseStock` and `infiniteStock`. The
 * sell multiplier is part of the shared row type but is not consulted, so a
 * neutral 1000 keeps the object honest without inventing a value.
 */
export function shopRowFromSink(opp: ShopSinkOpportunity): ShopRow {
  return {
    itemValue: opp.itemValue,
    sellMultiplier: 1000,
    buyMultiplier: opp.buyMultiplier,
    delta: opp.delta,
    baseStock: opp.baseStock ?? 0,
    infiniteStock: opp.infiniteStock,
  };
}

/**
 * Units the GE can absorb in a 4h window, no matter how many shops you visit.
 *
 * `sellablePer4h` is additionally capped by one shop visit's stock, so using it
 * as the budget cap would make world-hopping pointless. The cross-world bound
 * is the 24h volume slice the engine computed. The GE buy limit is a per-player
 * purchase cap and is deliberately not used here.
 */
export function sellableAcrossWorlds(opp: Opportunity): number {
  return Math.max(0, opp.volume4h);
}

/**
 * The two halves of a shop venue: the shop itself and where it stands.
 * Both shop families carry these fields, so the helper takes only them.
 */
function shopWhere(opp: {
  shopName: string;
  location: string | null;
}): { where: string; detail: string | null } {
  return { where: opp.shopName, detail: opp.location };
}

/** `Grimy avantoe ×1, Vial of water ×1` — what one recipe action consumes. */
function recipeWhere(opp: ProcessOpportunity): string {
  return opp.inputs
    .map((input) => `${input.itemName} ×${input.quantity}`)
    .join(", ");
}

/**
 * Build the leaderboard.
 *
 * Pure: no I/O, no network, no clock. The caller passes the payloads, the gold
 * and the travel assumptions, so the same inputs always produce the same order.
 */
export function buildEarnings(
  input: EarnInput,
  options: EarnOptions = {},
): EarnResult {
  const goldGp = Math.max(0, Math.floor(options.goldGp ?? 0));
  const hopSeconds = options.hopSeconds ?? DEFAULT_HOP_SECONDS;
  const maxWorlds = options.maxWorlds ?? DEFAULT_MAX_WORLDS;
  const secondsPerTile = options.secondsPerTile ?? DEFAULT_SECONDS_PER_TILE;
  const access = options.access ?? new Map<string, ShopAccessEntry>();

  // The planners treat a non-positive budget as "no cap"; `planWithBudget`
  // treats 0 as an empty plan, so an uncapped run sizes to the GE's 4h slice.
  const budget = goldGp > 0 ? goldGp : Number.POSITIVE_INFINITY;

  const methods: EarnMethod[] = [];
  let unranked = 0;
  let unexecutable = 0;
  let unaffordable = 0;

  /**
   * Classify a row that produced no units. Only a funding shortfall is counted
   * as `unaffordable`; a row with no market capacity never had a chance and is
   * counted separately, and at gold 0 nothing is "unaffordable".
   */
  const skip = (planUnits: number): void => {
    if (planUnits <= 0 && goldGp > 0) unaffordable += 1;
  };

  // ---------------------------------------------------------------- shop runs
  for (const opp of input.shopRuns) {
    // No sell-side volume in the window means nothing can be sold, at any gold.
    if (sellableAcrossWorlds(opp) <= 0) {
      unexecutable += 1;
      continue;
    }

    const plan = planWithBudget(
      shopRowFromOpportunity(opp),
      opp.netSellPerUnit,
      budget,
      {
        hopSeconds,
        maxWorlds,
        bankTiles: opp.bankTiles,
        secondsPerTile,
        stackable: opp.stackable,
        maxUnits: sellableAcrossWorlds(opp),
      },
    );

    if (plan.units <= 0 || plan.profit <= 0) {
      skip(plan.units);
      continue;
    }
    if (plan.gpPerHour === null || plan.gpPerHour <= 0) {
      unranked += 1;
      continue;
    }

    const label = shopWhere(opp);
    const requirement = access.get(opp.shopPage);
    methods.push({
      id: `shop-run:${opp.itemId}:${opp.shopPage}`,
      kind: "shop-run",
      name: opp.itemName,
      where: label.where,
      detail: label.detail,
      members: opp.members,
      gpPerHour: plan.gpPerHour,
      capitalGp: plan.totalCost,
      profitGp: plan.profit,
      timeSeconds: plan.timeSeconds,
      requirements: requirement === undefined ? [] : [requirement.requirement],
      requirementSource: requirement?.source ?? null,
      locked: requirement !== undefined,
      target: { page: "shop-to-ge", query: opp.itemName },
    });
  }

  // --------------------------------------------------------------- shop dumps
  for (const opp of input.shopDumps) {
    // The GE cannot supply a single unit in 4h: no plan exists at any gold.
    if (opp.purchaseCap4h <= 0) {
      unexecutable += 1;
      continue;
    }

    const plan = planShopSink(shopRowFromSink(opp), {
      geCostPerUnit: opp.geBuyPrice,
      purchaseCap4h: opp.purchaseCap4h,
      geTiles: opp.geTiles,
      secondsPerTile,
      hopSeconds,
      maxWorlds,
      budgetGp: goldGp,
    });

    if (plan.units <= 0 || plan.profit <= 0) {
      skip(plan.units);
      continue;
    }
    if (plan.gpPerHour === null || plan.gpPerHour <= 0) {
      unranked += 1;
      continue;
    }

    const label = shopWhere(opp);
    const requirement = access.get(opp.shopPage);
    methods.push({
      id: `shop-dump:${opp.itemId}:${opp.shopPage}`,
      kind: "shop-dump",
      name: opp.itemName,
      where: label.where,
      detail: label.detail,
      members: opp.members,
      gpPerHour: plan.gpPerHour,
      capitalGp: plan.totalCost,
      profitGp: plan.profit,
      timeSeconds: plan.timeSeconds,
      requirements: requirement === undefined ? [] : [requirement.requirement],
      requirementSource: requirement?.source ?? null,
      locked: requirement !== undefined,
      target: { page: "ge-to-shop", query: opp.itemName },
    });
  }

  // --------------------------------------------------------------- processing
  for (const opp of input.recipes) {
    // A missing tick count means no published action rate: unranked, not slow.
    if (opp.gpPerHour === null || opp.gpPerHour <= 0) {
      unranked += 1;
      continue;
    }
    if (opp.actions4h <= 0) continue;

    // The gold budget caps actions at floor(gold / spend); the market and the
    // recipe's own speed cap them at `actions4h`. The hourly rate is unchanged
    // by a smaller plan, so time scales with the actions you can fund.
    const affordable =
      goldGp > 0 ? Math.floor(goldGp / Math.max(1, opp.spend)) : opp.actions4h;
    const actions = Math.min(opp.actions4h, affordable);
    if (actions <= 0) {
      if (goldGp > 0) unaffordable += 1;
      continue;
    }

    const profit = actions * opp.profit;
    if (profit <= 0) continue;

    methods.push({
      id: `processing:${opp.recipeId}`,
      kind: "processing",
      name: opp.output.itemName,
      where: recipeWhere(opp),
      detail: opp.facility ?? opp.method,
      members: opp.members,
      gpPerHour: opp.gpPerHour,
      capitalGp: actions * opp.spend,
      profitGp: profit,
      // Same bottleneck rule as the shop planners: the plan takes as long as
      // the 4h market/action window it is sized against.
      timeSeconds: (actions / opp.actions4h) * FOUR_HOURS_SECONDS,
      requirements: opp.skills.map((skill) =>
        skill.level === null ? skill.name : `${skill.name} ${skill.level}`,
      ),
      requirementSource: opp.source,
      locked: false,
      target: { page: "processing", query: opp.output.itemName },
    });
  }

  // ----------------------------------------------------------------- skilling
  //
  // Skilling rows are planned exactly like recipes: the market and the recipe's
  // own speed cap the actions, the player's gold caps them again, and the hourly
  // rate is unchanged by a smaller plan. Two exclusions are specific to this
  // family and are counted rather than silent:
  //
  //  - `train` rows sell nothing (boat parts, house furniture), so they cannot
  //    earn;
  //  - the same *action* is ranked once. That covers a recipe the processing
  //    family already prices, and a multi-skill recipe that appears under two
  //    skills in the artifact (`String Jewellery` trains Magic and Crafting, but
  //    it is one action with one margin).
  const processingIds = new Set(
    input.recipes.map((recipe) => recipe.recipeId),
  );
  const rankedSkillRecipes = new Set<string>();
  let duplicated = 0;

  for (const entry of input.skilling ?? []) {
    const opp = entry.activity;
    if (opp.kind === 'train') continue;
    if (
      processingIds.has(opp.recipeId) ||
      rankedSkillRecipes.has(opp.recipeId)
    ) {
      duplicated += 1;
      continue;
    }
    if (opp.gpPerHour === null || opp.gpPerHour <= 0) {
      unranked += 1;
      continue;
    }
    if (opp.actions4h <= 0) continue;

    const affordable =
      goldGp > 0 ? Math.floor(goldGp / Math.max(1, opp.spend)) : opp.actions4h;
    const actions = Math.min(opp.actions4h, affordable);
    if (actions <= 0) {
      if (goldGp > 0) unaffordable += 1;
      continue;
    }

    const profit = actions * opp.profit;
    if (profit <= 0) continue;

    const requirements = opp.skills.map((skill) =>
      skill.level === null ? skill.name : `${skill.name} ${skill.level}`,
    );
    // Cooking's row is only deterministic at or above this level, so it belongs
    // in the requirements: it is the level at which the margin stops being a
    // gamble.
    if (opp.noBurnLevel !== null) {
      requirements.push(`Cooking ${opp.noBurnLevel} to not burn`);
    }

    rankedSkillRecipes.add(opp.recipeId);
    methods.push({
      id: `skilling:${entry.skill}:${opp.recipeId}`,
      kind: 'skilling',
      name: opp.outputName,
      where:
        opp.kind === 'gather'
          ? 'one node, one respawn'
          : opp.kind === 'ev'
            ? `loot table, ${opp.distribution?.length ?? 0} outcomes`
            : opp.inputs
                .map((item) => `${item.itemName} ×${item.quantity}`)
                .join(', ') || 'nothing',
      detail: opp.facility ?? opp.method,
      members: opp.members,
      gpPerHour: opp.gpPerHour,
      capitalGp: actions * opp.spend,
      profitGp: profit,
      timeSeconds: (actions / opp.actions4h) * FOUR_HOURS_SECONDS,
      requirements,
      requirementSource: opp.source,
      locked: false,
      target: { page: 'skilling', query: opp.outputName },
    });
  }

  // Total and deterministic: gp/hour, then the size of the run, then identity.
  methods.sort((a, b) => {
    if (b.gpPerHour !== a.gpPerHour) return b.gpPerHour - a.gpPerHour;
    if (b.profitGp !== a.profitGp) return b.profitGp - a.profitGp;
    if (a.kind !== b.kind) return a.kind.localeCompare(b.kind);
    if (a.name !== b.name) return a.name.localeCompare(b.name);
    return a.id.localeCompare(b.id);
  });

  return { methods, unranked, unexecutable, unaffordable, duplicated };
}
