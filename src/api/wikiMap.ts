/**
 * Shop and bank coordinates, for per-shop bank trip times.
 *
 * A single "bank trip takes N seconds" assumption is wrong: Varrock General
 * Store is a few tiles from Varrock west bank, while Razmire Builders Merchants
 * is a run across Mort'ton. The wiki has the data needed to compute the
 * distance per shop:
 *
 *  1. Shop coordinates: `Special:Bucket?bucket=map` carries every page whose
 *     map template opted in with `bucket=yes`, as a JSON `options` cell with
 *     `{x,y,plane,mapID}`. That is 2,177 rows, so five 500-row requests.
 *     https://oldschool.runescape.wiki/w/Special:Bucket?bucket=map
 *
 *  2. Bank coordinates: `Category:Banks` lists the bank pages (74), but most do
 *     not opt into the bucket. Their infobox still has a `{{Map|...}}` with the
 *     coordinates, so those 74 pages are fetched as wikitext (two requests).
 *     https://oldschool.runescape.wiki/w/Category:Banks
 *
 * `mapID` separates the overworld (0) from underground/instanced maps. Shops and
 * banks are only compared when they share one, so a Dwarven Mine shop is never
 * priced against a bank thousands of tiles away on the surface. When no bank
 * exists on the shop's map, `nearestBankFor` accepts a cross-map bank only if
 * the coordinates are nearly identical (see `bankTrip.ts`).
 */

import { z } from 'zod';
import type { MapPoint } from '../types.js';
import { fetchJson, fetchText } from './http.js';
import { fetchPageWikitext } from './wikiPages.js';
import { cellByHeader, extractRows, headerIndex } from './wikiTable.js';

const WIKI = 'https://oldschool.runescape.wiki';
const TTL_MS = 24 * 60 * 60 * 1000;
/** The Bucket UI offers 50/100/250/500 and defaults to 20. */
const PAGE_SIZE = 500;
/** Hard stop so a pagination bug can never loop forever. */
const MAX_ROWS = 10_000;

const MapOptionsSchema = z.object({
  x: z.number(),
  y: z.number(),
  mapID: z.number().optional(),
});

export interface MapBucketRow {
  pageName: string;
  point: MapPoint;
}

/**
 * Parse one page of `bucket=map`.
 *
 * Columns are addressed by header name: `page_name` and `options`. Rows whose
 * `options` cell is empty or not the expected JSON are skipped rather than
 * guessed — a page without a map centre simply has no distance.
 */
export interface MapBucketPage {
  /** Data rows that yielded a usable map point. */
  rows: MapBucketRow[];
  /**
   * Data rows before filtering. Pagination ends on a short page, and a full page
   * can legitimately contain rows with no map centre, so the raw count is what
   * decides "last page" — not the parsed count.
   */
  rowCount: number;
}

export function parseMapBucket(html: string): MapBucketPage {
  const rows = extractRows(html);
  const header = rows.find((row) => row.header);
  if (header === undefined) throw new Error('map bucket: no header row found');

  const index = headerIndex(header);
  const required = ['page_name', 'options'];
  const missing = required.filter((name) => !index.has(name));
  if (missing.length > 0) {
    throw new Error(
      `map bucket: missing expected columns [${missing.join(', ')}]. ` +
        `Found [${header.cells.join(', ')}]. The wiki changed its schema.`,
    );
  }

  const out: MapBucketRow[] = [];
  let rowCount = 0;
  for (const row of rows) {
    if (row.header) continue;
    rowCount += 1;

    const pageName = cellByHeader(row.cells, index, 'page_name');
    const rawOptions = cellByHeader(row.cells, index, 'options');
    if (pageName === '' || rawOptions === '') continue;

    let json: unknown;
    try {
      json = JSON.parse(rawOptions);
    } catch {
      continue;
    }

    const parsed = MapOptionsSchema.safeParse(json);
    if (!parsed.success) continue;

    out.push({
      pageName,
      point: {
        x: parsed.data.x,
        y: parsed.data.y,
        mapID: parsed.data.mapID ?? 0,
      },
    });
  }

  return { rows: out, rowCount };
}

export interface MapBucketResult {
  points: Map<string, MapPoint>;
  fetchedAt: number;
  pages: number;
  rows: number;
}

