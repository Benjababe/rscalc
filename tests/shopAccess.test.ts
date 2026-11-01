import { readFile } from 'fs/promises';
import { describe, expect, it } from 'vitest';
import {
  buildAccessEntries,
  isKnownLocked,
  toAccessMap,
  type AccessRule,
  type ShopAccessOverride,
} from '../src/domain/shopAccess.js';
import {
  ShopAccessCatalogSchema,
  ShopAccessEntrySchema,
  ShopCatalogSchema,
} from '../src/types.js';
import {
  ACCESS_RULES,
  SHOP_ACCESS_OVERRIDES,
} from '../scripts/shopAccessRules.js';

const RULES: AccessRule[] = [
  {
    match: ['Test Guild'],
    requirement: '10 Test',
    kind: 'skill',
    source: 'https://oldschool.runescape.wiki/w/Test_Guild',
    excludeShops: ['Excluded Shop'],
  },
  {
    match: ['Elsewhere'],
    requirement: 'Test Quest',
    kind: 'quest',
    source: 'https://oldschool.runescape.wiki/w/Test_Quest',
  },
];

const OVERRIDES: Record<string, ShopAccessOverride> = {
  'Override Shop': {
    requirement: 'Special Requirement',
    kind: 'other',
    source: 'https://oldschool.runescape.wiki/w/Override',
  },
};

describe('buildAccessEntries', () => {
  it('matches locations case-insensitively and skips exclusions', () => {
    const entries = buildAccessEntries(
      [
        { shopPage: 'A', location: 'Inside Test Guild' },
        { shopPage: 'Excluded Shop', location: 'Test Guild' },
        { shopPage: 'B', location: 'Elsewhere' },
      ],
      RULES,
      {},
    );

    expect(entries.map((entry) => entry.shopPage)).toEqual(['A', 'B']);
    expect(entries[0]?.requirement).toBe('10 Test');
    expect(entries[1]?.requirement).toBe('Test Quest');
  });

  it('lets an override win over a matching rule', () => {
    const entries = buildAccessEntries(
      [{ shopPage: 'Override Shop', location: 'Test Guild' }],
      RULES,
      OVERRIDES,
    );

    expect(entries).toEqual([
      {
        shopPage: 'Override Shop',
        requirement: 'Special Requirement',
        kind: 'other',
        source: 'https://oldschool.runescape.wiki/w/Override',
      },
    ]);
  });

  it('leaves a shop with no location and no override unknown', () => {
    expect(
      buildAccessEntries([{ shopPage: 'A', location: null }], RULES, {}),
    ).toEqual([]);
  });

  it('applies an override even when the location is unknown', () => {
    expect(
      buildAccessEntries([{ shopPage: 'Override Shop', location: null }], RULES, OVERRIDES),
    ).toHaveLength(1);
  });

  it('deduplicates shop pages and keeps a known location', () => {
    const entries = buildAccessEntries(
      [
        { shopPage: 'A', location: null },
        { shopPage: 'A', location: 'Elsewhere' },
        { shopPage: 'A', location: 'Test Guild' },
      ],
      RULES,
      {},
    );

    expect(entries).toEqual([
      {
        shopPage: 'A',
        requirement: 'Test Quest', // the non-null location was kept
        kind: 'quest',
        source: 'https://oldschool.runescape.wiki/w/Test_Quest',
      },
    ]);
  });

  it('sorts by shop page', () => {
    const entries = buildAccessEntries(
      [
        { shopPage: 'Z', location: 'Elsewhere' },
        { shopPage: 'A', location: 'Elsewhere' },
      ],
      RULES,
      {},
    );
    expect(entries.map((entry) => entry.shopPage)).toEqual(['A', 'Z']);
  });
});

describe('access lookup', () => {
  it('maps and tests known entries', () => {
    const map = toAccessMap([
      {
        shopPage: 'A',
        requirement: '10 Test',
        kind: 'skill',
        source: 'https://oldschool.runescape.wiki/w/Test_Guild',
      },
    ]);

    expect(map.get('A')?.requirement).toBe('10 Test');
    expect(isKnownLocked(map, 'A')).toBe(true);
    expect(isKnownLocked(map, 'B')).toBe(false);
  });
});

