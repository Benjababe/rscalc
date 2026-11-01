/**
 * Minigame overlays: published throughput and fees replacing a bucket tick count.
 *
 * The refusals matter as much as the maths. A minigame is only priced when both
 * halves are published — a reward with no rate, or a rate with no fixed reward, is
 * not an hourly figure and must not become one.
 */

import { describe, expect, it } from 'vitest';

import type { RawRecipe } from '../src/api/wikiRecipes.js';
import { minigameOverlay, overlayKeys } from '../src/domain/minigame.js';
import type { MinigameRate } from '../src/domain/minigame.js';
import { rankProcess } from '../src/engine/processRank.js';
import type { MarketQuote, MarketSnapshot } from '../src/types.js';
import { BLAST_FURNACE, MINIGAME_RATES, MINIGAME_REFUSALS } from '../scripts/minigameSources.js';

describe('minigameOverlay', () => {
  it('replaces the rate and charges the fee per action', () => {
    const overlay = minigameOverlay(MINIGAME_RATES, 'Blast Furnace', 'Steel bar');
    if (overlay === null) throw new Error('expected a Blast Furnace overlay');

    // 2,900 bars/hour is the lower bound of the published 2,900–3,400.
    expect(overlay.actionsPerHour).toBe(2_900);
    // 72,000 / 2,900 = 24.83 gp per bar, rounded up so the row stays pessimistic.
    expect(overlay.feePerAction).toBe(25);
  });

  it('matches the facility and the output case-insensitively', () => {
    expect(
      minigameOverlay(MINIGAME_RATES, 'blast furnace', 'runite BAR'),
    ).not.toBeNull();
  });

  it('leaves a recipe outside the minigame alone', () => {
    // A normal furnace is not the Blast Furnace: no fee, no rate override.
    expect(minigameOverlay(MINIGAME_RATES, 'Furnace', 'Steel bar')).toBeNull();
    // Right facility, item the table does not cover.
    expect(
      minigameOverlay(MINIGAME_RATES, 'Blast Furnace', 'Steel platebody'),
    ).toBeNull();
    expect(minigameOverlay(MINIGAME_RATES, null, 'Steel bar')).toBeNull();
  });

  it('refuses a non-positive published rate rather than pricing it', () => {
    const broken: MinigameRate = {
      facility: 'Test Furnace',
      feePerHour: 1_000,
      source: 'https://example.test',
      actionsPerHour: new Map([['Bar', 0]]),
    };
    expect(minigameOverlay([broken], 'Test Furnace', 'Bar')).toBeNull();
  });

  it('lists every curated key for the drift check', () => {
    const keys = overlayKeys([BLAST_FURNACE]);
    expect(keys.has('blast furnace|steel bar')).toBe(true);
    expect(keys.size).toBe(BLAST_FURNACE.actionsPerHour.size);
  });
});

