/**
 * The skilling success function and its chart parser.
 *
 * The formula is the wiki's own, so the tests pin its **worked examples**
 * (<https://oldschool.runescape.wiki/w/Skilling_success_chart>) rather than a
 * reimplementation's opinion: monkfish at level 74 is exactly 80/256, and barbarian
 * fishing's three cascaded rolls are the page's sturgeon/salmon/trout values.
 */

import { describe, expect, it } from 'vitest';

import {
  chartDistribution,
  chartOptionAtLevel,
  successChanceAt,
  successValueAt,
} from '../src/domain/successChance.js';
import type { SuccessChart } from '../src/domain/successChance.js';
import { parseSuccessChart, primaryOption } from '../src/api/wikiSuccessChart.js';

describe('successValueAt', () => {
  it('matches the published worked example (monkfish, 74)', () => {
    // low 48 / high 90 at level 74 -> 80/256 = 0.3125.
    expect(successValueAt({ low: 48, high: 90 }, 74)).toBe(80);
    expect(successChanceAt({ low: 48, high: 90 }, 74)).toBe(0.3125);
  });

  it('matches the barbarian fishing cascade values at level 85', () => {
    expect(successChanceAt({ low: 8, high: 64 }, 85)).toBeCloseTo(0.2227, 3);
    expect(successChanceAt({ low: 16, high: 96 }, 85)).toBeCloseTo(0.3359, 3);
    expect(successChanceAt({ low: 32, high: 192 }, 85)).toBeCloseTo(0.6641, 3);
  });

  it('clamps a roll above certainty and one below zero', () => {
    // Cerulean twitch: high 380 is > 256, so level 99 is a guaranteed catch.
    expect(successChanceAt({ low: 82, high: 380 }, 99)).toBe(1);
    // Carnivorous chinchompa: `Red` has low -78, so a low level rolls below zero
    // rather than negative.
    expect(successChanceAt({ low: -78, high: 228 }, 1)).toBe(0);
  });

  it('reads the red chinchompa entry at its own level', () => {
    // The wiki's prose says "115/255 beginning at level 63" for the red chinchompa;
    // the chart's Red option gives 117/256 at 63.
    expect(successChanceAt({ low: -78, high: 228 }, 63)).toBeCloseTo(117 / 256, 6);
  });

  it('treats a level outside 1..99 as the nearest bound', () => {
    expect(successValueAt({ low: 48, high: 90 }, 0)).toBe(
      successValueAt({ low: 48, high: 90 }, 1),
    );
    expect(successValueAt({ low: 48, high: 90 }, 120)).toBe(
      successValueAt({ low: 48, high: 90 }, 99),
    );
  });
});

function chart(overrides: Partial<SuccessChart> = {}): SuccessChart {
  return {
    label: 'test chart',
    cascade: false,
    options: [{ label: 'Raw monkfish', low: 48, high: 90, requiredLevel: 62 }],
    ...overrides,
  };
}

describe('chartDistribution', () => {
  it('gives a single-option chart the plain success chance', () => {
    const outcomes = chartDistribution(chart(), 74);
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]?.chance).toBe(0.3125);
  });

  it('discounts each cascaded option by the chance an earlier one succeeded', () => {
    const barbarian = chart({
      cascade: true,
      options: [
        { label: 'Leaping sturgeon', low: 8, high: 64, requiredLevel: 70 },
        { label: 'Leaping salmon', low: 16, high: 96, requiredLevel: 58 },
        { label: 'Leaping trout', low: 32, high: 192, requiredLevel: 48 },
      ],
    });
    const outcomes = chartDistribution(barbarian, 85);
    const sturgeon = successChanceAt({ low: 8, high: 64 }, 85);
    const salmon = successChanceAt({ low: 16, high: 96 }, 85);
    const trout = successChanceAt({ low: 32, high: 192 }, 85);

    expect(outcomes[0]?.chance).toBeCloseTo(sturgeon, 6);
    expect(outcomes[1]?.chance).toBeCloseTo(salmon * (1 - sturgeon), 6);
    expect(outcomes[2]?.chance).toBeCloseTo(trout * (1 - sturgeon) * (1 - salmon), 6);
    // A cascade need not add up to one: the remainder is "nothing".
    const total = outcomes.reduce((sum, outcome) => sum + outcome.chance, 0);
    expect(total).toBeLessThan(1);
  });

  it('uses only the first option when the chart is not cascaded', () => {
    const gearVariants = chart({
      options: [
        { label: 'Normal', low: 180, high: 240, requiredLevel: 1 },
        { label: 'Gloves of silence', low: 189, high: 252, requiredLevel: 1 },
      ],
    });
    expect(chartDistribution(gearVariants, 1)).toHaveLength(1);
  });
});