/** Fetch every page centre from the wiki's map bucket. */
export async function fetchMapPoints(): Promise<MapBucketResult> {
  const points = new Map<string, MapPoint>();
  let offset = 0;
  let pages = 0;
  let rows = 0;
  let fetchedAt = Date.now();

  for (;;) {
    const url =
      `${WIKI}/w/Special:Bucket?bucket=map` +
      `&limit=${PAGE_SIZE}&offset=${offset}`;
    const { body, fetchedAt: at } = await fetchText(url, {
      ttlMs: TTL_MS,
      headers: { Accept: 'text/html' },
    });

    const page = parseMapBucket(body);
    pages += 1;
    rows += page.rowCount;
    fetchedAt = at;

    for (const row of page.rows) points.set(row.pageName, row.point);

    // A short page means we've reached the end.
    if (page.rowCount < PAGE_SIZE) break;
    offset += PAGE_SIZE;
    if (rows >= MAX_ROWS) break;
  }

  return { points, fetchedAt, pages, rows };
}

// ---------------------------------------------------------------------------
// Bank pages
// ---------------------------------------------------------------------------

const BankMembersSchema = z.object({
  continue: z.object({ cmcontinue: z.string() }).optional(),
  query: z
    .object({
      categorymembers: z.array(z.object({ title: z.string() })).optional(),
    })
    .optional(),
});

/**
 * Pages in `Category:Banks` that are not a physical bank location.
 * Everything else (including banker NPC pages such as Odovacar, whose
 * coordinates are the counter you actually use) is kept.
 */
const NON_LOCATION_BANK_PAGES = new Set([
  'bank',
  'bank deposit box',
  'buildable bank chests',
  'list of banks',
]);

/** Fetch the titles in `Category:Banks`, following continuation. */
export async function fetchBankTitles(): Promise<string[]> {
  const titles: string[] = [];
  let continueFrom: string | undefined;

  for (;;) {
    const url =
      `${WIKI}/api.php?action=query&format=json&formatversion=2` +
      `&list=categorymembers&cmtitle=Category:Banks&cmlimit=500` +
      (continueFrom === undefined
        ? ''
        : `&cmcontinue=${encodeURIComponent(continueFrom)}`);

    const { body } = await fetchJson(url, { ttlMs: TTL_MS });
    const parsed = BankMembersSchema.parse(body);

    for (const member of parsed.query?.categorymembers ?? []) {
      if (!NON_LOCATION_BANK_PAGES.has(member.title.toLowerCase())) {
        titles.push(member.title);
      }
    }

    continueFrom = parsed.continue?.cmcontinue;
    if (continueFrom === undefined) break;
  }

  return [...new Set(titles)];
}

/** Read one integer named parameter out of a `{{Map|...}}` body. */
function readInt(body: string, key: string): number | null {
  const match = body.match(new RegExp(`\\|\\s*${key}\\s*=\\s*(-?\\d+)`, 'i'));
  return match === null ? null : Number(match[1]);
}

/**
 * Extract the map centre from an infobox `|map = {{Map|...}}` parameter.
 *
 * Shapes the wiki uses:
 *   {{Map|x=3165|y=3490|...}}                    point
 *   {{Map|3091,3500|mtype=polygon|...}}          polygon; average the vertices
 *   {{Map|3185,3440|rectX=11|rectY=15}}          rectangle; the point is the
 *                                                north-west corner, so add
 *                                                half the width and subtract
 *                                                half the height
 *
 * Returns null when the page has no map template. `mapID` defaults to 0 (the
 * overworld), matching the bucket's convention.
 */