describe('curated access data', () => {
  it('cites a wiki page and a requirement for every rule and override', () => {
    for (const rule of ACCESS_RULES) {
      expect(rule.requirement.trim().length).toBeGreaterThan(0);
      expect(rule.source).toMatch(
        /^https:\/\/oldschool\.runescape\.wiki\/w\//,
      );
      expect(rule.match.length).toBeGreaterThan(0);
    }
    for (const override of Object.values(SHOP_ACCESS_OVERRIDES)) {
      expect(override.requirement.trim().length).toBeGreaterThan(0);
      expect(override.source).toMatch(
        /^https:\/\/oldschool\.runescape\.wiki\/w\//,
      );
    }
  });

  it('covers the known high-confidence examples and respects exclusions', async () => {
    const catalog = ShopCatalogSchema.parse(
      JSON.parse(await readFile('data/shops.json', 'utf8')),
    );
    const entries = buildAccessEntries(
      catalog.entries,
      ACCESS_RULES,
      SHOP_ACCESS_OVERRIDES,
    );
    const byPage = toAccessMap(entries);

    expect(byPage.get('Fishing Guild Shop.')?.requirement).toContain('68 Fishing');
    expect(byPage.get("Legends Guild General Store.")?.requirement).toContain(
      "Legends' Quest",
    );
    expect(byPage.get('Oobapohk\'s Javelin Store')?.requirement).toContain(
      'Monkey Madness II',
    );
    expect(byPage.get('Culinaromancer\'s Chest')?.requirement).toContain(
      'Recipe for Disaster',
    );
    expect(byPage.get('Eblis')?.requirement).toContain('Desert Treasure I');

    // Varlamore is one continent-wide gate, and Cam Torum sits behind a second.
    expect(byPage.get('Fortis General Store')?.requirement).toContain(
      'Children of the Sun',
    );
    expect(byPage.get('The Lost Pickaxe')?.requirement).toContain(
      'Perilous Moons',
    );

    // Sailing destinations publish their docking level on the location page.
    expect(byPage.get('Port Roberts Fur Stall')?.requirement).toBe(
      '50 Sailing',
    );
    expect(byPage.get('Elder Reggle\'s Farming Shop')?.requirement).toContain(
      '45 Sailing',
    );

    // The Varlamore rule must not leak into Great Kourend, which is next door
    // on the map but has no continent-wide requirement.
    expect(byPage.get("Leenz's General Supplies")).toBeUndefined();
    expect(byPage.get('The Golden Field')).toBeUndefined();

    expect(byPage.get('Master fisher')).toBeUndefined();
    expect(byPage.get('Shield master')).toBeUndefined();
    expect(byPage.get('Armour store.')).toBeUndefined();
    expect(byPage.get('Ore seller.')).toBeUndefined();
  });

  it('validates the committed artifact against the catalogue', async () => {
    const catalog = ShopCatalogSchema.parse(
      JSON.parse(await readFile('data/shops.json', 'utf8')),
    );
    const access = ShopAccessCatalogSchema.parse(
      JSON.parse(await readFile('data/shop-access.json', 'utf8')),
    );
    const shopPages = new Set(catalog.entries.map((entry) => entry.shopPage));

    expect(access.entries.length).toBeGreaterThan(0);
    for (const entry of access.entries) {
      expect(shopPages.has(entry.shopPage)).toBe(true);
      expect(entry.source).toMatch(
        /^https:\/\/oldschool\.runescape\.wiki\/w\//,
      );
    }

    const pages = access.entries.map((entry) => entry.shopPage);
    expect(new Set(pages).size).toBe(pages.length);
    expect(pages).toEqual([...pages].sort((a, b) => a.localeCompare(b)));
  });

  it('rejects malformed entries', () => {
    expect(
      ShopAccessEntrySchema.safeParse({
        shopPage: 'A',
        requirement: '',
        kind: 'quest',
        source: 'https://oldschool.runescape.wiki/w/A',
      }).success,
    ).toBe(false);
    expect(
      ShopAccessEntrySchema.safeParse({
        shopPage: 'A',
        requirement: 'Requirement',
        kind: 'quest',
        source: 'not-a-url',
      }).success,
    ).toBe(false);
    expect(
      ShopAccessEntrySchema.safeParse({
        shopPage: 'A',
        requirement: 'Requirement',
        kind: 'unknown',
        source: 'https://oldschool.runescape.wiki/w/A',
      }).success,
    ).toBe(false);
  });
});
