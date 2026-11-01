/**
 * Loot tables written with `{{DropsLineReward}}` / `{{DropsLine}}`.
 *
 * The bucket's `{{DropsLineSkill}}` tables (Thieving stalls, Hunter creatures) are
 * read elsewhere. A **minigame or boss** writes its payout with `{{DropsLine}}` or
 * `{{DropsLineReward}}` instead, split across several tables on one page, and the
 * structure of those tables is what decides whether a row can be priced:
 *
 *  - Zalcano's `100%` table holds two `Always` lines (guaranteed), then `Runes`
 *    (chance sum 0.167) and `Materials` (0.833) together make **exactly one roll**.
 *  - The Hallowed sack has three **tiers**, each with four tables that sum to 1.000,
 *    so each tier is one roll and therefore one row.
 *  - Wintertodt's crate has a `Unique` table (0.064) and an `Other` table (0.280)
 *    that do not add up to anything, because the crate's contents scale with points;
 *    it is refused rather than guessed.
 *
 * So the parser keeps each table's **heading path**, and the caller groups tables into
 * a roll. Grouping is checked against the sum (a group must reach 1.0), which turns a
 * mis-curated page into a warning instead of a wrong number.
 *
 * Quantities go through `parseQuantity` (`src/domain/ev.ts`), so a published range is
 * priced at its midpoint and flagged as an assumption (`docs/skilling-plan.md` §3.1a).
 */

import { parseQuantity, parseRarity } from '../domain/ev.js';
import type { EvDrop } from '../domain/ev.js';
import { fetchPageWikitext } from './wikiPages.js';

/** One table on the page, with the headings it sits under. */
export interface LootTable {
  /** Heading path, outermost first, e.g. `['Low-tier loot table', 'Runes and ammunition']`. */
  path: string[];
  drops: EvDrop[];
  /** Sum of the readable chances in this table. */
  chanceSum: number;
  /** Lines dropped because their quantity or rarity could not be read. */
  skipped: number;
}

const PARAM = {
  name: /\|\s*name\s*=\s*([^|\n}]*)/i,
  quantity: /\|\s*quantity\s*=\s*([^|\n}]*)/i,
  rarity: /\|\s*rarity\s*=\s*([^|\n}]*)/i,
} as const;

/** Heading text with its `=` markers stripped. */
function headingOf(line: string): { depth: number; text: string } | null {
  const match = /^(=+)\s*(.+?)\s*=+\s*$/.exec(line);
  if (match === null) return null;
  return { depth: (match[1] ?? '').length, text: (match[2] ?? '').trim() };
}

/**
 * Every `{{DropsLine}}` / `{{DropsLineReward}}` table on the page, in document order.
 *
 * A table ends at the next heading, which is how the wiki itself splits them: one
 * section per roll category (and, for a tiered reward, one parent section per tier).
 */
export function parseLootTables(text: string): LootTable[] {
  const tables: LootTable[] = [];
  const stack: string[] = [];
  let current: LootTable | null = null;

  const finish = (): void => {
    if (current !== null && (current.drops.length > 0 || current.skipped > 0)) {
      tables.push(current);
    }
    current = null;
  };

  for (const line of text.split('\n')) {
    const heading = headingOf(line);
    if (heading !== null) {
      finish();
      stack.length = Math.max(0, heading.depth - 2);
      stack[heading.depth - 2] = heading.text;
      continue;
    }

    const open = /\{\{\s*DropsLine(Reward|Skill)?\b[\s\S]*?\}\}/gi;
    for (const match of line.matchAll(open)) {
      const block = match[0];
      const param = (key: keyof typeof PARAM): string | null => {
        const found = PARAM[key].exec(block);
        return found === null ? null : (found[1] ?? '').trim();
      };

      const item = param('name');
      const quantityRaw = param('quantity');
      const rarityRaw = param('rarity');
      current ??= { path: [...stack], drops: [], chanceSum: 0, skipped: 0 };
      if (item === null || quantityRaw === null || rarityRaw === null) {
        current.skipped += 1;
        continue;
      }

      const quantity = parseQuantity(quantityRaw);
      const chance = parseRarity(rarityRaw);
      if (quantity === null || chance === null) {
        current.skipped += 1;
        continue;
      }
      current.drops.push({ item, ...quantity, chance });
      current.chanceSum += chance;
    }
  }
  finish();
  return tables;
}

/**
 * Group tables into rolls: consecutive tables whose chances add up to one.
 *
 * `Always` lines are guaranteed and do not consume the roll, so they are pulled out
 * and attached to the group that follows. A group that never reaches 1.0 is returned
 * with its actual sum, and the caller decides whether that is close enough — a table
 * that quietly sums to 0.28 is the Wintertodt crate, not a roll.
 */
export interface LootRoll {
  /** Table headings that make up this roll, in document order. */
  paths: string[][];
  drops: EvDrop[];
  chanceSum: number;
  /** Chance from `Always` lines, which are not part of the roll. */
  guaranteedChance: number;
  skipped: number;
}

export function groupRolls(
  tables: readonly LootTable[],
  options: { tolerance?: number } = {},
): LootRoll[] {
  const tolerance = options.tolerance ?? 0.01;
  const rolls: LootRoll[] = [];
  let pending: LootRoll | null = null;

  const openRoll = (): LootRoll => {
    pending ??= {
      paths: [],
      drops: [],
      chanceSum: 0,
      guaranteedChance: 0,
      skipped: 0,
    };
    return pending;
  };

  for (const table of tables) {
    const roll = openRoll();
    roll.paths.push(table.path);
    roll.skipped += table.skipped;
    for (const drop of table.drops) {
      roll.drops.push(drop);
      if (drop.chance === 1) roll.guaranteedChance += 1;
      else roll.chanceSum += drop.chance;
    }
    if (roll.chanceSum >= 1 - tolerance) {
      rolls.push(roll);
      pending = null;
    }
  }
  if (pending !== null) rolls.push(pending);

  return rolls;
}

/** One page's worth of parsed rolls. */
export interface LootPageResult {
  page: string;
  rolls: LootRoll[];
  fetchedAt: number;
}

/** Batch-fetch a page and parse its loot tables. One request per 50 pages, 24h cache. */
export async function fetchLootTables(
  pages: readonly string[],
): Promise<Map<string, LootPageResult>> {
  const fetched = await fetchPageWikitext([...pages]);
  const results = new Map<string, LootPageResult>();
  for (const page of pages) {
    const text = fetched.pages.get(page) ?? null;
    if (text === null) continue;
    results.set(page, {
      page,
      rolls: groupRolls(parseLootTables(text)),
      fetchedAt: fetched.fetchedAt,
    });
  }
  return results;
}
