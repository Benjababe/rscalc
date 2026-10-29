/**
 * Parser for the OSRS Wiki's structured shop catalogue.
 *
 *   https://oldschool.runescape.wiki/w/Special:Bucket?bucket=storeline
 *
 * The Bucket extension serves the wiki's own stock tables as an HTML table with
 * a stable header row. We parse by *header name*, never by column index, so a
 * column reordering upstream fails loudly instead of silently shifting every
 * price by one field.
 *
 * Verified live: 15 columns, in this order —
 *   page_name, page_name_sub, sold_by, sold_item, sold_item_image,
 *   store_buy_price, store_sell_price, store_currency, store_delta,
 *   store_stock, store_buy_multiplier, store_sell_multiplier, restock_time,
 *   store_notes, sold_item_json
 */

import { z } from 'zod';
import { fetchText } from './http.js';
import { decodeEntities, extractRows } from './wikiTable.js';

// Kept as a re-export for callers that predate the shared table parser.
export { decodeEntities };

const WIKI = 'https://oldschool.runescape.wiki';
export const STORELINE_BUCKET_URL = `${WIKI}/w/Special:Bucket?bucket=storeline`;

export interface RawStoreLine {
  /** Wiki page title of the shop, e.g. `Bob's Brilliant Axes.` */
  shopPage: string;
  /** NPC behind the counter. */
  soldBy: string | null;
  /** Item as listed in the stock table. */
  itemName: string;
  /** `store_sell_multiplier` — shop sells at this/1000 of value. */
  sellMultiplier: number;
  /** `store_buy_multiplier` — shop buys at this/1000 of value. */
  buyMultiplier: number;
  /** `store_delta` — price change per stock unit, this/1000 of value. */
  delta: number;
  /** Raw `store_stock` cell: a number, `∞`, or `N/A`. */
  stockRaw: string;
  /** Raw `restock_time` cell: ticks, or `N/A`. */
  restockRaw: string;
  storeSellPrice: number | null;
  storeBuyPrice: number | null;
  currency: string;
  members: boolean;
  location: string | null;
  leagueRegion: string | null;
}

// ---------------------------------------------------------------------------
// HTML table rows
// ---------------------------------------------------------------------------
// `extractRows` (and entity decoding) lives in `wikiTable.ts`, shared with the
// map bucket parser so both address columns by header name.

// ---------------------------------------------------------------------------
// Value coercion
// ---------------------------------------------------------------------------

/** Parse an integer cell, tolerating thousands separators. Null when unusable. */
export function parseIntCell(value: string): number | null {
  const cleaned = value.replace(/[,\s]/g, '');
  if (cleaned === '' || cleaned.toUpperCase() === 'N/A') return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
}

/**
 * Parse a stock cell. `∞` means infinite stock (handled by `infiniteStock`),
 * `N/A` means the shop has no stock column value. Both are `null` here so the
 * caller cannot accidentally treat `∞` as a number.
 */
export function parseStockCell(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === '∞' || trimmed === 'inf') return null;
  return parseIntCell(trimmed);
}

export function isInfiniteStock(value: string): boolean {
  const trimmed = value.trim();
  return trimmed === '∞' || trimmed === 'inf';
}

function optionalText(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === '' || trimmed.toUpperCase() === 'N/A' ? null : trimmed;
}

/** Strip the single trailing full stop the wiki uses on shop page titles. */
export function displayShopName(pageTitle: string): string {
  return pageTitle.replace(/\.$/, '').trim();
}

// ---------------------------------------------------------------------------
// sold_item_json
// ---------------------------------------------------------------------------

interface SoldItemJson {
  Members?: unknown;
  Location?: unknown;
  LeagueRegion?: unknown;
  'Display name'?: unknown;
}

/** Coerce a JSON field that should be text into text, else null. */
function asText(value: unknown): string | null {
  if (typeof value === 'string') return optionalText(cleanHtmlText(value));
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return null;
}

/**
 * Remove elements with a given class, balancing nested tags of the same name.
 *
 * The wiki's floor-number template renders both the UK and US floor conventions
 * (CSS hides one). A flat regex cannot remove the hidden one because `<span>`
 * nests inside `<span>`, so this walks the tags instead.
 */
