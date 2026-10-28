/**
 * Per-shop bank travel.
 *
 * Bank trip time is not a global constant: it is the distance from the shop to
 * its nearest bank, doubled, plus the time to use the bank interface. The
 * distance comes from the wiki's map data (`src/api/wikiMap.ts`); this module
 * is the pure join and the seconds conversion.
 *
 * Map ids matter. The overworld is `mapID = 0`, while Keldagrim, Dorgesh-Kaan,
 * Zanaris and friends have their own coordinate space. Comparing across map ids
 * would put a Dwarven Mine shop 398 tiles from Keldagrim's bank instead of
 * saying the mine has no bank at all.
 */

import type { MapPoint } from '../types.js';

/**
 * A bank on a *different* map is accepted only when the coordinates are almost
 * identical. Shops on `mapID = -1` (custom maps) or on a map whose bank page
 * forgot its `mapID` still often share the surface coordinate space; a few
 * tiles apart in the same place is safe, hundreds of tiles apart is not.
 */
export const CROSS_MAP_TRUST_TILES = 40;

export interface NearestBank {
  /** Wiki page title of the bank. */
  bankPage: string;
  /** Straight-line distance in game tiles. */
  tiles: number;
}

function distance(a: MapPoint, b: MapPoint): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function consider(
  best: NearestBank | null,
  bankPage: string,
  tiles: number,
): NearestBank {
  if (best === null) return { bankPage, tiles };
  if (tiles < best.tiles) return { bankPage, tiles };
  if (tiles === best.tiles && bankPage < best.bankPage) return { bankPage, tiles };
  return best;
}

/**
 * Nearest bank to a shop, preferring a bank in the same coordinate space.
 *
 * Returns null when the shop has no coordinates, or when no bank is on its map
 * and no cross-map bank is within `CROSS_MAP_TRUST_TILES`. Null means "we do not
 * know", never "zero seconds": callers must not charge a made-up time.
 */
export function nearestBankFor(
  shop: MapPoint,
  banks: ReadonlyMap<string, MapPoint>,
  options: { crossMapTrustTiles?: number } = {},
): NearestBank | null {
  let best: NearestBank | null = null;

  // `-1` is the wiki's custom-map sentinel, not a real map that banks share.
  if (shop.mapID >= 0) {
    for (const [bankPage, bank] of banks) {
      if (bank.mapID !== shop.mapID) continue;
      best = consider(best, bankPage, distance(shop, bank));
    }
  }
  if (best !== null) return best;

  const trust = options.crossMapTrustTiles ?? CROSS_MAP_TRUST_TILES;
  for (const [bankPage, bank] of banks) {
    const tiles = distance(shop, bank);
    if (tiles > trust) continue;
    best = consider(best, bankPage, tiles);
  }
  return best;
}

/**
 * Seconds for one bank trip: walk there and back, plus the handover.
 *
 * `secondsPerTile` is a movement-speed assumption, not a per-shop one: walking
 * covers one tile per 0.6 s tick and running two, so 0.6 and 0.3 are the useful
 * values. `handoverSeconds` covers opening the bank and depositing.
 *
 * https://oldschool.runescape.wiki/w/Game_tick
 */
export function bankTripSeconds(
  tiles: number,
  secondsPerTile: number,
  handoverSeconds: number,
): number {
  return 2 * tiles * secondsPerTile + handoverSeconds;
}