describe('chartOptionAtLevel', () => {
  const chinchompa = chart({
    options: [
      { label: 'Grey', low: 6, high: 268, requiredLevel: 53 },
      { label: 'Red', low: -78, high: 228, requiredLevel: 63 },
      { label: 'Black', low: -78, high: 228, requiredLevel: 73 },
    ],
  });

  it('picks the option gated at the activity level, not the first one', () => {
    expect(chartOptionAtLevel(chinchompa, 63)?.label).toBe('Red');
    expect(chartOptionAtLevel(chinchompa, 73)?.label).toBe('Black');
  });

  it('falls back to the first option when no requirement matches', () => {
    expect(chartOptionAtLevel(chinchompa, 50)?.label).toBe('Grey');
    expect(chartOptionAtLevel(chinchompa, null)?.label).toBe('Grey');
  });

  it('keeps the plain variant ahead of the gear ones', () => {
    const pickpocket = chart({
      options: [
        { label: 'Normal', low: 180, high: 240, requiredLevel: 1 },
        { label: 'Gloves of silence', low: 189, high: 252, requiredLevel: 1 },
      ],
    });
    expect(chartOptionAtLevel(pickpocket, 1)?.label).toBe('Normal');
  });
});

describe('parseSuccessChart', () => {
  it('reads a chart written entirely on one line', () => {
    // The real Cerulean twitch chart: inline, so a parser that splits on newlines
    // loses every option.
    const parsed = parseSuccessChart(
      '{{Skilling success chart|label=Cerulean twitch catch chance|showbefore=no' +
        '|label1=Cerulean twitch|low1=82|high1=380|req1=11|color1=#41416e' +
        '|image1=Cerulean twitch icon.png}}',
    );
    expect(parsed?.label).toBe('Cerulean twitch catch chance');
    expect(parsed?.cascade).toBe(false);
    expect(parsed?.options).toEqual([
      { label: 'Cerulean twitch', low: 82, high: 380, requiredLevel: 11 },
    ]);
  });

  it('reads a multi-line cascading chart', () => {
    const parsed = parseSuccessChart(
      '{{Skilling success chart|label=Trout + salmon fishing chance|cascade=yes|showbefore=no\n' +
        '|label1=Raw salmon|low1=16|high1=96|req1=30|color1=#c77f72\n' +
        '|label2=Raw trout|low2=32|high2=192|req2=20|color2=#9a908f}}',
    );
    expect(parsed?.cascade).toBe(true);
    expect(parsed?.options.map((option) => option.label)).toEqual([
      'Raw salmon',
      'Raw trout',
    ]);
    expect(parsed?.options[1]?.requiredLevel).toBe(20);
  });

  it('returns null when the page has no chart', () => {
    expect(parseSuccessChart('== Loot ==\n{{DropsTableHead}}')).toBeNull();
  });

  it('drops an option that has no numeric low/high instead of defaulting it', () => {
    const parsed = parseSuccessChart(
      '{{Skilling success chart|label=x\n|label1=A|low1=10|high1=20|req1=1\n' +
        '|label2=B|req2=5\n|label3=C|low3=30|high3=40|req3=9}}',
    );
    expect(parsed?.options.map((option) => option.label)).toEqual(['A']);
  });

  it('defaults a missing req to level 1 and names the primary option', () => {
    const parsed = parseSuccessChart(
      '{{Skilling success chart|label=x|label1=A|low1=10|high1=20}}',
    );
    expect(parsed?.options[0]?.requiredLevel).toBe(1);
    if (parsed === null) throw new Error('expected a parsed chart');
    expect(primaryOption(parsed)?.label).toBe('A');
  });

  it('strips a link from a label', () => {
    const parsed = parseSuccessChart(
      '{{Skilling success chart|label=x|label1=[[Raw trout]]|low1=32|high1=192|req1=20}}',
    );
    expect(parsed?.options[0]?.label).toBe('Raw trout');
  });
});