function removeElementByClass(
  html: string,
  tagName: string,
  className: string,
): string {
  const opening = new RegExp(
    `<${tagName}\\b[^>]*class="[^"]*\\b${className}\\b[^"]*"[^>]*>`,
    'i',
  );
  let text = html;

  for (;;) {
    const match = opening.exec(text);
    if (match === null) return text;

    const start = match.index;
    const openingLength = (match[0] ?? '').length;
    const tags = new RegExp(`<\\/?${tagName}\\b[^>]*>`, 'gi');
    tags.lastIndex = start + openingLength;

    let depth = 1;
    let end = -1;
    let tagMatch: RegExpExecArray | null;
    while ((tagMatch = tags.exec(text)) !== null) {
      depth += (tagMatch[0] ?? '').startsWith('</') ? -1 : 1;
      if (depth === 0) {
        end = tagMatch.index + (tagMatch[0] ?? '').length;
        break;
      }
    }

    // Malformed HTML: leave the rest alone rather than truncating it.
    if (end === -1) return text;
    text = `${text.slice(0, start)}${text.slice(end)}`;
  }
}

/**
 * Turn a wiki-rendered HTML fragment into display text.
 *
 * `sold_item_json` fields are rendered HTML, not wikitext: a location can arrive
 * as the floor-number template's spans plus entities. Keeping the raw string
 * puts markup in the UI, so tags are removed, `<br>` becomes a separator, and
 * the duplicate UK/US floor conventions collapse to the UK wording (the wiki's
 * own locale).
 */
export function cleanHtmlText(raw: string): string {
  let text = removeElementByClass(raw, 'span', 'floornumber-us');
  text = removeElementByClass(text, 'sup', 'floornumber-help');
  text = text.replace(
    /<span[^>]*user-select\s*:\s*none[^>]*>[\s\S]*?<\/span>/gi,
    '',
  );
  text = text.replace(/<br\s*\/?>/gi, ' · ');
  text = decodeEntities(text.replace(/<[^>]*>/g, ''));
  return stripWikiMarkup(text);
}

/**
 * Strip wiki link and emphasis markup so headings like `East of [[Dark Warriors'
 * Fortress]]` render as plain text in the CLI and UI.
 *
 *   [[A|B]] -> B     [[A]] -> A     '''bold''' -> bold
 */
