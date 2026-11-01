/**
 * Thieving sources: pickpocket targets and stalls, with their published action
 * time and loot table.
 *
 * Source: each NPC/stall page carries
 *
 *   {{Thieving info|name = Man|level = 1|xp = 8|type = Pickpocket
 *    |timename = [[Stun_(status)#Thieving|Stun]] Timer|time = 4.8s|damage = 1}}
 *
 * followed by a drop table written with `{{DropsLineSkill|name=…|quantity=…
 * |rarity=…|skill=Thieving}}`. Examples: <https://oldschool.runescape.wiki/w/Man>,
 * <https://oldschool.runescape.wiki/w/Bakery_stall>.
 *
 * That is enough for an expectation: a time per action and a probability per
 * outcome. The checks live in `src/domain/ev.ts` — a ranged quantity or an
 * unreadable rarity invalidates the row rather than being averaged.
 *
 * Only the **loot** tables are read: sections after a `Tertiary` heading hold the
 * pet roll (`Rocky`, 1/257,211) and similar, which are not what a pickpocket
 * yields in practice and would distort the mean if they were included.
 *
 * ## Pickpockets are a different shape, twice over
 *
 * 1. **The loot is conditional on success.** A pickpocket's table is what a
 *    *successful* attempt yields (`Coins 3 Always` for a `Man`), and a failed
 *    attempt yields nothing and stuns you. So the per-attempt expectation is the
 *    table times the success chance, which the page publishes in a
 *    `{{Skilling success chart}}` block (`low1`/`high1` per level, see
 *    `src/domain/successChance.ts`).
 * 2. **The `time` parameter is the stun timer, not an action time.** For a stall,
 *    `|time = 2.4 seconds` is how long the steal takes. For a pickpocket,
 *    `|timename = [[Stun (status)#Thieving|Stun]] Timer` says the same field is how
 *    long a *failure* locks you out, so reading it as the action time would price
 *    every failed attempt as a slow success. The action itself is published on
 *    the skill page instead:
 *
 *      "NPCs may be pickpocketed every two ticks (1.2 seconds)" and "being stunned
 *      prevents ... from further pickpocketing for eight ticks (4.8s)", so "every
 *      pickpocket will take on average 2+8(1-p) = 10-8p ticks".
 *      <https://oldschool.runescape.wiki/w/Thieving#Pickpocketing>
 *
 *    That formula is what this module implements: `2 ticks + stun x (1 - p)`.
 *    The per-NPC stun length comes from the page's own `time` parameter, so it is
 *    sourced per target rather than assumed.
 *
 * A target with no success chart, no loot table, or a stun timer and no chart
 * cannot be priced; each of those is counted, never guessed.
 */

import { parseRarity } from '../domain/ev.js';
import type { EvDrop } from '../domain/ev.js';
import { SECONDS_PER_TICK } from '../domain/processTime.js';
import { successChanceAt } from '../domain/successChance.js';
import type { SuccessChart } from '../domain/successChance.js';
import { chartOptionAtLevel } from '../domain/successChance.js';
import { fetchPageWikitext } from './wikiPages.js';
import { firstTemplateParams } from './wikiParams.js';
import { parseSuccessChart } from './wikiSuccessChart.js';

/**
 * Ticks between two pickpocket attempts, published on the Thieving page: "NPCs
 * may be pickpocketed every two ticks (1.2 seconds)".
 * <https://oldschool.runescape.wiki/w/Thieving#Pickpocketing>
 */
export const PICKPOCKET_ATTEMPT_TICKS = 2;

export interface ThievingSource {
  /** Page name, also the row's source link. */
  source_pages: string;
  /** What you steal from, e.g. `Man` or `Bakery stall`. */
  name: string;
  kind: 'Pickpocket' | 'Stall' | 'Other';
  level: number | null;
  xp: number | null;
  /**
   * Seconds per attempt. For a stall that is the template's `time`; for a
   * pickpocket it is the published `2 + stun x (1 - p)` model, and `null` when the
   * page publishes no success chance to put in it.
   */
  secondsPerAction: number | null;
  /**
   * Chance that one attempt succeeds, from the page's success chart. `null` when
   * the page has none, and `1` for a stall, which does not fail.
   */
  successChance: number | null;
  /** True when `drops` is the table for a *successful* attempt. */
  dropsConditionalOnSuccess: boolean;
  drops: EvDrop[];
  /**
   * Table lines that were dropped because they were unreadable (a ranged quantity,
   * an unparseable rarity). Any dropped line invalidates the row: a table minus its
   * biggest outcome is not the table, so no price is published from it.
   */
  droppedLines: number;
  /** Where the parsed numbers came from. */
  url: string;
}

