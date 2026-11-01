import { createHash } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  fetchRecipes,
  parseRecipeBucket,
  RECIPE_CACHE_TTL_MS,
  RECIPE_BUCKET_URL,
  type RawRecipe,
} from '../src/api/wikiRecipes.js';

const HEADERS = [
  'page_name',
  'page_name_sub',
  'uses_material',
  'uses_tool',
  'uses_facility',
  'is_members_only',
  'is_boostable',
  'uses_skill',
  'source_template',
  'production_json',
];

interface RowOptions {
  page: string;
  production: unknown;
  sourceTemplate?: string;
  members?: string;
  sub?: string;
  facility?: string;
  tool?: string;
  skill?: string;
}

function row(options: RowOptions): string[] {
  return [
    options.page,
    options.sub ?? options.page,
    '',
    options.tool ?? '',
    options.facility ?? '',
    options.members ?? 'false',
    '',
    options.skill ?? '',
    options.sourceTemplate ?? 'recipe',
    typeof options.production === 'string'
      ? options.production
      : JSON.stringify(options.production),
  ];
}

function table(rows: string[][]): string {
  const head = `<tr>${HEADERS.map((header) => `<th>${header}</th>`).join('')}</tr>`;
  const body = rows
    .map(
      (cells) =>
        `<tr>${cells.map((cell) => `<td>${cell}</td>`).join('')}</tr>`,
    )
    .join('');
  return `<table>${head}${body}</table>`;
}

function production(overrides: Record<string, unknown> = {}): unknown {
  return {
    ticks: '1',
    materials: [{ quantity: '1', name: 'Flax' }],
    skills: [{ experience: '15', level: '10', name: 'Crafting', boostable: 'Yes' }],
    members: true,
    output: { quantity: '1', name: 'Bow string' },
    ...overrides,
  };
}

function recipeByName(recipes: RawRecipe[], name: string): RawRecipe {
  const found = recipes.find((recipe) => recipe.output.name === name);
  if (found === undefined) throw new Error(`missing recipe ${name}`);
  return found;
}

/** The URL a stubbed fetch was called with, whatever shape it was passed. */
function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

describe('parseRecipeBucket', () => {
  it('parses recipes and keeps coins as a material', () => {
    const result = parseRecipeBucket(
      table([
        row({
          page: 'Avantoe',
          production: production({
            ticks: '0',
            materials: [{ quantity: '1', name: 'Grimy avantoe' }],
            skills: [
              { experience: '10', level: '48', name: 'Herblore', boostable: 'Yes' },
            ],
            output: { quantity: '1', name: 'Avantoe' },
          }),
          members: 'true',
        }),
        row({
          page: 'Leather',
          production: production({
            ticks: '1',
            materials: [
              { quantity: '1', name: 'Cowhide' },
              { quantity: '1', name: 'Coins' },
            ],
            skills: [],
            facilities: 'Tannery',
            members: false,
            output: { quantity: '1', name: 'Leather', subtxt: 'Normal tanner' },
          }),
          facility: 'Tannery',
        }),
      ]),
    );

    expect(result.rowCount).toBe(2);
    expect(result.skipped).toBe(0);
    expect(result.recipes).toHaveLength(2);

    const avantoe = recipeByName(result.recipes, 'Avantoe');
    expect(avantoe.page).toBe('Avantoe');
    expect(avantoe.ticks).toBe(0);
    expect(avantoe.members).toBe(true);
    expect(avantoe.materials).toEqual([
      { name: 'Grimy avantoe', quantity: 1, note: null },
    ]);
    expect(avantoe.skills).toEqual([{ name: 'Herblore', level: 48 }]);
    expect(avantoe.method).toBeNull();

    const leather = recipeByName(result.recipes, 'Leather');
    expect(leather.method).toBe('Normal tanner');
    expect(leather.facilities).toBe('Tannery');
    expect(leather.members).toBe(false);
    expect(leather.materials).toContainEqual({
      name: 'Coins',
      quantity: 1,
      note: null,
    });
  });

  it('ignores non-recipe rows but counts them for pagination', () => {
    const result = parseRecipeBucket(
      table([
        row({
          page: 'Bridge',
          sourceTemplate: 'skill info',
          production: { name: 'Bridge' },
        }),
        row({ page: 'Bow string', production: production() }),
      ]),
    );

    expect(result.rowCount).toBe(2);
    expect(result.recipes).toHaveLength(1);
    expect(result.recipes[0]?.output.name).toBe('Bow string');
  });

  it('skips malformed production_json rather than aborting the page', () => {
    const result = parseRecipeBucket(
      table([
        row({ page: 'Broken', production: '{"ticks":' }),
        row({ page: 'Bow string', production: production() }),
      ]),
    );

    expect(result.rowCount).toBe(2);
    expect(result.skipped).toBe(1);
    expect(result.recipes).toHaveLength(1);
  });

  it('treats missing, N/A and Varies ticks as unknown, not as five ticks', () => {
    const result = parseRecipeBucket(
      table([
        row({
          page: 'A',
          production: production({ ticks: '', output: { quantity: '1', name: 'A' } }),
        }),
        row({
          page: 'B',
          production: production({ ticks: 'N/A', output: { quantity: '1', name: 'B' } }),
        }),
        row({
          page: 'C',
          production: production({ ticks: 'Varies', output: { quantity: '1', name: 'C' } }),
        }),
        row({
          page: 'D',
          production: production({ ticks: '5', output: { quantity: '1', name: 'D' } }),
        }),
      ]),
    );

    const ticks = result.recipes.map((recipe) => recipe.ticks);
    expect(ticks).toContain(null);
    expect(ticks).toContain(5);
    expect(ticks.filter((value) => value === null)).toHaveLength(3);
  });

  it('cleans wiki markup in methods and quantity notes', () => {
    const result = parseRecipeBucket(
      table([
        row({
          page: 'Iron bar',
          production: production({
            materials: [{ quantity: '1', name: 'Iron ore' }],
            output: {
              quantity: '1',
              name: 'Iron bar',
              subtxt: '[[Blast Furnace]]',
              quantitynote: '50% chance without [[ring of forging]]',
            },
          }),
        }),
      ]),
    );

    const recipe = result.recipes[0];
    expect(recipe?.method).toBe('Blast Furnace');
    expect(recipe?.output.note).toBe('50% chance without ring of forging');
  });

  it('deduplicates the same recipe and prefers the output item page', () => {
    const result = parseRecipeBucket(
      table([
        row({
          page: 'Smithing',
          production: production({
            materials: [{ quantity: '2', name: 'Coal' }],
            output: { quantity: '1', name: 'Steel bar', subtxt: 'Furnace' },
          }),
        }),
        row({
          page: 'Steel bar',
          production: production({
            materials: [{ quantity: '2', name: 'Coal' }],
            output: { quantity: '1', name: 'Steel bar', subtxt: 'Furnace' },
          }),
        }),
      ]),
    );

    expect(result.recipes).toHaveLength(1);
    expect(result.recipes[0]?.page).toBe('Steel bar');
  });

  it('does not merge a chance-note variant with an exact recipe', () => {
    const result = parseRecipeBucket(
      table([
        row({
          page: 'Iron bar',
          production: production({
            materials: [{ quantity: '1', name: 'Iron ore' }],
            output: { quantity: '1', name: 'Iron bar' },
          }),
        }),
        row({
          page: 'Iron bar',
          production: production({
            materials: [{ quantity: '1', name: 'Iron ore' }],
            output: {
              quantity: '1',
              name: 'Iron bar',
              quantitynote: '50% chance without ring of forging',
            },
          }),
        }),
      ]),
    );

    expect(result.recipes).toHaveLength(2);
    expect(result.recipes.map((recipe) => recipe.output.note)).toEqual([
      null,
      '50% chance without ring of forging',
    ]);
  });

  it('fails loudly when a required header column disappears', () => {
    expect(() =>
      parseRecipeBucket(
        '<table><tr><th>page_name</th><th>production_json</th></tr></table>',
      ),
    ).toThrow(/source_template/);
  });
});

