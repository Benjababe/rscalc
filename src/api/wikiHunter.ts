/**
 * Hunter creatures: what one successful catch yields, and what a trap attempt
 * costs in time.
 *
 * Source: a creature page such as `Carnivorous chinchompa` carries
 *
 *   {{Hunter info|name = Carnivorous chinchompa|level = 63|xp = 265
 *    |trap = {{plink|Box trap}}}}
 *   ===Hunting chance===
 *   {{Skilling success chart|label=Carnivorous chinchompa catch chance
 *    |label1=Carnivorous chinchompa|low1=...|high1=...|req1=63}}
 *
 * and a `{{DropsLineSkill}}` table. Two sourced pieces make a row:
 *
 * 1. **The catch.** The table's `Always` lines are what a successful catch gives
 *    (bones, fur, meat for a polar kebbit; the chinchompa itself for a carnivorous
 *    one). They are priced as a set, because several guaranteed drops happen
 *    together (`src/domain/ev.ts`).
 * 2. **The chance.** The chart's first option, through
 *    `src/domain/successChance.ts`. A catch is a roll, so the per-attempt
 *    expectation is the guaranteed set times that chance.
 *
 * ## Time: only box traps publish one
 *
 * <https://oldschool.runescape.wiki/w/Box_trap> states the mechanic: "Once a box
 * trap has been set, it will make an attempt every 3 ticks (1.8 seconds)". That is
 * a published attempt interval, so a box-trap row gets a real `gpPerHour`.
 *
 * Every other trap type — noose wand, bird snare, net trap, rabbit snare, pitfall,
 * butterfly net — publishes no interval on its own page, so those rows carry
 * `secondsPerAction = null` and `gpPerHour = null` rather than a guessed rate.
 *
 * Lines that are neither guaranteed nor readable (a `Very rare` pet, a
 * rumour-only drop such as `Red chinchompa tuft`) are **excluded and counted**:
 * they are not part of the catch, and an unreadable rarity has no expectation.
 * Pricing them would need their own distribution.
 */

import type { EvDrop } from '../domain/ev.js';
import { parseQuantity, parseRarity } from '../domain/ev.js';
import { chartOptionAtLevel, successChanceAt } from '../domain/successChance.js';
import type { SuccessChart } from '../domain/successChance.js';
import { fetchPageWikitext } from './wikiPages.js';
import { firstTemplateParams } from './wikiParams.js';
import { parseSuccessChart } from './wikiSuccessChart.js';

/**
 * Seconds between box-trap attempts: "an attempt every 3 ticks (1.8 seconds)".
 * <https://oldschool.runescape.wiki/w/Box_trap#Mechanics>
 *
 * Kept for the record and for the tests, but **deliberately not used as a row's
 * `secondsPerAction`**. That sentence describes how often a *set trap* checks for
 * an animal "currently in range", which is a ceiling on one trap, not the rate a
 * player achieves: spawn density, competition and the walk between traps decide
 * the rest, and nothing publishes those. Turning it into gp/hour would put
 * 1.01M/h at the top of `#/earn` for a number no player can realise — the exact
 * failure mode this project treats as worse than publishing nothing. So a Hunter
 * row keeps `gpPerHour = null` and states why (`parseHunterSource`).
 */
export const BOX_TRAP_ATTEMPT_SECONDS = 1.8;

export interface HunterSource {
  source_pages: string;
  /** The creature, e.g. `Carnivorous chinchompa`. */
  name: string;
  kind: 'Hunter';
  level: number | null;
  xp: number | null;
  /**
   * Always null: see `BOX_TRAP_ATTEMPT_SECONDS` for why a trap's attempt interval is
   * a ceiling rather than an activity rate. The per-attempt expectation is the row.
   */
  secondsPerAction: null;
  /** The trap's published attempt interval, recorded for auditability. */
  trapAttemptSeconds: number | null;
  /** The trap as the page names it, for the row's `tools`. */
  trap: string | null;
  /** Chance one attempt catches the creature, from the chart's first option. */
  successChance: number | null;
  /** What one successful catch yields: the table's guaranteed lines. */
  drops: EvDrop[];
  /** Table lines left out (a pet roll, a rumour-only drop), for the coverage line. */
  ignoredDrops: number;
  url: string;
}

export interface HunterParseResult {
  source: HunterSource | null;
  rejected: null | 'no-hunter-info' | 'no-chart' | 'no-guaranteed-drop';
  /** Table lines left out of the row. */
  ignored: number;
}

const wikiUrl = (page: string): string =>
  `https://oldschool.runescape.wiki/w/${encodeURIComponent(page.replace(/ /g, '_'))}`;

/** Parameter pairs of the first `{{Hunter info}}` block. */
function hunterInfo(text: string): Map<string, string> | null {
  return firstTemplateParams(text, ['Hunter info']);
}

