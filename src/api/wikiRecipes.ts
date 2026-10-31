/**
 * Structured recipe data from the OSRS Wiki.
 *
 * Source: <https://oldschool.runescape.wiki/w/Special:Bucket?bucket=recipe>
 *
 * The bucket is written by `{{Recipe}}` (Template:Recipe -> Module:Recipe), which
 * stores one `production_json` object per recipe. That is the same structured
 * data the wiki renders in its own recipe tables, so we do not have to scrape
 * hundreds of article pages or hand-maintain a recipe list.
 *
 * The table is addressed by header name, never by column index, for the same
 * reason as `storeBucket.ts`: a column reorder must fail loudly instead of
 * silently shifting every field by one.
 *
 * Verified live: 10 columns —
 *   page_name, page_name_sub, uses_material, uses_tool, uses_facility,
 *   is_members_only, is_boostable, uses_skill, source_template, production_json
 *
 * `production_json` shape (examples from Bronze bar and Avantoe):
 *   {"ticks":"5","materials":[{"quantity":"1","name":"Copper ore"}, ...],
 *    "facilities":"Furnace","skills":[{"experience":"6.2","level":"1",
 *    "name":"Smithing","boostable":""}],"members":false,
 *    "output":{"cost":57,"quantity":"1","name":"Bronze bar", ...}}
 *
 * Only the primary output is stored in the bucket (`output[1]` in
 * Module:Recipe). Recipes with secondary outputs therefore expose only their
 * main product; that is a known source limitation, documented in
 * `docs/processing.md`.
 */

import { z } from 'zod';
import { fetchText } from './http.js';
import { cleanHtmlText } from './storeBucket.js';
import {
  cellByHeader,
  extractRows,
  headerIndex,
} from './wikiTable.js';

const WIKI = 'https://oldschool.runescape.wiki';
export const RECIPE_BUCKET_URL = `${WIKI}/w/Special:Bucket?bucket=recipe`;

/** Bucket pages serve at most 500 rows each. */
const PAGE_SIZE = 500;
/** Hard stop so a pagination bug can never loop forever. */
const MAX_ROWS = 20_000;
const TTL_MS = 24 * 60 * 60 * 1000;

/** One item in a recipe: an input material or the output. */
export interface RawRecipeItem {
  /** Canonical item page name, e.g. `Grimy avantoe`. */
  name: string;
  /** Units consumed or produced per action. */
  quantity: number;
  /**
   * The wiki's `quantitynote`, cleaned to plain text. Examples:
   * `50% chance without ring of forging`, `On average`, or
   * `Extra runes from Raiments of the Eye are not affected`.
   */
  note: string | null;
}

export interface RawRecipeSkill {
  name: string;
  /** The published level, or null when the page says `?`. */
  level: number | null;
}

/**
 * One deterministic-looking recipe from the bucket.
 *
 * `ticks` is the raw number of game ticks per action. `0` is meaningful (the
 * wiki treats a zero-tick action as 8 actions per tick); `null` means the page
 * did not publish a tick count and the caller must not invent one.
 */
export interface RawRecipe {
  /** Stable content key, used for deduplication and React keys. */
  id: string;
  /** Page the recipe was transcluded on; the source link in the UI. */
  page: string;
  /** Wiki subtxt, e.g. `Blast Furnace`, `Superheat`, `Degrime`. */
  method: string | null;
  /** Ticks per action, or null when unpublished. */
  ticks: number | null;
  /** Every input, including `Coins` (a fee, not a GE item). */
  materials: RawRecipeItem[];
  /** The primary output. The bucket does not carry secondary outputs. */
  output: RawRecipeItem;
  /** Facility the recipe needs, e.g. `Furnace` or `Tannery`. */
  facilities: string | null;
  /** Tools the recipe needs, e.g. `Knife` or `Chisel`. */
  tools: string | null;
  /** Members-only recipe, as published by the recipe template. */
  members: boolean;
  /** Every skill requirement, including secondary skills. */
  skills: RawRecipeSkill[];
}

// ---------------------------------------------------------------------------
// production_json schema
// ---------------------------------------------------------------------------

/**
 * Quantities are strings in the wiki JSON (`"1"`, `"15"`, `"28.8"`). Parse them
 * to numbers at the boundary, keep the original value on failure so zod can
 * reject it, and default a missing quantity to 1 (the template's own default).
 */
const QuantitySchema = z.preprocess(
  (value) => {
    if (typeof value === 'number') return value;
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed === '') return undefined;
      const parsed = Number(trimmed.replace(/,/g, ''));
      return Number.isFinite(parsed) ? parsed : value;
    }
    return value;
  },
  z.number().finite().positive().default(1),
);

