import { describe, expect, it } from 'vitest';

import {
  DEFAULT_REST_WINDOW_HOURS,
  DEFAULT_SESSION_MINUTES,
  MAX_REST_WINDOW_HOURS,
  MAX_SESSION_MINUTES,
  overnightBudgetOptions,
  restWindowSeconds,
  sellWindowUnits,
  sessionSecondsFor,
  shopRunUnits,
} from '../src/domain/overnight.js';

describe('restWindowSeconds', () => {
  it('defaults to the overnight window', () => {
    expect(DEFAULT_REST_WINDOW_HOURS).toBe(12);
    expect(restWindowSeconds(undefined)).toBe(12 * 3600);
  });

  it('scales a supplied window and clamps it', () => {
    expect(restWindowSeconds(4)).toBe(4 * 3600);
    expect(restWindowSeconds(0)).toBe(0);
    expect(restWindowSeconds(-5)).toBe(0);
    expect(restWindowSeconds(100)).toBe(MAX_REST_WINDOW_HOURS * 3600);
  });

  it('falls back rather than treating junk as zero', () => {
    // Zero would silently mean "nothing is sellable".
    expect(restWindowSeconds(Number.NaN)).toBe(12 * 3600);
    expect(restWindowSeconds(Number.POSITIVE_INFINITY)).toBe(12 * 3600);
  });
});

describe('sellWindowUnits', () => {
  it('scales the 24h volume to the window and floors it', () => {
    expect(sellWindowUnits(180, 12)).toBe(90);
    expect(sellWindowUnits(180, 4)).toBe(30);
    expect(sellWindowUnits(1, 12)).toBe(0); // half a trade is not a unit
    expect(sellWindowUnits(2, 12)).toBe(1);
    expect(sellWindowUnits(180, 24)).toBe(180);
  });

  it('defaults the window and refuses nonsense volumes', () => {
    expect(sellWindowUnits(180, undefined)).toBe(
      Math.floor((180 * DEFAULT_REST_WINDOW_HOURS) / 24),
    );
    expect(sellWindowUnits(0, 12)).toBe(0);
    expect(sellWindowUnits(Number.NaN, 12)).toBe(0);
    expect(sellWindowUnits(-10, 12)).toBe(0);
  });

  it('never exceeds what a day of trading absorbs', () => {
    expect(sellWindowUnits(1000, 100)).toBe(1000);
  });
});

describe('sessionSecondsFor', () => {
  it('defaults to an hour and converts to seconds', () => {
    expect(DEFAULT_SESSION_MINUTES).toBe(60);
    expect(sessionSecondsFor(undefined)).toBe(undefined);
    expect(sessionSecondsFor(60)).toBe(3600);
    expect(sessionSecondsFor(2.5)).toBe(150);
    expect(sessionSecondsFor(100_000)).toBe(MAX_SESSION_MINUTES * 60);
  });

  it('reads zero, negatives and junk as "no session limit"', () => {
    expect(sessionSecondsFor(0)).toBe(undefined);
    expect(sessionSecondsFor(-30)).toBe(undefined);
    expect(sessionSecondsFor(Number.NaN)).toBe(undefined);
  });
});

describe('shopRunUnits', () => {
  const volumes = { volume24h: 180, volume4h: 30 };

  it('uses the 4h slice with no overnight options', () => {
    expect(shopRunUnits(volumes, undefined)).toBe(30);
    expect(shopRunUnits({ volume24h: 0, volume4h: 0 }, undefined)).toBe(0);
  });

  it('scales to the rest window', () => {
    expect(shopRunUnits(volumes, { restWindowHours: 12 })).toBe(90);
    expect(shopRunUnits(volumes, { restWindowHours: 4 })).toBe(30);
  });

  it('removes the cap entirely for unlimited buyers', () => {
    expect(shopRunUnits(volumes, { unlimitedBuyers: true })).toBe(
      Number.POSITIVE_INFINITY,
    );
    // A market that has not traded in 24h is priced too: that is the point of
    // the assumption, and why the UI labels it.
    expect(
      shopRunUnits({ volume24h: 0, volume4h: 0 }, { unlimitedBuyers: true }),
    ).toBe(Number.POSITIVE_INFINITY);
    // The rest window is irrelevant once the cap is gone.
    expect(
      shopRunUnits(
        volumes,
        { unlimitedBuyers: true, restWindowHours: 1 },
      ),
    ).toBe(Number.POSITIVE_INFINITY);
  });
});

describe('overnightBudgetOptions', () => {
  it('passes the rest window and the session', () => {
    expect(overnightBudgetOptions({})).toEqual({ sellWindowSeconds: 43_200 });
    expect(
      overnightBudgetOptions({ restWindowHours: 8, sessionMinutes: 45 }),
    ).toEqual({ sellWindowSeconds: 28_800, sessionSeconds: 2700 });
  });

  it('charges no fill when the buyers are unlimited', () => {
    // No cap means no fill: the window is not passed at all, so the planner has
    // nothing to charge and reports sellSeconds = 0.
    expect(overnightBudgetOptions({ unlimitedBuyers: true })).toEqual({});
    expect(
      overnightBudgetOptions({ unlimitedBuyers: true, sessionMinutes: 30 }),
    ).toEqual({ sessionSeconds: 1800 });
  });
});
