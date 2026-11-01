/**
 * The three expected-value source parsers: pickpockets, fishing and hunter.
 *
 * Each test uses wikitext with the real template shapes, because the point of these
 * parsers is that they read the page the way the page is actually written — the
 * pickpocket whose `time` is a **stun timer**, the fishing chart written on one
 * line whose labels are sometimes a tool rather than an item, and the hunter
 * creature whose chart holds one option per colour.
 */

import { describe, expect, it } from 'vitest';

import {
  lootSection,
  parseThievingSource,
  pickpocketChance,
  pickpocketSeconds,
  PICKPOCKET_ATTEMPT_TICKS,
} from '../src/api/wikiThieving.js';
import {
  chartLevel,
  parseFishingSource,
  spotPage,
  tableItemNames,
} from '../src/api/wikiFishing.js';
import {
  BOX_TRAP_ATTEMPT_SECONDS,
  hunterDrops,
  parseHunterSource,
  trapSeconds,
} from '../src/api/wikiHunter.js';
import { parseSuccessChart } from '../src/api/wikiSuccessChart.js';

const MAN = `{{Thieving info
|name = Man
|level = 1
|xp = 8
|type = Pickpocket
|timename = [[Stun_(status)#Thieving|Stun]] Timer
|time = 4.8s
|damage = 1
}}

==Pickpocketing==
===Pickpocket chance===
{{Skilling success chart|label=Man pickpocket chance
|label1=Normal|low1=180|high1=240|req1=1
|label2=Gloves of silence|low2=189|high2=252|req2=1
}}

===Loot===
A successful pickpocket attempt will gain the following loot:
{{DropsTableHead}}
{{DropsLineSkill|name=Coins|quantity=3|rarity=Always|skill=Thieving}}
{{DropsTableBottom}}

===Tertiary===
{{DropsTableHead}}
{{DropsLineSkill|name=Rocky|quantity=1|rarity=1/257211|skill=thieving}}
{{DropsTableBottom}}`;

describe('pickpockets', () => {
  it('reads the Loot section and stops before Tertiary', () => {
    const section = lootSection(MAN);
    expect(section).not.toBeNull();
    expect(section).toContain('Coins');
    // The pet roll is a different section and must not leak into the loot table.
    expect(section).not.toContain('Rocky');
  });

  it('prices a successful attempt, using the stun timer for the time model', () => {
    const { source } = parseThievingSource('Man', MAN);
    if (source === null) throw new Error('expected a pickpocket source');

    expect(source.kind).toBe('Pickpocket');
    // The table is what a *successful* attempt gives, so it is marked conditional.
    expect(source.dropsConditionalOnSuccess).toBe(true);
    // The exact quantity also carries `assumedQuantity: false` and a null range.
    expect(source.drops).toMatchObject([{ item: 'Coins', quantity: 3, chance: 1 }]);
    expect(source.drops[0]?.assumedQuantity).toBe(false);
    // 181/256 at level 1, from the published formula.
    expect(source.successChance).toBeCloseTo(181 / 256, 6);
    // 2 ticks + 4.8s of stun at the 29.3% failure rate.
    expect(source.secondsPerAction).toBeCloseTo(2.61, 2);
    expect(source.secondsPerAction).not.toBe(4.8);
    expect(source.droppedLines).toBe(0);
  });

  it('never uses the stun timer as an action time', () => {
    // With no success chance there is no `2 + stun x (1 - p)` to compute, and the
    // stun value itself is not an action time.
    expect(pickpocketSeconds(4.8, null)).toBeNull();
    expect(pickpocketSeconds(null, 0.7)).toBeNull();
    // Two ticks plus the whole stun is the worst case: every attempt fails.
    expect(pickpocketSeconds(4.8, 0)).toBeCloseTo(0.6 * PICKPOCKET_ATTEMPT_TICKS + 4.8, 6);
  });

  it('prices a ranged loot line at its midpoint, marked as an assumption', () => {
    // Operator decision (§3.1): a range is priced at its midpoint and flagged, so the
    // row survives and the page can show that the quantity is assumed.
    const ranged = MAN.replace(
      '{{DropsLineSkill|name=Coins|quantity=3|rarity=Always|skill=Thieving}}',
      '{{DropsLineSkill|name=Coins|quantity=230-315|rarity=109/132|skill=Thieving}}',
    );
    const { source } = parseThievingSource('Vyre', ranged);
    if (source === null) throw new Error('expected a source');
    expect(source.droppedLines).toBe(0);
    expect(source.drops[0]).toMatchObject({
      item: 'Coins',
      quantity: 272.5,
      assumedQuantity: true,
      quantityRange: { min: 230, max: 315 },
    });
  });

  it('still refuses a quantity written as a word', () => {
    const vague = MAN.replace(
      '{{DropsLineSkill|name=Coins|quantity=3|rarity=Always|skill=Thieving}}',
      '{{DropsLineSkill|name=Coins|quantity=Varies|rarity=1/2|skill=Thieving}}',
    );
    const { source } = parseThievingSource('Vyre', vague);
    if (source === null) throw new Error('expected a source');
    // No midpoint exists for `Varies`, so the line is counted and the row is refused
    // by the engine (a table minus its biggest outcome is not the table).
    expect(source.droppedLines).toBe(1);
    expect(source.drops).toHaveLength(0);
  });

  it('keeps a stall on its published action time', () => {
    const stall = `{{Thieving info
|name = Silk stall
|level = 20
|xp = 24
|type = Stall
|time = 2.4 seconds
}}
===Loot===
{{DropsLineSkill|name=Silk|quantity=1|rarity=Always|skill=Thieving}}`;
    const { source } = parseThievingSource('Silk stall', stall);
    if (source === null) throw new Error('expected a stall source');
    expect(source.secondsPerAction).toBe(2.4);
    expect(source.successChance).toBe(1);
    expect(source.dropsConditionalOnSuccess).toBe(false);
  });

  it('returns no chance when the page has no chart', () => {
    expect(pickpocketChance(parseSuccessChart('no chart here'), 50)).toBeNull();
  });
});