/**
 * Ticks: a number, a numeric string, `''`, `N/A` or `Varies`.
 *
 * An absent or non-numeric value is `null`; we deliberately do not copy
 * Module:Recipe's "assume 5" fallback for missing ticks, because that would
 * manufacture a processing rate the wiki does not publish.
 */
const TicksSchema = z
  .union([z.string(), z.number(), z.null()])
  .optional()
  .transform((value) => {
    if (value === null || value === undefined) return null;
    const text = String(value).trim().toLowerCase();
    if (text === '' || text === 'na' || text === 'n/a' || text === 'varies') {
      return null;
    }
    const parsed = Number(text);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
  });

/** The bucket mixes booleans and strings across rows; accept both. */
const BooleanishSchema = z
  .union([z.boolean(), z.string(), z.number(), z.null()])
  .optional()
  .transform((value) => {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value !== 0;
    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase();
      return normalized === 'yes' || normalized === 'true' || normalized === '1';
    }
    return false;
  });

/** Skill levels are strings in the JSON; `?` is null, never guessed. */
const LevelSchema = z
  .union([z.string(), z.number(), z.null()])
  .optional()
  .transform((value) => {
    if (value === null || value === undefined) return null;
    const text = String(value).trim();
    if (text === '' || text === '?') return null;
    const parsed = Number(text);
    return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
  });

/** Clean a wiki note to plain text, collapsing "no note" to null. */
const NoteSchema = z
  .string()
  .nullable()
  .optional()
  .transform((value) => cleanOptional(value));

const NameSchema = z
  .string()
  .min(1)
  .transform((value) => cleanHtmlText(value))
  .refine((value) => value !== '', { message: 'empty item name' });

const MaterialSchema = z.object({
  name: NameSchema,
  quantity: QuantitySchema,
  quantitynote: NoteSchema,
});

const OutputSchema = z.object({
  name: NameSchema,
  quantity: QuantitySchema,
  quantitynote: NoteSchema,
  subtxt: z.string().nullable().optional(),
});

const SkillSchema = z.object({
  name: NameSchema,
  level: LevelSchema,
});

const ProductionJsonSchema = z.object({
  ticks: TicksSchema,
  materials: z.array(MaterialSchema).default([]),
  skills: z.array(SkillSchema).default([]),
  members: BooleanishSchema,
  output: OutputSchema.nullable().optional(),
  facilities: z.string().nullable().optional(),
  tools: z.string().nullable().optional(),
});

function cleanOptional(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const cleaned = cleanHtmlText(value);
  return cleaned === '' ? null : cleaned;
}

// ---------------------------------------------------------------------------
// Bucket parsing
// ---------------------------------------------------------------------------

export interface RecipeParseResult {
  recipes: RawRecipe[];
  /** Data rows that looked like recipes but could not be parsed. */
  skipped: number;
  /** Every non-header row on the page, including `skill info` rows. */
  rowCount: number;
}

/** Require a header column; a missing one is schema drift, not a soft miss. */
function requireColumn(index: Map<string, number>, name: string): void {
  if (!index.has(name)) {
    throw new Error(
      `Recipe bucket is missing the "${name}" column. The wiki table schema changed.`,
    );
  }
}

/**
 * Parse one page of `Special:Bucket?bucket=recipe`.
 *
 * Rows whose `source_template` is not `recipe` (for example `skill info`) are
 * counted but ignored. A malformed `production_json` row is skipped rather than
 * aborting the whole catalogue; the caller logs the skipped count.
 */
export function parseRecipeBucket(html: string): RecipeParseResult {
  const rows = extractRows(html);
  const header = rows.find((row) => row.header);
  if (header === undefined) {
    throw new Error('Recipe bucket has no header row. The wiki table schema changed.');
  }

  const index = headerIndex(header);
  requireColumn(index, 'page_name');
  requireColumn(index, 'source_template');
  requireColumn(index, 'production_json');

  const recipes: RawRecipe[] = [];
  let skipped = 0;
  let rowCount = 0;

  for (const row of rows) {
    if (row.header) continue;
    rowCount += 1;

    if (cellByHeader(row.cells, index, 'source_template') !== 'recipe') continue;

    const raw = cellByHeader(row.cells, index, 'production_json');
    if (raw === '') {
      skipped += 1;
      continue;
    }

    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      skipped += 1;
      continue;
    }

    const parsed = ProductionJsonSchema.safeParse(json);
    if (!parsed.success) {
      skipped += 1;
      continue;
    }

    const output = parsed.data.output;
    const page = cellByHeader(row.cells, index, 'page_name').trim();
    if (output === null || output === undefined || page === '') {
      skipped += 1;
      continue;
    }

    const rowMembers = cellByHeader(row.cells, index, 'is_members_only')
      .trim()
      .toLowerCase();
    const members =
      parsed.data.members || rowMembers === 'true' || rowMembers === 'yes';

    const recipe: RawRecipe = {
      id: '',
      page,
      method: cleanOptional(output.subtxt),
      ticks: parsed.data.ticks,
      materials: parsed.data.materials.map((material) => ({
        name: material.name,
        quantity: material.quantity,
        note: material.quantitynote,
      })),
      output: {
        name: output.name,
        quantity: output.quantity,
        note: output.quantitynote,
      },
      facilities: cleanOptional(parsed.data.facilities),
      tools: cleanOptional(parsed.data.tools),
      members,
      skills: parsed.data.skills,
    };

    recipe.id = recipeKey(recipe);
    recipes.push(recipe);
  }

  return { recipes: dedupe(recipes), skipped, rowCount };
}

