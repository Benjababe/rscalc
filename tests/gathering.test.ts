/**
 * The gathering model: respawn times read off the wiki, and the rows they price.
 *
 * Three things are worth pinning here, because each one is a place a wrong number
 * could hide:
 *
 *  - duration parsing, including the "faster variant" case (`12 minutes<br/>6
 *    minutes in Mining Guild`) where the *slowest* value must win;
 *  - a node whose item has no GE market is `unpriced`, never priced at zero;
 *  - the row's rate is the respawn, so `gp/hour` is what one uncontested node
 *    sustains — a single node, not a mining run.
 */

import { describe, expect, it } from 'vitest';

import {
  extractGatheringNode,
  parseDurationSeconds,
} from '../src/api/wikiGathering.js';
import { rankGatherActivities } from '../src/engine/skilling.js';
import type { MarketQuote, MarketSnapshot } from '../src/types.js';

describe('parseDurationSeconds', () => {
  it('reads the units the infobox uses', () => {
    expect(parseDurationSeconds('12 minutes')).toBe(720);
    expect(parseDurationSeconds('59.4 seconds')).toBe(59.4);
    expect(parseDurationSeconds('1 minute 30 seconds')).toBe(90);
    expect(parseDurationSeconds('3 ticks')).toBeCloseTo(1.8);
  });

  it('takes the slowest variant, because the fast one needs something you may not have', () => {
    expect(
      parseDurationSeconds('12 minutes<br/>6 minutes in Mining Guild'),
    ).toBe(720);
  });

  it('returns null rather than a guess', () => {
    expect(parseDurationSeconds('varies')).toBeNull();
    expect(parseDurationSeconds('')).toBeNull();
  });
});

describe('extractGatheringNode', () => {
  const wikitext = `{{Infobox Item
|name = Runite ore
}}
==Mining info==
{{Mining info
|name = Runite rocks
|level = 85
|xp = 125
|rock = [[Runite rocks]]
|tool = [[Pickaxe]]
|time = 12 minutes<br/>6 minutes in Mining Guild
}}
`;

  it('reads the skill infobox by parameter name', () => {
    const node = extractGatheringNode('Runite ore', wikitext);
    expect(node).toEqual({
      item: 'Runite ore',
      skill: 'Mining',
      level: 85,
      xp: 125,
      respawnSeconds: 720,
      source: 'https://oldschool.runescape.wiki/w/Runite_ore',
      nodePage: 'Runite rocks',
    });
  });

  it('returns null for a page with no gathering template', () => {
    expect(extractGatheringNode('Shark', '{{Infobox Item|name = Shark}}')).toBeNull();
  });

  it('returns null when the template has no readable time', () => {
    const noTime = wikitext.replace('|time = 12 minutes<br/>6 minutes in Mining Guild', '|time = varies');
    expect(extractGatheringNode('Runite ore', noTime)).toBeNull();
  });
});

function quote(overrides: Partial<MarketQuote> = {}): MarketQuote {
  return {
    id: 1,
    name: 'Runite ore',
    members: true,
    value: 11_000,
    stackable: null,
    limit: 100,
    high: 12_000,
    low: 11_800,
    avgHighPrice24h: 12_000,
    avgLowPrice24h: 11_800,
    highVolume24h: 600,
    lowVolume24h: 300,
    highTime: null,
    lowTime: null,
    ...overrides,
  };
}

function market(quotes: MarketQuote[]): MarketSnapshot {
  return {
    generatedAt: '2026-01-01T00:00:00.000Z',
    pricesAsOf: '2026-01-01T00:00:00.000Z',
    itemCount: quotes.length,
    quotes: Object.fromEntries(quotes.map((entry) => [String(entry.id), entry])),
  };
}

describe('rankGatherActivities', () => {
  const NODE = {
    item: 'Runite ore',
    skill: 'Mining' as const,
    level: 85,
    xp: 125,
    respawnSeconds: 720,
    source: 'https://oldschool.runescape.wiki/w/Runite_ore',
    nodePage: 'Runite rocks',
  };

  it('prices one unit per respawn, with no inputs and no fee', () => {
    const result = rankGatherActivities([NODE], market([quote()]), {
      skill: 'Mining',
      mode: 'pessimistic',
    });

    const row = result.activities[0];
    if (row === undefined) throw new Error('expected a gather row');
    expect(row.kind).toBe('gather');
    expect(row.inputs).toEqual([]);
    expect(row.spend).toBe(0);
    // Sell side in pessimistic mode is `low`: 11,800 less the 236 gp GE tax.
    expect(row.tax).toBe(236);
    expect(row.profit).toBe(11_564);
    expect(row.secondsPerAction).toBe(720);
    // Five respawns an hour from one node.
    expect(row.gpPerHour).toBe(5 * 11_564);
    expect(result.unpriced).toBe(0);
  });

  it('caps the plan by 4h market volume, not by the respawn alone', () => {
    const result = rankGatherActivities(
      [NODE],
      // The low side only trades 30 units a day: a 4h slice is 5 units.
      market([quote({ lowVolume24h: 30 })]),
      { skill: 'Mining', mode: 'pessimistic' },
    );

    const row = result.activities[0];
    if (row === undefined) throw new Error('expected a gather row');
    expect(row.actions4h).toBe(5);
    expect(row.marketActions4h).toBe(5);
  });

  it('leaves a node with no GE market unpriced', () => {
    const result = rankGatherActivities([NODE], market([]), {
      skill: 'Mining',
      mode: 'pessimistic',
    });

    expect(result.activities).toHaveLength(0);
    expect(result.unpriced).toBe(1);
  });

  it('charges the bank trip per load, from the node page pins', () => {
    const result = rankGatherActivities([NODE], market([quote()]), {
      skill: 'Mining',
      mode: 'pessimistic',
      bankTilesByItem: new Map([['Runite ore', 40]]),
      stackableByItem: new Map([['runite ore', false]]),
      secondsPerTile: 0.6,
      handoverSeconds: 3,
    });

    const row = result.activities[0];
    if (row === undefined) throw new Error('expected a gather row');
    // 2 x 40 x 0.6 + 3 = 51s per trip, spread over 27 ore.
    expect(row.bankTiles).toBe(40);
    expect(row.effectiveSecondsPerAction).toBeCloseTo(720 + 51 / 27);
    // Whole 4h actions, the same convention as the processing engine.
    expect(row.actions4h).toBe(Math.floor(14_400 / (720 + 51 / 27)));
    expect(row.gpPerHour).toBe((11_564 * row.actions4h) / 4);
  });

  it('charges no walk when the node page has no pin', () => {
    const result = rankGatherActivities([NODE], market([quote()]), {
      skill: 'Mining',
      mode: 'pessimistic',
      bankTilesByItem: new Map([['Runite ore', null]]),
    });

    const row = result.activities[0];
    if (row === undefined) throw new Error('expected a gather row');
    expect(row.bankTiles).toBeNull();
    expect(row.effectiveSecondsPerAction).toBe(720);
  });

  it('only prices the nodes of the requested skill', () => {
    const result = rankGatherActivities(
      [NODE, { ...NODE, item: 'Yew logs', skill: 'Woodcutting' as const }],
      market([quote(), quote({ id: 2, name: 'Yew logs' })]),
      { skill: 'Mining', mode: 'pessimistic' },
    );

    expect(result.activities).toHaveLength(1);
    expect(result.activities[0]?.outputName).toBe('Runite ore');
  });
});