const TROUT = `{{Fishing info
|name = Raw trout
|level = 20
|xp = 50
|spot = [[Trout fishing spot]]
|tool = Fly fishing rod
}}
===Fishing chance===
{{Skilling success chart|label=Trout + salmon fishing chance|cascade=yes|showbefore=no|label1=Raw salmon|low1=16|high1=96|req1=30|label2=Raw trout|low2=32|high2=192|req2=20}}`;

const TROUT_SPOT = `{{Fishing info|name = Fishing spot|level = 20}}
===Main drops===
{{DropsTableHead}}
{{DropsLineSkill|name=Raw trout|quantity=1|rarity=common|skill=Fishing|level=20}}
{{DropsLineSkill|name=Raw salmon|quantity=1|rarity=common|skill=Fishing|level=30}}
{{DropsTableBottom}}`;

describe('fishing', () => {
  it('prices a cascading chart at the level the whole method unlocks', () => {
    const { source } = parseFishingSource('Raw trout', TROUT, TROUT_SPOT);
    if (source === null) throw new Error('expected a fishing source');

    expect(source.level).toBe(30);
    // No fishing page publishes an attempt interval.
    expect(source.secondsPerAction).toBeNull();
    expect(source.drops.map((drop) => drop.item)).toEqual(['Raw salmon', 'Raw trout']);
    const total = source.drops.reduce((sum, drop) => sum + drop.chance, 0);
    expect(total).toBeGreaterThan(0.3);
    expect(total).toBeLessThan(0.45);
  });

  it('refuses a chart whose labels are not items the page drops', () => {
    // The shark chart labels its option `Harpoon`, and the anglerfish chart says
    // `Sandworms`; neither is the catch.
    const shark = TROUT.replace('Raw salmon|low1', 'Harpoon|low1');
    const parsed = parseFishingSource('Raw shark', shark, TROUT_SPOT);
    expect(parsed.source).toBeNull();
    expect(parsed.rejected).toBe('label-not-a-drop');
  });

  it('needs a drop table before it will trust a label', () => {
    const parsed = parseFishingSource('Raw trout', TROUT, null);
    expect(parsed.rejected).toBe('label-not-a-drop');
  });

  it('reads a page with no Fishing info block as not a source', () => {
    expect(parseFishingSource('Barbarian Fishing', '{{Skilling success chart|label=x|label1=A|low1=1|high1=2|req1=1}}').rejected).toBe(
      'no-fishing-info',
    );
  });

  it('names the spot page to follow for the drop table', () => {
    expect(spotPage(TROUT)).toBe('Trout fishing spot');
    expect(spotPage('{{Fishing info|name = x}}')).toBeNull();
  });

  it('lists table item names without needing a readable rarity', () => {
    expect(tableItemNames(TROUT_SPOT)).toEqual(['Raw trout', 'Raw salmon']);
  });

  it('takes the highest requirement in a chart as the method level', () => {
    const chart = parseSuccessChart(TROUT);
    if (chart === null) throw new Error('expected a chart');
    expect(chartLevel(chart)).toBe(30);
  });
});