export interface ThievingParseResult {
  source: ThievingSource | null;
  /** Rows whose quantity was a range or whose rarity could not be read. */
  rejected: number;
}

const wikiUrl = (page: string): string =>
  `https://oldschool.runescape.wiki/w/${encodeURIComponent(page.replace(/ /g, '_'))}`;

/** Parameter `key = value` pairs from the first `{{Thieving info}}` block. */
function thievingInfo(text: string): Map<string, string> | null {
  return firstTemplateParams(text, ['Thieving info']);
}

/** `5s`, `2.4 seconds`, `1.8s` -> seconds. */
export function parseActionSeconds(raw: string): number | null {
  const text = raw.replace(/[[\]]/g, '');
  const match = /(\d+(?:\.\d+)?)\s*(s\b|sec|secs|second|seconds)?/i.exec(text);
  if (match === null) return null;
  const value = Number.parseFloat(match[1] ?? '');
  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.round(value * 10) / 10;
}

/**
 * The four parameters this parser reads.
 *
 * Literal patterns rather than one built from the key: a dynamic `RegExp` fed a
 * parameter name is the one thing in this file that could be talked into matching
 * something else, and there are only four keys.
 */
const PARAM = {
  skill: /\|\s*skill\s*=\s*([^|\n}]*)/i,
  name: /\|\s*name\s*=\s*([^|\n}]*)/i,
  quantity: /\|\s*quantity\s*=\s*([^|\n}]*)/i,
  rarity: /\|\s*rarity\s*=\s*([^|\n}]*)/i,
} as const;

/**
 * Every `{{DropsLineSkill}}` entry before the first `Tertiary`/`Rare` heading.
 *
 * The template's parameters arrive in any order across several lines, so the
 * block is read as a whole rather than line by line.
 */
export function parseLootDrops(text: string): { drops: EvDrop[]; rejected: number } {
  const lootOnly = text.split(/^=+\s*(Tertiary|Rare drop table|Pets?)\s*=+/im)[0] ?? text;
  const drops: EvDrop[] = [];
  let rejected = 0;

  for (const match of lootOnly.matchAll(/\{\{\s*DropsLineSkill\b([\s\S]*?)\}\}/gi)) {
    const body = match[1] ?? '';
    const param = (key: keyof typeof PARAM): string | null => {
      const found = PARAM[key].exec(body);
      return found === null ? null : (found[1] ?? '').trim();
    };

    const skill = (param('skill') ?? '').toLowerCase();
    // Only this skill's own drops; the same page can list other skills' loot.
    if (skill !== '' && skill !== 'thieving') continue;

    const item = param('name');
    const quantityRaw = param('quantity');
    const rarityRaw = param('rarity');
    if (item === null || quantityRaw === null || rarityRaw === null) {
      rejected += 1;
      continue;
    }

    // `1-4`, `1 - 4`, `1,000` (a comma is a thousands separator, not a range).
    const quantity = /-\s*\d/.test(quantityRaw)
      ? Number.NaN
      : Number.parseFloat(quantityRaw.replace(/,/g, ''));
    const chance = parseRarity(rarityRaw);
    if (!Number.isFinite(quantity) || quantity <= 0 || chance === null) {
      rejected += 1;
      continue;
    }
    drops.push({ item, quantity, chance });
  }

  return { drops, rejected };
}

/**
 * The text of the `== Loot ==` section, or null when the page has no such
 * heading.
 *
 * A pickpocket's own loot lives there (`Man`: "A successful pickpocket attempt
 * will gain the following loot"), separate from the NPC's *kill* drops, which sit
 * under `== Drops ==` and are a different action entirely. The section ends at
 * the next heading of any level, so the `=== Tertiary ===` pet roll that follows
 * it cannot leak in.
 */
export function lootSection(text: string): string | null {
  const start = /^=+\s*Loot\s*=+[^\n]*\n/im.exec(text)?.index ?? -1;
  if (start < 0) return null;
  const body = text.slice(start);
  const firstBreak = body.indexOf('\n');
  const rest = firstBreak < 0 ? '' : body.slice(firstBreak + 1);
  const end = /^=+[^=]/m.exec(rest)?.index ?? rest.length;
  return rest.slice(0, end);
}

