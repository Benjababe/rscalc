/**
 * Curated `{{DropsLine}}` / `{{DropsLineReward}}` reward tables, priced per action.
 *
 * The parser is `src/api/wikiLootTable.ts`, which groups a page's tables into rolls
 * and checks that each one sums to 1. What this file adds is the curation — which page,
 * which roll, which skill — plus the one fact the page cannot supply: the number of
 * kills, rounds or sacks per hour. **None of these pages publishes it**, so every row
 * here is `secondsPerAction: null`, i.e. a per-action expectation with
 * `gpPerHour = null`, the same shape as every fishing method (§8.19).
 *
 * That is the honest outcome rather than a gap: the distribution is now sourced (with
 * ranged quantities at their published midpoint, §3.1a), and the hour is not.
 */

import type { EvSource } from '../src/engine/skilling.js';
import type { SkillingSkill } from '../src/engine/skilling.js';
import type { LootPageResult } from '../src/api/wikiLootTable.js';
import { BOX_TRAP_ATTEMPT_SECONDS } from '../src/api/wikiHunter.js';

export interface LootRowSource {
  /** Wiki page carrying the tables. */
  page: string;
  /** What the row is called on the page, e.g. `Zalcano` or `Hallowed sack (low tier)`. */
  label: string;
  /** The skill the artifact files this under; a row belongs to exactly one. */
  skill: SkillingSkill;
  /** Requirement as the page states it, or null when it states none. */
  level: number | null;
  /**
   * Which roll on the page this row is, in document order. Rolls are what
   * `groupRolls` returns: consecutive tables that add up to one.
   */
  roll: number;
  /** Why this row has no hourly rate; shown in the log and the docs. */
  rateNote: string;
}

export const LOOT_ROWS: readonly LootRowSource[] = [
  {
    page: 'Zalcano',
    label: 'Zalcano',
    skill: 'Mining',
    level: 70,
    // One roll: the two guaranteed drops, then Runes (0.167) + Materials (0.833).
    roll: 0,
    rateNote: 'no kills-per-hour is published; the row is one kill of loot',
  },
  {
    page: 'Hallowed sack',
    label: 'Hallowed sack (low tier)',
    skill: 'Agility',
    level: 52,
    roll: 0,
    rateNote: 'no sacks-per-hour is published; the row is one sack',
  },
  {
    page: 'Hallowed sack',
    label: 'Hallowed sack (mid tier)',
    skill: 'Agility',
    level: 52,
    roll: 1,
    rateNote: 'no sacks-per-hour is published; the row is one sack',
  },
  {
    page: 'Hallowed sack',
    label: 'Hallowed sack (high tier)',
    skill: 'Agility',
    level: 52,
    roll: 2,
    rateNote: 'no sacks-per-hour is published; the row is one sack',
  },
];

/**
 * Checked and refused, with the measured reason. Each of these has a `{{DropsLine}}`
 * table, and each fails to be a roll:
 *
 *  - **Wintertodt** (`Supply crate (Wintertodt)`) — a `Unique` table summing to 0.064
 *    and an `Other` table to 0.280, because the crate's contents scale with points;
 *    there is no per-crate distribution.
 *  - **Tempoross** — the reward pool tabulates no quantities at all.
 *  - **Guardians of the Rift** — rewards are paid in abyssal pearls, a currency with no
 *    GE value, so the loot table is not the payout.
 *  - **Fishing Trawler** — 18 of 23 lines are `Varies`/`Varies`; a word has no midpoint.
 *  - **Mahogany Homes**, **Giants' Foundry** — fees, not loot tables.
 */
export const LOOT_REFUSALS: readonly { name: string; reason: string }[] = [
  {
    name: 'Wintertodt',
    reason:
      'the supply crate has no per-crate roll: Unique sums to 0.064 and Other to 0.280, because contents scale with points',
  },
  {
    name: 'Tempoross',
    reason: 'the reward pool tabulates no quantities',
  },
  {
    name: 'Guardians of the Rift',
    reason: 'rewards are paid in abyssal pearls, a currency with no GE value',
  },
  {
    name: 'Fishing Trawler',
    reason: '18 of 23 lines are quantity=Varies / rarity=Varies, and a word has no midpoint',
  },
  {
    name: 'Mahogany Homes',
    reason: 'a contract fee, not a loot table',
  },
  {
    name: "Giants' Foundry",
    reason: 'a commission, not a loot table',
  },
];

/**
 * Build the engine's sources from the parsed pages.
 *
 * A curated row whose roll is missing, or whose roll does not sum to one, is dropped
 * and reported — the alternative would be pricing a table that is not a roll.
 */
export function lootEvSources(
  rows: readonly LootRowSource[],
  pages: ReadonlyMap<string, LootPageResult>,
): { sources: EvSource[]; problems: string[] } {
  const sources: EvSource[] = [];
  const problems: string[] = [];

  for (const row of rows) {
    const page = pages.get(row.page);
    if (page === undefined) {
      problems.push(`${row.label}: page "${row.page}" could not be fetched`);
      continue;
    }
    const roll = page.rolls[row.roll];
    if (roll === undefined) {
      problems.push(
        `${row.label}: roll ${row.roll} does not exist (page has ${page.rolls.length})`,
      );
      continue;
    }
    if (Math.abs(roll.chanceSum - 1) > 0.01) {
      problems.push(
        `${row.label}: roll ${row.roll} sums to ${roll.chanceSum.toFixed(3)}, not 1`,
      );
      continue;
    }
    if (roll.drops.length === 0) {
      problems.push(`${row.label}: roll ${row.roll} has no readable lines`);
      continue;
    }
    sources.push({
      source_pages: row.page,
      name: row.label,
      kind: 'Loot',
      level: row.level,
      // No page publishes kills, rounds or sacks per hour, so the row keeps a null
      // rate rather than an invented one.
      secondsPerAction: null,
      successChance: 1,
      drops: roll.drops,
      url: `https://oldschool.runescape.wiki/w/${encodeURIComponent(
        row.page.replace(/ /g, '_'),
      )}`,
    });
  }

  return { sources, problems };
}

/** Kept for documentation value: the box-trap interval is the only published one. */
export const ONLY_PUBLISHED_INTERVAL_SECONDS = BOX_TRAP_ATTEMPT_SECONDS;
