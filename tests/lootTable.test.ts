/**
 * Minigame loot tables: `{{DropsLine}}` / `{{DropsLineReward}}` to priced rolls.
 *
 * The shape that matters is the wiki's own: a page splits its payout across several
 * tables, and only some groupings are a roll. Zalcano's runes and materials add up to
 * one; the Hallowed sack repeats four tables three times, once per tier; Wintertodt's
 * crate adds up to nothing because its contents scale with points. The tests pin all
 * three readings, plus the rule that a range becomes a marked midpoint.
 */

import { describe, expect, it } from 'vitest';

import {
  groupRolls,
  parseLootTables,
} from '../src/api/wikiLootTable.js';
import { LOOT_REFUSALS, LOOT_ROWS, lootEvSources } from '../scripts/lootTableSources.js';
import type { LootPageResult } from '../src/api/wikiLootTable.js';

const ZALCANO = `==Drops==
===100%===
{{DropsTableHead}}
{{DropsLine|name=Crystal shard|quantity=1-3|rarity=Always}}
{{DropsLine|name=Infernal ashes|quantity=1|rarity=Always}}
{{DropsTableBottom}}
===Runes===
{{DropsTableHead}}
{{DropsLine|name=Blood rune|quantity=64-480|rarity=1/36}}
{{DropsLine|name=Cosmic rune|quantity=295-926|rarity=1/36}}
{{DropsLine|name=Death rune|quantity=201-1046|rarity=1/36}}
{{DropsLine|name=Law rune|quantity=166-790|rarity=1/36}}
{{DropsLine|name=Soul rune|quantity=47-392|rarity=1/36}}
{{DropsLine|name=Nature rune|quantity=1-937|rarity=1/36}}
{{DropsTableBottom}}
===Materials===
{{DropsTableHead}}
{{DropsLine|name=Silver ore|quantity=86-800 (noted)|rarity=6/36}}
{{DropsLine|name=Coal|quantity=169-1052 (noted)|rarity=6/36}}
{{DropsLine|name=Mithril ore|quantity=56-469 (noted)|rarity=6/36}}
{{DropsLine|name=Adamantite ore|quantity=51-343 (noted)|rarity=6/36}}
{{DropsLine|name=Runite ore|quantity=3-31 (noted)|rarity=6/36}}
{{DropsTableBottom}}
===Tertiary===
{{DropsLine|name=Zalcano's emblem|quantity=1|rarity=1/500}}`;

const SACK_TIER = `===Weapons and armour===
{{DropsLine|name=Monk's robe top|quantity=1|rarity=1/10}}
{{DropsLine|name=Adamant 2h sword|quantity=1|rarity=1/10}}
===Runes and ammunition===
{{DropsLine|name=Air rune|quantity=500-750|rarity=1/10}}
{{DropsLine|name=Fire rune|quantity=500-750|rarity=1/10}}
{{DropsLine|name=Chaos rune|quantity=25-50|rarity=1/10}}
{{DropsLine|name=Mithril bolts|quantity=50-150|rarity=1/10}}
===Resources===
{{DropsLine|name=Prayer potion(2)|quantity=1|rarity=1/10}}
{{DropsLine|name=White lily|quantity=1|rarity=1/10}}
===Other===
{{DropsLine|name=Coins|quantity=1500-3000|rarity=1/10}}
{{DropsLine|name=Bones|quantity=1|rarity=1/10}}`;

const SACK = `==Low-tier loot table==
${SACK_TIER}
==Mid-tier loot table==
${SACK_TIER}
==High-tier loot table==
${SACK_TIER}`;