describe('fetchRecipes caching', () => {
  const realFetch = globalThis.fetch;

  /**
   * The bucket URL is fixed, so a stubbed page lands in the *real* on-disk cache
   * that `pnpm process` reads: a fake one-recipe bucket could then become the
   * artifact. Remove exactly that entry after each test (the worst case is a
   * re-fetch, which is what the cache is for anyway).
   */
  function cachePathFor(url: string): string {
    return join('.cache', `${createHash('sha1').update(url).digest('hex')}.json`);
  }

  afterEach(async () => {
    globalThis.fetch = realFetch;
    vi.restoreAllMocks();
    for (let offset = 0; offset < 20_000; offset += 500) {
      await rm(cachePathFor(`${RECIPE_BUCKET_URL}&limit=500&offset=${offset}`), {
        force: true,
      });
    }
  });

  /** One short bucket page: under PAGE_SIZE, so pagination stops after it. */
  function stubBucket(): { requests: () => number } {
    let requests = 0;
    globalThis.fetch = vi.fn((input: RequestInfo | URL) => {
      // `http.ts` always passes a string URL; read it as one rather than relying on
      // an object's default stringification.
      const url = typeof input === 'string' ? input : new URL(requestUrl(input)).href;
      expect(url.startsWith(RECIPE_BUCKET_URL)).toBe(true);
      requests += 1;
      return Promise.resolve(
        new Response(
          table([
            row({
              page: 'Bow string',
              production: production(),
              skill: 'Crafting',
            }),
          ]),
          { status: 200, headers: { 'content-type': 'text/html' } },
        ),
      );
    });
    return { requests: () => requests };
  }

  it('keeps the bucket for a week rather than a day', () => {
    // Recipes change when the wiki template does, which is rare: the point of the
    // constant is that a daily refresh must not re-download 16 pages.
    expect(RECIPE_CACHE_TTL_MS).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it('re-reads the wiki when asked for fresh recipes', async () => {
    const stub = stubBucket();
    const result = await fetchRecipes({ maxAgeMs: 0 });

    expect(stub.requests()).toBe(1);
    expect(result.fromCache).toBe(false);
    expect(result.recipes).toHaveLength(1);
  });

  it('serves the second run from the cache without touching the network', async () => {
    const stub = stubBucket();
    // The first call refreshes the cache whatever was there before, so the second
    // call's result does not depend on an earlier test run.
    await fetchRecipes({ maxAgeMs: 0 });
    const requestsAfterFirst = stub.requests();

    const cached = await fetchRecipes();
    expect(stub.requests()).toBe(requestsAfterFirst);
    expect(cached.fromCache).toBe(true);
    // The recipes themselves are unchanged, and still parsed.
    expect(cached.recipes).toHaveLength(1);
    expect(cached.recipes[0]?.output.name).toBe('Bow string');
  });
});
