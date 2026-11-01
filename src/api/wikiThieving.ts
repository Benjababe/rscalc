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
 */

import { parseRarity } from '../domain/ev.js';
import type { EvDrop } from '../domain/ev.js';
import { fetchPageWikitext } from './wikiPages.js';

export interface ThievingSource {
  /** Page name, also the row's source link. */
  source_pages: string;
  /** What you steal from, e.g. `Man` or `Bakery stall`. */
  name: string;
  kind: 'Pickpocket' | 'Stall' | 'Other';
  level: number | null;
  xp: number | null;
  /** Seconds per attempt, from the template's `time`. */
  secondsPerAction: number | null;
  drops: EvDrop[];
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
  const start = /\{\{\s*Thieving info\b/i.exec(text)?.index ?? -1;
  if (start < 0) return null;
  let depth = 0;
  let end = -1;
  for (let i = start; i < text.length - 1; i += 1) {
    const pair = text.slice(i, i + 2);
    if (pair === '{{') {
      depth += 1;
      i += 1;
    } else if (pair === '}}') {
      depth -= 1;
      i += 1;
      if (depth === 0) {
        end = i + 1;
        break;
      }
    }
  }
  if (end < 0) return null;
  const body = text.slice(start, end);
  const params = new Map<string, string>();
  for (const line of body.split('\n')) {
    const match = /^\s*\|\s*([a-z0-9_ ]+)\s*=\s*([\s\S]*)$/i.exec(line);
    if (match === null) continue;
    const key = (match[1] ?? '').trim().toLowerCase();
    if (!params.has(key)) params.set(key, (match[2] ?? '').trim());
  }
  return params;
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
  const { drops, rejected } = parseLootDrops(wikitext);

  return {
    source: {
      source_pages: page,
      name: info.get('name') ?? page,
      kind,
      level: Number.isFinite(level) ? level : null,
      xp: Number.isFinite(xp) ? xp : null,
      secondsPerAction: parseActionSeconds(info.get('time') ?? ''),
      drops,
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