describe('parseLootTables', () => {
  it('keeps each table with its heading path and chance sum', () => {
    const tables = parseLootTables(ZALCANO);
    const names = tables.map((table) => table.path.join(' › '));
    expect(names).toEqual([
      'Drops › 100%',
      'Drops › Runes',
      'Drops › Materials',
      'Drops › Tertiary',
    ]);

    const runes = tables.find((table) => table.path.at(-1) === 'Runes');
    expect(runes?.drops).toHaveLength(6);
    expect(runes?.chanceSum).toBeCloseTo(6 / 36, 6);

    // A range becomes the midpoint and says so.
    const blood = runes?.drops.find((drop) => drop.item === 'Blood rune');
    expect(blood).toMatchObject({
      quantity: 272,
      assumedQuantity: true,
      quantityRange: { min: 64, max: 480 },
    });
  });

  it('reads a nested tier path, not just the innermost heading', () => {
    const tables = parseLootTables(SACK);
    expect(tables[0]?.path).toEqual(['Low-tier loot table', 'Weapons and armour']);
    expect(tables).toHaveLength(12);
  });

  it('counts a line it cannot read instead of pricing it', () => {
    const tables = parseLootTables(
      '==Other==\n{{DropsLine|name=Coins|quantity=Varies|rarity=1/2}}\n{{DropsLine|name=Bones|quantity=1|rarity=1/2}}',
    );
    expect(tables[0]?.skipped).toBe(1);
    expect(tables[0]?.drops).toHaveLength(1);
  });
});

describe('groupRolls', () => {
  it('groups tables until they add up to one roll', () => {
    const rolls = groupRolls(parseLootTables(ZALCANO));
    // Runes (0.167) + Materials (0.833) = 1, with the two `Always` lines attached.
    expect(rolls[0]?.chanceSum).toBeCloseTo(1, 6);
    expect(rolls[0]?.guaranteedChance).toBe(2);
    expect(rolls[0]?.paths).toEqual([
      ['Drops', '100%'],
      ['Drops', 'Runes'],
      ['Drops', 'Materials'],
    ]);
    // Tertiary is its own thing and does not reach 1.
    expect(rolls[1]?.chanceSum).toBeCloseTo(1 / 500, 6);
  });

  it('gives one roll per reward tier', () => {
    const rolls = groupRolls(parseLootTables(SACK));
    expect(rolls).toHaveLength(3);
    for (const roll of rolls) {
      expect(roll.chanceSum).toBeCloseTo(1, 6);
      expect(roll.drops).toHaveLength(10);
    }
  });

  it('leaves a table that never reaches one as an incomplete roll', () => {
    const rolls = groupRolls(
      parseLootTables(
        '==Unique==\n{{DropsLine|name=Pet|quantity=1|rarity=1/100}}\n==Other==\n{{DropsLine|name=Coins|quantity=1|rarity=1/4}}',
      ),
    );
    expect(rolls).toHaveLength(1);
    expect(rolls[0]?.chanceSum).toBeCloseTo(0.26, 6);
  });
});

describe('curated loot rows', () => {
  function page(page: string, text: string): [string, LootPageResult] {
    return [
      page,
      { page, rolls: groupRolls(parseLootTables(text)), fetchedAt: 0 },
    ];
  }

  it('prices Zalcano per kill and the sack per tier, with no rate', () => {
    const pages = new Map<string, LootPageResult>([
      page('Zalcano', ZALCANO),
      page('Hallowed sack', SACK),
    ]);
    const { sources, problems } = lootEvSources(LOOT_ROWS, pages);

    expect(problems).toEqual([]);
    expect(sources.length).toBe(LOOT_ROWS.length);
    for (const source of sources) {
      // No page publishes kills or sacks per hour, so the rate stays null.
      expect(source.secondsPerAction).toBeNull();
      expect(source.drops.length).toBeGreaterThan(0);
    }
    const zalcano = sources.find((source) => source.name === 'Zalcano');
    expect(zalcano?.level).toBe(70);
    expect(zalcano?.drops.some((drop) => drop.item === 'Crystal shard')).toBe(true);
  });

  it('drops a curated row whose roll is missing or does not sum to one', () => {
    const pages = new Map<string, LootPageResult>([
      page('Zalcano', '==Runes==\n{{DropsLine|name=Blood rune|quantity=1|rarity=1/36}}'),
      page('Hallowed sack', SACK),
    ]);
    const { sources, problems } = lootEvSources(LOOT_ROWS, pages);

    expect(sources.some((source) => source.name === 'Zalcano')).toBe(false);
    expect(problems.some((problem) => problem.startsWith('Zalcano:'))).toBe(true);
  });

  it('states why every loot source it does not use was refused', () => {
    for (const refusal of LOOT_REFUSALS) {
      expect(refusal.name.length).toBeGreaterThan(0);
      expect(refusal.reason.length).toBeGreaterThan(20);
    }
  });
});