/** `{{plink|Box trap}}` -> `Box trap`. */
function plinkText(raw: string): string {
  const match = /\{\{\s*plink\s*\|\s*([^|}]*)/i.exec(raw);
  if (match !== null) return (match[1] ?? '').trim();
  return raw.replace(/[[\]{}]/g, '').trim();
}

/**
 * The attempt interval a trap type publishes, or null.
 *
 * Only the box trap does (`BOX_TRAP_ATTEMPT_SECONDS`); every other trap page was
 * checked and states no interval, so the row keeps a null rate.
 */
export function trapSeconds(trap: string | null): number | null {
  if (trap === null) return null;
  return /box trap/i.test(trap) ? BOX_TRAP_ATTEMPT_SECONDS : null;
}

const PARAM = {
  skill: /\|\s*skill\s*=\s*([^|\n}]*)/i,
  name: /\|\s*name\s*=\s*([^|\n}]*)/i,
  quantity: /\|\s*quantity\s*=\s*([^|\n}]*)/i,
  rarity: /\|\s*rarity\s*=\s*([^|\n}]*)/i,
} as const;

/**
 * Split a creature's `{{DropsLineSkill}}` table into the guaranteed catch and the
 * lines that are not part of it.
 */
export function hunterDrops(text: string): { drops: EvDrop[]; ignored: number } {
  const drops: EvDrop[] = [];
  let ignored = 0;

  for (const match of text.matchAll(/\{\{\s*DropsLineSkill\b([\s\S]*?)\}\}/gi)) {
    const body = match[1] ?? '';
    const param = (key: keyof typeof PARAM): string | null => {
      const found = PARAM[key].exec(body);
      return found === null ? null : (found[1] ?? '').trim();
    };

    const skill = (param('skill') ?? '').toLowerCase();
    if (skill !== '' && skill !== 'hunter') continue;

    const item = param('name');
    const quantityRaw = param('quantity');
    const rarityRaw = param('rarity');
    if (item === null || quantityRaw === null || rarityRaw === null) {
      ignored += 1;
      continue;
    }
    const quantity = parseQuantity(quantityRaw);
    const chance = parseRarity(rarityRaw);
    // Guaranteed and exactly countable only: everything else is not part of the
    // catch (a pet, a rumour drop) or has no expectation.
    if (chance !== 1 || quantity === null) {
      ignored += 1;
      continue;
    }
    drops.push({ item, ...quantity, chance });
  }

  return { drops, ignored };
}

/** Parse one page's wikitext. */
export function parseHunterSource(page: string, wikitext: string): HunterParseResult {
  const info = hunterInfo(wikitext);
  if (info === null) return { source: null, rejected: 'no-hunter-info', ignored: 0 };

  const chart = parseSuccessChart(wikitext);
  if (chart === null) return { source: null, rejected: 'no-chart', ignored: 0 };

  const level = Number.parseInt(info.get('level') ?? '', 10);
  const levelOrNull = Number.isFinite(level) ? level : null;
  // One chart can hold an option per creature colour (`Grey` / `Red` / `Black`
  // chinchompa), so the option is chosen by this creature's own level rather than
  // by page position — otherwise a red chinchompa would be priced at grey odds.
  const option = chartOptionAtLevel(chart, levelOrNull);
  const successChance =
    option === null ? null : successChanceAt(option, levelOrNull ?? option.requiredLevel);

  const { drops, ignored } = hunterDrops(wikitext);
  if (drops.length === 0) {
    return { source: null, rejected: 'no-guaranteed-drop', ignored };
  }

  const trap = info.has('trap') ? plinkText(info.get('trap') ?? '') : null;
  const xp = Number.parseFloat(info.get('xp') ?? '');
  return {
    source: {
      source_pages: page,
      name: info.get('name') ?? page,
      kind: 'Hunter',
      level: levelOrNull,
      xp: Number.isFinite(xp) ? xp : null,
      // Null, not the trap interval: see `BOX_TRAP_ATTEMPT_SECONDS`.
      secondsPerAction: null,
      trapAttemptSeconds: trapSeconds(trap),
      trap,
      successChance,
      drops,
      ignoredDrops: ignored,
      url: wikiUrl(page),
    },
    rejected: null,
    ignored,
  };
}

export interface HunterFetchResult {
  sources: HunterSource[];
  requested: number;
  missing: number;
  rejected: number;
  ignored: number;
  fetchedAt: number;
}

/** Batch-fetch and parse. One request per 50 pages, 24h cache. */
export async function fetchHunterSources(
  pages: readonly string[],
): Promise<HunterFetchResult> {
  const fetched = await fetchPageWikitext([...pages]);
  const sources: HunterSource[] = [];
  let missing = 0;
  let rejected = 0;
  let ignored = 0;

  for (const title of pages) {
    const wikitext = fetched.pages.get(title) ?? null;
    if (wikitext === null) {
      missing += 1;
      continue;
    }
    const parsed = parseHunterSource(title, wikitext);
    ignored += parsed.ignored;
    if (parsed.source === null) {
      rejected += 1;
      continue;
    }
    sources.push(parsed.source);
  }

  return { sources, requested: pages.length, missing, rejected, ignored, fetchedAt: fetched.fetchedAt };
}

/** The chart's level gate, for a creature priced at its own requirement. */
export function hunterChartLevel(chart: SuccessChart): number | null {
  const levels = chart.options
    .map((option) => option.requiredLevel)
    .filter((level) => Number.isFinite(level) && level > 0);
  return levels.length === 0 ? null : Math.max(...levels);
}
