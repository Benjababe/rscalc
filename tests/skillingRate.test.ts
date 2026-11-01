/**
 * The player-entered actions/hour: gap-filling arithmetic.
 *
 * The rule these tests pin is the one that keeps a typed number from passing as a
 * measured one: a published rate always wins, the player's rate only fills rows the
 * wiki publishes no time for, and the market still caps how many actions an hour can
 * be sold.
 */

import { describe, expect, it } from 'vitest';

import { hourlyRate } from '../web/src/skillingRate.js';
import type { SkillActivity } from '../src/types.js';

type RateInput = Pick<SkillActivity, 'gpPerHour' | 'profit' | 'marketActions4h'>;

function activity(overrides: Partial<RateInput> = {}): RateInput {
  return {
    gpPerHour: null,
    profit: 100,
    marketActions4h: 4000,
    ...overrides,
  };
}

describe('hourlyRate', () => {
  it('keeps a published rate and ignores the player figure', () => {
    const rate = hourlyRate(
      activity({ gpPerHour: 1234, profit: 999 }),
      600,
    );
    expect(rate.gpPerHour).toBe(1234);
    expect(rate.basis).toBe('wiki');
    expect(rate.appliedActionsPerHour).toBeNull();
    expect(rate.capped).toBe(false);
  });

  it('fills a missing rate with profit per action times the player rate', () => {
    const rate = hourlyRate(activity({ profit: 72 }), 500);
    expect(rate.gpPerHour).toBe(36_000);
    expect(rate.basis).toBe('manual');
    expect(rate.appliedActionsPerHour).toBe(500);
    expect(rate.capped).toBe(false);
  });

  it('reports a loss as a loss', () => {
    const rate = hourlyRate(activity({ profit: -214 }), 1000);
    expect(rate.gpPerHour).toBe(-214_000);
    expect(rate.basis).toBe('manual');
  });

  it('shows nothing when neither a published rate nor a player rate exists', () => {
    for (const manual of [0, -5, Number.NaN]) {
      const rate = hourlyRate(activity(), manual);
      expect(rate.gpPerHour).toBeNull();
      expect(rate.basis).toBeNull();
    }
  });

  it('caps the player rate at what the market absorbs in an hour', () => {
    // 4h volume slice of 2,000 actions -> 500 an hour.
    const rate = hourlyRate(activity({ profit: 10, marketActions4h: 2000 }), 5000);
    expect(rate.appliedActionsPerHour).toBe(500);
    expect(rate.gpPerHour).toBe(5000);
    expect(rate.capped).toBe(true);
  });

  it('never caps below one action an hour', () => {
    // A 4h slice of 2 is 0.5 an hour, which would zero a real row.
    const rate = hourlyRate(activity({ profit: 10, marketActions4h: 2 }), 400);
    expect(rate.appliedActionsPerHour).toBe(1);
    expect(rate.gpPerHour).toBe(10);
    expect(rate.capped).toBe(true);
  });

  it('does not cap a rate the market can absorb', () => {
    const rate = hourlyRate(activity({ profit: 10, marketActions4h: 4000 }), 1000);
    expect(rate.appliedActionsPerHour).toBe(1000);
    expect(rate.capped).toBe(false);
  });
});
