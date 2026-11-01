/**
 * Fishing methods: what one attempt can catch, from the page's own success chart.
 *
 * Source: a fishing page (a spot page such as `Monkfish fishing spot`, or an item
 * page such as `Raw shrimps`) carries
 *
 *   {{Fishing info|name = Fishing spot|level = 62|xp = 120|tool = ...}}
 *   ===Fishing chance===
 *   {{Skilling success chart|label=Monkfish fishing chance|showbefore=no
 *    |label1=Raw monkfish|low1=48|high1=90|req1=62|...}}
 *
 * The chart is the distribution: each option's label is the item caught and its
 * `low`/`high` give the chance through `src/domain/successChance.ts`. A cascading
 * chart (`cascade=yes`, e.g. trout + salmon, barbarian fishing) rolls the best
 * reward first, which `chartDistribution` already models, so one attempt's
 * expectation is `sum(chance x price)`.
 *
 * The drop tables on those pages are *not* used: their rarities are written as
 * `Always`/`common`/`very rare`, which is not a probability, so the chart is the
 * only quantified source.
 *
 * **Fishing has no published attempt interval.** No fishing page states how often
 * an attempt is rolled, so `secondsPerAction` is `null` and the row keeps
 * `gpPerHour = null` — the §4 rule: a per-attempt profit is publishable, an hour
 * is not invented. Bait is charged per catch, not per attempt, and an attempt that
 * catches nothing consumes none, so it is priced through the same expectation
 * rather than as a flat input.
 */

import type { EvDrop } from '../domain/ev.js';
import { chartDistribution } from '../domain/successChance.js';
import type { SuccessChart } from '../domain/successChance.js';
import { fetchPageWikitext } from './wikiPages.js';
import { firstTemplateParams } from './wikiParams.js';
import { parseSuccessChart } from './wikiSuccessChart.js';

export interface FishingSource {
  /** Page name, also the row's source link. */
  source_pages: string;
  /** The method as the page names it, e.g. `Monkfish fishing spot`. */
  name: string;
  kind: 'Fishing';
  /** Highest level the chart gates: the level at which the whole method unlocks. */
  level: number | null;
  xp: number | null;
  /** Always null: no fishing page publishes an attempt interval. */
  secondsPerAction: null;
  /**
   * The per-attempt outcome distribution, from the chart. Chances need not sum to
   * one: the remainder is a failed attempt, which catches nothing.
   */
  drops: EvDrop[];
  url: string;
}

export interface FishingParseResult {
  source: FishingSource | null;
  /** Why the page produced no row, when it did not. */
  rejected:
    | null
    | 'no-fishing-info'
    | 'no-chart'
    | 'label-not-a-drop'
    | 'no-outcome';
}

const wikiUrl = (page: string): string =>
  `https://oldschool.runescape.wiki/w/${encodeURIComponent(page.replace(/ /g, '_'))}`;

/** Parameter pairs of the first `{{Fishing info}}` block. */
function fishingInfo(text: string): Map<string, string> | null {
  return firstTemplateParams(text, ['Fishing info']);
}

/** The level a chart unlocks at: the highest `req` among its options. */
export function chartLevel(chart: SuccessChart): number | null {
  const levels = chart.options
    .map((option) => option.requiredLevel)
    .filter((level) => Number.isFinite(level) && level > 0);
  return levels.length === 0 ? null : Math.max(...levels);
}

/**
 * Price one attempt's distribution from a chart.
 *
 * Options whose label is empty are unusable — without a label there is no item to
 * price — so the row is refused rather than priced on the rest, which would
 * silently renormalise the chances.
 */
export function chartDrops(chart: SuccessChart, level: number): EvDrop[] | null {
  if (chart.options.some((option) => option.label === '')) return null;
  return chartDistribution(chart, level).map((outcome) => ({
    item: outcome.label,
    quantity: 1,
    chance: outcome.chance,
  }));
}

/**
 * The items a page's `{{DropsLineSkill}}` table names, in page order.
 *
 * Every line is read, including the ones whose rarity is written as a word: this
 * list is used as a *name* index, not as a distribution, so an unreadable rarity
 * is harmless here.
 */
export function tableItemNames(text: string): string[] {
  const names: string[] = [];
  for (const match of text.matchAll(/\{\{\s*DropsLineSkill\b([\s\S]*?)\}\}/gi)) {
    const body = match[1] ?? '';
    const skill = /\|\s*skill\s*=\s*([^|\n}]*)/i.exec(body)?.[1]?.trim().toLowerCase();
    if (skill !== undefined && skill !== 'fishing') continue;
    const name = /\|\s*name\s*=\s*([^|\n}]*)/i.exec(body)?.[1]?.trim();
    if (name !== undefined && name !== '') names.push(name);
  }
  return names;
}