/**
 * Content key: everything that makes two recipes behaviourally different.
 *
 * Page titles are deliberately excluded, because the same recipe can be
 * transcluded on several pages (the output page and a method page). Two rows
 * with the same materials, output, method, ticks, facility, tools and skills
 * are one recipe.
 */
function recipeKey(recipe: RawRecipe): string {
  const materials = recipe.materials
    .map(
      (material) =>
        `${material.name.toLowerCase()}x${material.quantity}:${material.note ?? ''}`,
    )
    .sort((a, b) => a.localeCompare(b))
    .join(',');
  const skills = recipe.skills
    .map((skill) => `${skill.name.toLowerCase()}:${skill.level ?? '?'}`)
    .sort((a, b) => a.localeCompare(b))
    .join(',');
  return [
    recipe.output.name.toLowerCase(),
    recipe.output.quantity,
    recipe.output.note ?? '',
    recipe.method ?? '',
    recipe.ticks ?? '?',
    recipe.facilities ?? '',
    recipe.tools ?? '',
    recipe.members ? 'members' : 'f2p',
    skills,
    materials,
  ].join('|');
}

/**
 * Collapse duplicate recipes, preferring the page named after the output item
 * (the canonical item page) and then the lexicographically first page, so the
 * result does not depend on bucket pagination order.
 */
function dedupe(recipes: RawRecipe[]): RawRecipe[] {
  const best = new Map<string, RawRecipe>();
  for (const recipe of recipes) {
    const existing = best.get(recipe.id);
    if (existing === undefined || prefer(recipe, existing)) {
      best.set(recipe.id, recipe);
    }
  }
  return [...best.values()].sort((a, b) => a.id.localeCompare(b.id));
}

function prefer(candidate: RawRecipe, current: RawRecipe): boolean {
  const candidateCanonical = candidate.page === candidate.output.name;
  const currentCanonical = current.page === current.output.name;
  if (candidateCanonical !== currentCanonical) return candidateCanonical;
  return candidate.page.localeCompare(current.page) < 0;
}

// ---------------------------------------------------------------------------
// Fetching every page
// ---------------------------------------------------------------------------

export interface RecipeFetchResult {
  recipes: RawRecipe[];
  fetchedAt: number;
  pages: number;
  /** Rows that looked like recipes but failed validation. */
  skipped: number;
}

/**
 * Fetch and parse the whole recipe bucket, following pagination.
 *
 * TTL 24h. The bucket is large (about 7,900 rows / 16 pages at the last check),
 * so the caller should run it from a refresh script rather than the UI. All
 * requests go through `http.ts` and therefore the global 1 req/s limiter.
 */
export async function fetchRecipes(): Promise<RecipeFetchResult> {
  const all: RawRecipe[] = [];
  let skipped = 0;
  let pages = 0;
  let fetchedAt = Date.now();

  for (let offset = 0; offset < MAX_ROWS; offset += PAGE_SIZE) {
    const url = `${RECIPE_BUCKET_URL}&limit=${PAGE_SIZE}&offset=${offset}`;
    const { body, fetchedAt: at } = await fetchText(url, {
      ttlMs: TTL_MS,
      headers: { Accept: 'text/html' },
    });
    fetchedAt = at;
    pages += 1;

    const parsed = parseRecipeBucket(body);
    all.push(...parsed.recipes);
    skipped += parsed.skipped;

    // The bucket page is full when it has PAGE_SIZE data rows. A short page is
    // the last one. Counting all rows matters: only part of each page is a
    // recipe, so `parsed.recipes.length < PAGE_SIZE` would stop too early.
    if (parsed.rowCount < PAGE_SIZE) break;
  }

  return {
    recipes: dedupe(all),
    fetchedAt,
    pages,
    skipped,
  };
}