export function extractMapTemplatePoint(wikitext: string): MapPoint | null {
  const parameter = wikitext.match(/\|\s*map\s*=\s*(\{\{Map\b[^{}]*\}\})/i);
  if (parameter === null) return null;

  const body = parameter[1] ?? '';
  const mapID = readInt(body, 'mapID') ?? 0;

  const namedX = readInt(body, 'x');
  const namedY = readInt(body, 'y');
  if (namedX !== null && namedY !== null) {
    return { x: namedX, y: namedY, mapID };
  }

  const pairs = [...body.matchAll(/(\d{3,5}),(\d{3,5})/g)].map((match) => ({
    x: Number(match[1]),
    y: Number(match[2]),
  }));
  if (pairs.length === 0) return null;

  const rectX = readInt(body, 'rectX');
  const rectY = readInt(body, 'rectY');
  if (pairs.length === 1 && rectX !== null && rectY !== null) {
    const corner = pairs[0] ?? { x: 0, y: 0 };
    return { x: corner.x + rectX / 2, y: corner.y - rectY / 2, mapID };
  }

  const centre = pairs.reduce(
    (sum, point) => ({ x: sum.x + point.x, y: sum.y + point.y }),
    { x: 0, y: 0 },
  );
  return {
    x: centre.x / pairs.length,
    y: centre.y / pairs.length,
    mapID,
  };
}

/**
 * Every pinned location on a page, from `{{ObjectLocLine}}` blocks.
 *
 * Scenery and resource pages publish their positions with
 *
 *   {{ObjectLocLine|name = Tea stall|location = [[Varrock]]|members = Yes
 *    |mapID = 0|plane = 0|x:3269,y:3410|mtype = pin}}
 *
 * which is *not* the `|map = No` infobox field and *not* `{{Map}}`: the Tea stall
 * carries two of these blocks (Varrock and the Kourend Castle courtyard) while its
 * infobox says `|map = No`. One line may also hold several pins
 * (`|x:2635,y:8853|x:2638,y:8844`), and `mapID = -1` marks a custom map.
 *
 * This is what makes a per-location bank distance possible for a stall, a rock or
 * a furnace: the same join the shop catalogue uses.
 */
export interface PageLocation {
  x: number;
  y: number;
  /** `0` is the overworld; `-1` is a custom map and never matched across. */
  mapID: number;
  plane: number;
  /** The block's `|location =` label, for telling the pins apart. */
  label: string | null;
}

export function parseObjectLocLines(wikitext: string): PageLocation[] {
  const locations: PageLocation[] = [];

  // The three parameters read from each block, as literals.
  const LOC_PARAM = {
    mapID: /\|\s*mapID\s*=\s*([^|\n}]*)/i,
    plane: /\|\s*plane\s*=\s*([^|\n}]*)/i,
    location: /\|\s*location\s*=\s*([^|\n}]*)/i,
  } as const;

  const BLOCK = /\{\{\s*ObjectLocLine([\s\S]*?)\n\}\}/gi;
  for (const block of wikitext.matchAll(BLOCK)) {
    const body = block[1] ?? '';
    // Literal patterns, one per parameter read. A pattern built from a key is the
    // one construct here that could be talked into matching something else.
    const param = (key: keyof typeof LOC_PARAM): string | null => {
      const found = LOC_PARAM[key].exec(body);
      return found === null ? null : (found[1] ?? '').trim();
    };

    const mapID = Number.parseInt(param('mapID') ?? '0', 10);
    const plane = Number.parseInt(param('plane') ?? '0', 10);
    const label = param('location');

    // `|x:3269,y:3410` and `|x:2635,y:8853|x:2638,y:8844` both appear.
    for (const pin of body.matchAll(/x\s*:\s*(-?\d+(?:\.\d+)?)\s*,\s*y\s*:\s*(-?\d+(?:\.\d+)?)/gi)) {
      const x = Number.parseFloat(pin[1] ?? '');
      const y = Number.parseFloat(pin[2] ?? '');
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      locations.push({
        x,
        y,
        mapID: Number.isFinite(mapID) ? mapID : 0,
        plane: Number.isFinite(plane) ? plane : 0,
        label,
      });
    }
  }

  return locations;
}

/**
 * Fetch map points for a set of page titles (used for bank pages).
 * Pages without a `{{Map}}` template are simply absent from the result.
 */
export async function fetchPageMapPoints(
  titles: string[],
): Promise<{ points: Map<string, MapPoint>; missing: number; requests: number }> {
  const { pages, requests, missing } = await fetchPageWikitext(titles);
  const points = new Map<string, MapPoint>();

  for (const [title, content] of pages) {
    if (content === null) continue;
    const point = extractMapTemplatePoint(content);
    if (point !== null) points.set(title, point);
  }

  return { points, missing, requests };
}