function stripWikiMarkup(text: string): string {
  return text
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/'''/g, '')
    .replace(/''/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The `Members` field is not consistently typed across the bucket: some rows
 * carry the string "Yes"/"No", others a boolean. Handle both rather than
 * trusting one shape and crashing the whole catalogue on the first odd row.
 */
function asBooleanFlag(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const normalised = value.trim().toLowerCase();
    return normalised === 'yes' || normalised === 'true' || normalised === '1';
  }
  return false;
}

function parseSoldItemJson(raw: string): SoldItemJson {
  if (raw.trim() === '') return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null ? (parsed as SoldItemJson) : {};
  } catch {
    return {};
  }
}

// ---------------------------------------------------------------------------
// Main parse
// ---------------------------------------------------------------------------

export function parseStoreBucket(html: string): RawStoreLine[] {
  const rows = extractRows(html);
  const headerRow = rows.find((row) => row.header);
  if (!headerRow) throw new Error('storeline bucket: no header row found');

  const index = new Map<string, number>();
  headerRow.cells.forEach((name, i) => index.set(name.toLowerCase(), i));

  const required = [
    'page_name',
    'sold_item',
    'store_buy_multiplier',
    'store_sell_multiplier',
    'store_delta',
    'store_stock',
    'restock_time',
  ];
  const missing = required.filter((name) => !index.has(name));
  if (missing.length > 0) {
    throw new Error(
      `storeline bucket: missing expected columns [${missing.join(', ')}]. ` +
        `Found [${headerRow.cells.join(', ')}]. The wiki changed its schema.`,
    );
  }

  const at = (cells: string[], name: string): string => {
    const position = index.get(name);
    return position === undefined ? '' : (cells[position] ?? '');
  };

  const out: RawStoreLine[] = [];
  for (const row of rows) {
    if (row.header) continue;
    const shopPage = cellTextAt(row.cells, index.get('page_name'));
    const itemName = at(row.cells, 'sold_item');
    if (shopPage === '' || itemName === '') continue;

    const json = parseSoldItemJson(at(row.cells, 'sold_item_json'));

    out.push({
      shopPage,
      soldBy: optionalText(at(row.cells, 'sold_by')),
      itemName,
      sellMultiplier: parseIntCell(at(row.cells, 'store_sell_multiplier')) ?? 1000,
      buyMultiplier: parseIntCell(at(row.cells, 'store_buy_multiplier')) ?? 1000,
      delta: parseIntCell(at(row.cells, 'store_delta')) ?? 0,
      stockRaw: at(row.cells, 'store_stock'),
      restockRaw: at(row.cells, 'restock_time'),
      storeSellPrice: parseIntCell(at(row.cells, 'store_sell_price')),
      storeBuyPrice: parseIntCell(at(row.cells, 'store_buy_price')),
      currency: optionalText(at(row.cells, 'store_currency')) ?? 'Coins',
      members: asBooleanFlag(json.Members),
      location: asText(json.Location),
      leagueRegion: asText(json.LeagueRegion),
    });
  }

  return out;
}

function cellTextAt(cells: string[], position: number | undefined): string {
  if (position === undefined) return '';
  return (cells[position] ?? '').trim();
}

/** Page size. The Bucket UI offers 50/100/250/500 and defaults to 20. */
const PAGE_SIZE = 500;
/** Hard stop so a pagination bug can never loop forever. */
const MAX_ROWS = 20_000;

/**
 * Fetch and parse the whole shop catalogue, following pagination.
 *
 * The Bucket special page serves 20 rows by default; the full storeline table is
 * several thousand rows across many pages. TTL 24h — shop stock rarely moves.
 */
export async function fetchStoreLines(): Promise<{
  lines: RawStoreLine[];
  fetchedAt: number;
  pages: number;
}> {
  const all: RawStoreLine[] = [];
  let offset = 0;
  let pages = 0;
  let lastFetched = Date.now();

  for (;;) {
    const url =
      `${WIKI}/w/Special:Bucket?bucket=storeline` +
      `&limit=${PAGE_SIZE}&offset=${offset}`;
    const { body, fetchedAt } = await fetchText(url, {
      ttlMs: 24 * 60 * 60 * 1000,
      headers: { Accept: 'text/html' },
    });

    const page = parseStoreBucket(body);
    pages += 1;
    lastFetched = fetchedAt;
    all.push(...page);

    // A short page means we've reached the end.
    if (page.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
    if (all.length >= MAX_ROWS) break;
  }

  return { lines: dedupe(all), fetchedAt: lastFetched, pages };
}

/**
 * Drop duplicate (shop, item, vendor) rows.
 * Pagination is not a consistent snapshot, so a row edited mid-run can appear on
 * two consecutive pages.
 */
function dedupe(lines: RawStoreLine[]): RawStoreLine[] {
  const seen = new Set<string>();
  const out: RawStoreLine[] = [];
  for (const line of lines) {
    const key = `${line.shopPage}\u0000${line.itemName}\u0000${line.soldBy ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(line);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Shop type enrichment
// ---------------------------------------------------------------------------

/**
 * Shape of a batched `prop=categories` response (formatversion=2).
 * Parsed at the boundary so nothing downstream sees `unknown`.
 */
const CategoriesResponseSchema = z.object({
  query: z
    .object({
      pages: z
        .array(
          z.object({
            title: z.string(),
            categories: z.array(z.object({ title: z.string() })).optional(),
          }),
        )
        .optional(),
    })
    .optional(),
});

/**
 * Map shop page titles to their wiki categories (e.g. `Magic shops`).
 *
 * One batched `prop=categories` call per 50 titles, so this is ~10 requests for
 * the whole game and stays well inside the 1 req/s budget.
 *
 * Categories containing "shop" or "store" are kept. The store half is needed
 * for `Category:General stores`, which the GE -> shop planner excludes by
 * category rather than by guessing from shop names.
 *
 * https://oldschool.runescape.wiki/api.php?action=query&prop=categories
 */
export async function fetchShopTypes(
  titles: string[],
): Promise<Map<string, string[]>> {
  const result = new Map<string, string[]>();
  const BATCH = 50;

  for (let i = 0; i < titles.length; i += BATCH) {
    const batch = titles.slice(i, i + BATCH);
    const url =
      `${WIKI}/api.php?action=query&format=json&formatversion=2` +
      `&prop=categories&cllimit=max&titles=${encodeURIComponent(batch.join('|'))}`;

    const { body } = await fetchText(url, {
      ttlMs: 24 * 60 * 60 * 1000,
      headers: { Accept: 'application/json' },
    });

    let rawJson: unknown;
    try {
      rawJson = JSON.parse(body);
    } catch {
      // A malformed MediaWiki response must not abort the whole catalogue;
      // the caller degrades to an empty shop-type list for these titles.
      continue;
    }

    const parsed = CategoriesResponseSchema.safeParse(rawJson);
    if (!parsed.success) continue;

    for (const page of parsed.data.query?.pages ?? []) {
      const categories = (page.categories ?? [])
        .map((category) => category.title.replace(/^Category:/, ''))
        .filter((category) => /shop|store/i.test(category));
      result.set(page.title, categories);
    }
  }

  return result;
}
