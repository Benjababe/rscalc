import { describe, expect, it } from 'vitest';
import {
  bankTripSeconds,
  CROSS_MAP_TRUST_TILES,
  mapDistanceTiles,
  nearestBankFor,
  roundTripSeconds,
} from '../src/domain/bankTrip.js';
import type { MapPoint } from '../src/types.js';

const SHOP: MapPoint = { x: 3216, y: 3415, mapID: 0 };

function banks(entries: Record<string, MapPoint>): Map<string, MapPoint> {
  return new Map(Object.entries(entries));
}

describe('nearestBankFor', () => {
  it('picks the closest bank in the same map space', () => {
    const result = nearestBankFor(
      SHOP,
      banks({
        'Far bank': { x: 3300, y: 3415, mapID: 0 },
        'Near bank': { x: 3226, y: 3415, mapID: 0 },
        'Other map': { x: 3216, y: 3415, mapID: 10 },
      }),
    );

    expect(result).toEqual({ bankPage: 'Near bank', tiles: 10 });
  });

  it('prefers the shop map even when another map is closer in raw tiles', () => {
    const keldagrimShop: MapPoint = { x: 2835, y: 10210, mapID: 10 };
    const result = nearestBankFor(
      keldagrimShop,
      banks({
        'Keldagrim bank': { x: 2845, y: 10210, mapID: 10 },
        'Varrock west bank': { x: 2835, y: 10212, mapID: 0 },
      }),
    );

    expect(result?.bankPage).toBe('Keldagrim bank');
    expect(result?.tiles).toBe(10);
  });

  it('falls back to a nearly-identical cross-map bank', () => {
    // Cam Torum shops are mapID 44; the bank page carries mapID -1.
    const result = nearestBankFor(
      { x: 1449, y: 9584, mapID: 44 },
      banks({ 'Cam Torum bank': { x: 1454, y: 9568, mapID: -1 } }),
    );

    expect(result?.bankPage).toBe('Cam Torum bank');
  });

  it('refuses a cross-map bank that is not the same place', () => {
    // Dwarven Mine shop; Keldagrim is ~398 tiles away in raw coordinates.
    const result = nearestBankFor(
      { x: 2998, y: 9845, mapID: 6 },
      banks({ 'Keldagrim bank': { x: 2835, y: 10210, mapID: 10 } }),
    );

    expect(result).toBeNull();
  });

  it('treats mapID -1 as a custom map, not a shared one', () => {
    const result = nearestBankFor(
      { x: 3049, y: 2970, mapID: -1 },
      banks({ 'Some bank': { x: 3049, y: 2568, mapID: -1 } }),
    );

    expect(result).toBeNull();
  });

  it('only trusts cross-map banks inside the default radius', () => {
    const shop: MapPoint = { x: 0, y: 0, mapID: 5 };
    const inside = banks({
      Bank: { x: CROSS_MAP_TRUST_TILES, y: 0, mapID: 0 },
    });
    const outside = banks({
      Bank: { x: CROSS_MAP_TRUST_TILES + 1, y: 0, mapID: 0 },
    });

    expect(nearestBankFor(shop, inside)).not.toBeNull();
    expect(nearestBankFor(shop, outside)).toBeNull();
  });

  it('respects a caller-supplied trust radius', () => {
    const shop: MapPoint = { x: 0, y: 0, mapID: 5 };
    const map = banks({ Bank: { x: 30, y: 0, mapID: 0 } });

    expect(nearestBankFor(shop, map)).not.toBeNull();
    expect(nearestBankFor(shop, map, { crossMapTrustTiles: 10 })).toBeNull();
  });

  it('is deterministic on a tie', () => {
    const result = nearestBankFor(
      SHOP,
      banks({
        'B bank': { x: 3226, y: 3415, mapID: 0 },
        'A bank': { x: 3206, y: 3415, mapID: 0 },
      }),
    );

    expect(result?.bankPage).toBe('A bank');
  });

  it('returns null with no banks', () => {
    expect(nearestBankFor(SHOP, new Map())).toBeNull();
  });
});

describe('bankTripSeconds', () => {
  it('charges the round trip plus the handover', () => {
    expect(bankTripSeconds(10, 0.5, 3)).toBe(13);
    expect(bankTripSeconds(0, 0.6, 3)).toBe(3);
  });

  it('doubles the one-way distance', () => {
    expect(bankTripSeconds(20, 0.3, 0)).toBe(12);
  });

  it('grows with distance, so two shops never share a time', () => {
    expect(bankTripSeconds(5, 0.6, 3)).toBeLessThan(bankTripSeconds(50, 0.6, 3));
  });

  it('shares one formula with the GE -> shop trip', () => {
    expect(bankTripSeconds(12, 0.6, 3)).toBe(roundTripSeconds(12, 0.6, 3));
  });
});

describe('mapDistanceTiles', () => {
  it('measures straight-line tiles on a shared map', () => {
    expect(
      mapDistanceTiles(SHOP, { x: 3226, y: 3415, mapID: 0 }),
    ).toBeCloseTo(10);
  });

  it('refuses a different map unless the points nearly coincide', () => {
    // Keldagrim (mapID 10) has its own coordinate space: a surface point that
    // looks "100 tiles away" is not 100 tiles away in game.
    expect(
      mapDistanceTiles(SHOP, { x: SHOP.x + 100, y: SHOP.y, mapID: 10 }),
    ).toBeNull();

    // Within the same trust radius as the cross-map bank fallback, a shop page
    // that forgot its mapID is still usable.
    const near = mapDistanceTiles(SHOP, {
      x: SHOP.x + CROSS_MAP_TRUST_TILES,
      y: SHOP.y,
      mapID: 10,
    });
    expect(near).toBe(CROSS_MAP_TRUST_TILES);
  });

  it('never treats the -1 custom-map sentinel as a shared map', () => {
    expect(
      mapDistanceTiles(
        { x: 100, y: 100, mapID: -1 },
        { x: 100, y: 100, mapID: -1 },
      ),
    ).toBe(0);
    expect(
      mapDistanceTiles(
        { x: 100, y: 100, mapID: -1 },
        { x: 110, y: 100, mapID: -1 },
      ),
    ).toBe(10);
    expect(
      mapDistanceTiles(
        { x: 100, y: 100, mapID: -1 },
        { x: 200, y: 100, mapID: -1 },
      ),
    ).toBeNull();
  });
});