/**
 * The pickpocket success chance at a level, from the page's chart.
 *
 * The chart lists the plain action first and then the same action with gloves, a
 * diary or a cape; `chartOptionAtLevel` picks the entry gated at the target's own
 * level, which resolves to `Normal` here and to the right creature on a chart whose
 * options are variants rather than gear.
 */
export function pickpocketChance(
  chart: SuccessChart | null,
  level: number | null,
): number | null {
  if (chart === null) return null;
  const option = chartOptionAtLevel(chart, level);
  if (option === null) return null;
  return successChanceAt(option, level ?? option.requiredLevel);
}

/**
 * Seconds per pickpocket attempt from the published model `2 + stun x (1 - p)`.
 *
 * `stunSeconds` is the page's `time` parameter (4.8s for a `Man`, which is the
 * eight-tick stun the skill page describes), and 2 ticks is the published gap
 * between attempts. Null when either half is unknown: without a success chance
 * there is no expectation to divide by.
 */
export function pickpocketSeconds(
  stunSeconds: number | null,
  successChance: number | null,
): number | null {
  if (stunSeconds === null || successChance === null) return null;
  const seconds =
    SECONDS_PER_TICK * PICKPOCKET_ATTEMPT_TICKS + stunSeconds * (1 - successChance);
  return Math.round(seconds * 100) / 100;
}

/** True when the template labels its `time` as a stun timer rather than an action time. */
function isStunTimer(timename: string): boolean {
  return /stun/i.test(timename);
}

/** Parse one page's wikitext. */
export function parseThievingSource(
  page: string,
  wikitext: string,
): ThievingParseResult {
  const info = thievingInfo(wikitext);
  if (info === null) return { source: null, rejected: 0 };

  const type = (info.get('type') ?? '').toLowerCase();
  let kind: ThievingSource['kind'] = 'Other';
  if (type === 'pickpocket') kind = 'Pickpocket';
  else if (type === 'stall') kind = 'Stall';

  const level = Number.parseInt(info.get('level') ?? '', 10);
  const xp = Number.parseFloat(info.get('xp') ?? '');
  const publishedSeconds = parseActionSeconds(info.get('time') ?? '');
  const stunTimer = isStunTimer(info.get('timename') ?? '');
  const chart = parseSuccessChart(wikitext);

  let secondsPerAction = publishedSeconds;
  let successChance: number | null = 1;
  let dropsConditionalOnSuccess = false;
  let drops: EvDrop[];
  let rejected: number;

  if (kind === 'Pickpocket') {
    // The loot is the *successful* attempt's table, and `time` is the stun, so
    // neither can be used as-is.
    successChance = pickpocketChance(chart, Number.isFinite(level) ? level : null);
    dropsConditionalOnSuccess = true;
    const section = lootSection(wikitext);
    const parsed = parseLootDrops(section === null ? '' : section);
    drops = parsed.drops;
    rejected = parsed.rejected;
    secondsPerAction = pickpocketSeconds(
      stunTimer ? publishedSeconds : null,
      successChance,
    );
  } else {
    const parsed = parseLootDrops(wikitext);
    drops = parsed.drops;
    rejected = parsed.rejected;
    // A stall does not have a success roll; the `time` is the action.
    if (stunTimer) secondsPerAction = null;
  }

  return {
    source: {
      source_pages: page,
      name: info.get('name') ?? page,
      kind,
      level: Number.isFinite(level) ? level : null,
      xp: Number.isFinite(xp) ? xp : null,
      secondsPerAction,
      successChance,
      dropsConditionalOnSuccess,
      drops,
      droppedLines: rejected,
      url: wikiUrl(page),
    },
    rejected,
  };
}

export interface ThievingFetchResult {
  sources: ThievingSource[];
  requested: number;
  missing: number;
  rejected: number;
  fetchedAt: number;
}

/** Batch-fetch and parse. 24h cache, one request per 50 pages. */
export async function fetchThievingSources(
  pages: readonly string[],
): Promise<ThievingFetchResult> {
  const page = await fetchPageWikitext([...pages]);
  const sources: ThievingSource[] = [];
  let missing = 0;
  let rejected = 0;

  for (const title of pages) {
    const wikitext = page.pages.get(title) ?? null;
    if (wikitext === null) {
      missing += 1;
      continue;
    }
    const parsed = parseThievingSource(title, wikitext);
    if (parsed.source === null) {
      missing += 1;
      continue;
    }
    rejected += parsed.rejected;
    sources.push(parsed.source);
  }

  return { sources, requested: pages.length, missing, rejected, fetchedAt: page.fetchedAt };
}