const CHINCHOMPA = `{{Hunter info
|name = Carnivorous chinchompa
|level = 63
|xp = 265
|trap = {{plink|Box trap}}
}}
==Hunting chance==
{{Skilling success chart|label=Chinchompa catch chance|lowLevel=53
|label1=Grey|low1=6|high1=268|req1=53
|label2=Red|low2=-78|high2=228|req2=63
|label3=Black|low3=-78|high3=228|req3=73}}

==Drops==
{{DropsLineSkill|name=Red chinchompa|quantity=1|rarity=Always|skill=Hunter}}
{{DropsLineSkill|name=Red chinchompa tuft|quantity=1|rarity=1/50|skill=Hunter}}
{{DropsLineSkill|name=Baby chinchompa|quantity=1|rarity=Very rare|skill=Hunter}}`;

describe('hunter', () => {
  it('prices the guaranteed catch at this creature\'s own chart option', () => {
    const { source } = parseHunterSource('Carnivorous chinchompa', CHINCHOMPA);
    if (source === null) throw new Error('expected a hunter source');

    // The chart's Red option (req 63), not the Grey one at req 53.
    expect(source.successChance).toBeCloseTo(117 / 256, 6);
    expect(source.trap).toBe('Box trap');
    // The trap publishes an interval, but it is a per-trap ceiling, so the row keeps
    // no rate and the interval is only recorded.
    expect(source.trapAttemptSeconds).toBe(BOX_TRAP_ATTEMPT_SECONDS);
    expect(source.secondsPerAction).toBeNull();
    expect(source.drops).toMatchObject([
      { item: 'Red chinchompa', quantity: 1, chance: 1 },
    ]);
    expect(source.drops[0]?.assumedQuantity).toBe(false);
    // The rumour-only tuft and the unreadable pet roll are counted, not folded in.
    expect(source.ignoredDrops).toBe(2);
  });

  it('records the interval only where a trap publishes one', () => {
    expect(trapSeconds('Bird snare')).toBeNull();
    expect(trapSeconds('Deadfall')).toBeNull();
    expect(trapSeconds(null)).toBeNull();
    expect(trapSeconds('{{plink|Box trap}}')).toBe(BOX_TRAP_ATTEMPT_SECONDS);
  });

  it('takes only the guaranteed lines as the catch', () => {
    const { drops, ignored } = hunterDrops(
      '{{DropsLineSkill|name=Bones|quantity=1|rarity=Always|skill=Hunter}}' +
        '{{DropsLineSkill|name=Polar kebbit fur|quantity=1|rarity=Always|skill=Hunter}}' +
        '{{DropsLineSkill|name=Raw beast meat|quantity=1|rarity=Always|skill=Hunter}}' +
        '{{DropsLineSkill|name=Something|quantity=1|rarity=1/512|skill=Hunter}}',
    );
    expect(drops.map((drop) => drop.item)).toEqual([
      'Bones',
      'Polar kebbit fur',
      'Raw beast meat',
    ]);
    expect(ignored).toBe(1);
  });

  it('refuses a creature page with no chart or no guaranteed drop', () => {
    const noChart = CHINCHOMPA.replace(/==Hunting chance==[\s\S]*?\|req3=73\}\}/, '');
    expect(parseHunterSource('Carnivorous chinchompa', noChart).rejected).toBe('no-chart');

    const noDrop = CHINCHOMPA.replace(
      '{{DropsLineSkill|name=Red chinchompa|quantity=1|rarity=Always|skill=Hunter}}',
      '',
    );
    expect(parseHunterSource('Carnivorous chinchompa', noDrop).rejected).toBe(
      'no-guaranteed-drop',
    );
  });

  it('reads a page with no Hunter info block as not a source', () => {
    expect(parseHunterSource('Ferret', '{{DropsLineSkill|name=Ferret|quantity=1|rarity=Always|skill=Hunter}}').rejected).toBe(
      'no-hunter-info',
    );
  });
});