describe('minigame sources', () => {
  it('cites a wiki page for the rate and the fee', () => {
    for (const rate of MINIGAME_RATES) {
      expect(rate.source).toMatch(/^https:\/\/oldschool\.runescape\.wiki\/w\//);
      expect(rate.feePerHour).toBeGreaterThanOrEqual(0);
      expect(rate.actionsPerHour.size).toBeGreaterThan(0);
      for (const perHour of rate.actionsPerHour.values()) {
        expect(perHour).toBeGreaterThan(0);
      }
    }
  });

  it('states a reason for every minigame it does not price', () => {
    // A refusal without a reason is indistinguishable from "not looked at".
    for (const refusal of MINIGAME_REFUSALS) {
      expect(refusal.name.length).toBeGreaterThan(0);
      expect(refusal.reason.length).toBeGreaterThan(20);
    }
  });

  it('surveys the whole minigame set, not a sample', () => {
    const named = MINIGAME_REFUSALS.map((entry) => entry.name.toLowerCase());
    // Every minigame a player would look for: the ones with reward tables whose
    // quantities or rates are unpublished, the point shops, and the ones with no
    // table at all. A minigame missing here would read as "never considered".
    for (const required of [
      'zalcano',
      'wintertodt',
      'tempoross',
      'guardians of the rift',
      'hallowed sepulchre',
      'fishing trawler',
      'volcanic mine',
      'tithe farm',
      'pest control',
      'nightmare zone',
      'barbarian assault',
      'mage training arena',
      'mahogany homes',
      "giants' foundry",
    ]) {
      expect(named).toContain(required);
    }
    expect(new Set(named).size).toBe(named.length);
  });

  it('prices only the minigame that publishes both halves', () => {
    // One priced, everything else refused: if a second facility ever appears in
    // `MINIGAME_RATES` it must come with both a rate table and a fee.
    expect(MINIGAME_RATES.map((rate) => rate.facility)).toEqual(['Blast Furnace']);
    expect(MINIGAME_REFUSALS.length).toBeGreaterThanOrEqual(20);
  });
});

function blastFurnaceRecipe(overrides: Partial<RawRecipe> = {}): RawRecipe {
  return {
    id: 'steel bar|blast',
    page: 'Steel bar',
    method: 'Blast Furnace',
    // The bucket's per-item process time: 11 ticks = 545 bars/hour. Wrong for this
    // facility, which is the whole reason the overlay exists.
    ticks: 11,
    materials: [
      { name: 'Iron ore', quantity: 1, note: null },
      { name: 'Coal', quantity: 1, note: null },
    ],
    output: { name: 'Steel bar', quantity: 1, note: null },
    facilities: 'Blast Furnace',
    tools: null,
    members: true,
    skills: [{ name: 'Smithing', level: 30 }],
    ...overrides,
  };
}

function quote(overrides: Partial<MarketQuote> = {}): MarketQuote {
  return {
    id: 1,
    name: 'Steel bar',
    members: true,
    value: 100,
    stackable: null,
    limit: 10_000,
    high: 500,
    low: 490,
    avgHighPrice24h: 500,
    avgLowPrice24h: 490,
    highVolume24h: 600_000,
    lowVolume24h: 600_000,
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

const MARKET = market([
  quote({ id: 1, name: 'Iron ore', high: 50, low: 50 }),
  quote({ id: 2, name: 'Coal', high: 120, low: 120 }),
  quote({ id: 3, name: 'Steel bar', high: 500, low: 500 }),
]);

describe('rankProcess with a minigame overlay', () => {
  it('uses the published rate and charges the fee', () => {
    const result = rankProcess([blastFurnaceRecipe()], MARKET, {
      mode: 'pessimistic',
      skills: ['Smithing'],
      minigameRates: MINIGAME_RATES,
    });
    const row = result.opportunities[0];
    if (row === undefined) throw new Error('expected a bar row');

    // 1 iron ore + 1 coal at 50/120 = 170 gp; the bar sells at 500 minus the 10 gp tax.
    expect(row.itemCost).toBe(170);
    // 72,000 / 2,900 = 24.83, rounded up to 25 gp per bar.
    expect(row.feeGp).toBe(25);
    expect(row.profit).toBe(500 - 10 - 170 - 25);
    // The bucket's 11 ticks are replaced, so no tick count is reported next to a
    // rate that did not come from it.
    expect(row.ticks).toBeNull();
    expect(row.secondsPerAction).toBeCloseTo(3600 / 2_900, 6);
    // Whole 4h actions at 2,900/hour.
    expect(row.actions4h).toBe(Math.min(row.marketActions4h, 2_900 * 4));
    expect(row.gpPerHour).toBeCloseTo((row.profit * row.actions4h) / 4, 6);
  });

  it('leaves the same recipe at a normal furnace untouched', () => {
    const result = rankProcess(
      [blastFurnaceRecipe({ facilities: 'Furnace', method: 'Furnace' })],
      MARKET,
      { mode: 'pessimistic', skills: ['Smithing'], minigameRates: MINIGAME_RATES },
    );
    const row = result.opportunities[0];
    if (row === undefined) throw new Error('expected a bar row');

    expect(row.feeGp).toBe(0);
    expect(row.ticks).toBe(11);
    expect(row.secondsPerAction).toBeCloseTo(6.6, 6);
  });

  it('still applies a player actions/hour cap on top of the published rate', () => {
    const result = rankProcess([blastFurnaceRecipe()], MARKET, {
      mode: 'pessimistic',
      skills: ['Smithing'],
      minigameRates: MINIGAME_RATES,
      maxActionsPerHour: 1_000,
    });
    const row = result.opportunities[0];
    if (row === undefined) throw new Error('expected a bar row');
    // A cap can only slow a recipe down, never speed it up.
    expect(row.timeActions4h).toBe(4_000);
  });
});