/**
 * Map every chart label onto the item name the page's drop table uses.
 *
 * This is the check that stops a chart label being mistaken for an item. Chart
 * labels are written for a chart, not for a price lookup, and reality is messy:
 * the monkfish chart says `Raw monkfish` (usable), but the shark chart says
 * `Harpoon` (a tool), the anglerfish chart says `Sandworms` (bait) and the dark
 * crab chart says `Normal` (a variant selector). Pricing those as items would
 * invent a row about the wrong thing, so a label that is not one of the page's own
 * published drops refuses the whole chart.
 *
 * Matching is case-insensitive and returns the **table's** spelling, so the GE
 * lookup downstream gets the canonical item name.
 */
export function matchChartToTable(
  chart: SuccessChart,
  tableNames: readonly string[],
): string[] | null {
  const byLower = new Map(tableNames.map((name) => [name.toLowerCase(), name]));
  const mapped: string[] = [];
  for (const option of chart.options) {
    const name = byLower.get(option.label.toLowerCase());
    if (name === undefined) return null;
    mapped.push(name);
  }
  return mapped;
}

/**
 * Parse one page's wikitext.
 *
 * `dropsText` is the wikitext of the page that publishes the drop table, when it
 * is not this one: an item page carries the success chart and names its spot with
 * `|spot = [[...]]`, while the spot page carries the `{{DropsLineSkill}}` table.
 * Pass the spot's text and the two are reconciled; pass null and both must be on
 * this page.
 */
export function parseFishingSource(
  page: string,
  wikitext: string,
  dropsText: string | null = null,
): FishingParseResult {
  const info = fishingInfo(wikitext);
  if (info === null) return { source: null, rejected: 'no-fishing-info' };

  const chart = parseSuccessChart(wikitext);
  if (chart === null) return { source: null, rejected: 'no-chart' };

  const level = chartLevel(chart);
  if (level === null) return { source: null, rejected: 'no-chart' };

  const tableNames = [
    ...tableItemNames(wikitext),
    ...(dropsText === null ? [] : tableItemNames(dropsText)),
  ];
  const mappedLabels = matchChartToTable(chart, tableNames);
  if (mappedLabels === null) return { source: null, rejected: 'label-not-a-drop' };

  const charted = chartDrops(chart, level);
  if (charted === null || charted.length === 0) {
    return { source: null, rejected: 'no-outcome' };
  }
  // Use the drop table's spelling for the item, keeping the chart's chances.
  const drops = charted.map((drop, index) => ({
    ...drop,
    item: mappedLabels[index] ?? drop.item,
  }));

  const xp = Number.parseFloat(info.get('xp') ?? '');
  return {
    source: {
      source_pages: page,
      name: info.get('name') ?? page,
      kind: 'Fishing',
      level,
      xp: Number.isFinite(xp) ? xp : null,
      secondsPerAction: null,
      drops,
      url: wikiUrl(page),
    },
    rejected: null,
  };
}

/** The page this one names in `|spot = [[...]]`, or null. */
export function spotPage(wikitext: string): string | null {
  const params = fishingInfo(wikitext);
  const raw = params?.get('spot') ?? '';
  const link = /\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/.exec(raw);
  if (link !== null) return (link[1] ?? '').trim();
  const plain = raw.trim();
  return plain === '' ? null : plain;
}

export interface FishingFetchResult {
  sources: FishingSource[];
  requested: number;
  missing: number;
  rejected: number;
  fetchedAt: number;
}

/**
 * Batch-fetch and parse, following `|spot =` when a page has no drop table of its
 * own. Two batched requests at most: the curated pages plus their spot pages.
 */
export async function fetchFishingSources(
  pages: readonly string[],
): Promise<FishingFetchResult> {
  const fetched = await fetchPageWikitext([...pages]);
  const spotTargets = [
    ...new Set(
      pages
        .map((title) => fetched.pages.get(title) ?? null)
        .filter((text): text is string => text !== null)
        .map((text) => spotPage(text))
        .filter((title): title is string => title !== null),
    ),
  ];
  const spotText =
    spotTargets.length === 0 ? null : await fetchPageWikitext(spotTargets);

  const sources: FishingSource[] = [];
  let missing = 0;
  let rejected = 0;

  for (const title of pages) {
    const wikitext = fetched.pages.get(title) ?? null;
    if (wikitext === null) {
      missing += 1;
      continue;
    }
    const spot = spotPage(wikitext);
    const dropsText =
      spot === null || spotText === null ? null : spotText.pages.get(spot) ?? null;
    const parsed = parseFishingSource(title, wikitext, dropsText);
    if (parsed.source === null) {
      rejected += 1;
      continue;
    }
    sources.push(parsed.source);
  }

  return { sources, requested: pages.length, missing, rejected, fetchedAt: fetched.fetchedAt };
}
