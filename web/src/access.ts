import { toAccessMap } from "../../src/domain/shopAccess";
import type {
  ShopAccessCatalog,
  ShopAccessEntry,
} from "../../src/types";

import { currentManifest, payload } from "./dataset";

let cached: { dataset: string; map: ReadonlyMap<string, ShopAccessEntry> } | null = null;

/**
 * The whole access table, for callers that join it themselves (the gp-earning
 * leaderboard needs it for three different row families at once).
 *
 * Built on first use from the dataset this page loaded: the artifact arrives over
 * the network now, so it cannot be a module-scope constant.
 */
export function accessMap(): ReadonlyMap<string, ShopAccessEntry> {
  const dataset = currentManifest()?.dataset ?? "";
  if (cached !== null && cached.dataset === dataset) return cached.map;

  // SAFETY: `data/shop-access.json` is written by `scripts/refresh-access.ts`,
  // which validates it with `ShopAccessCatalogSchema`. The server only publishes a
  // file that parsed, so this is the same guarantee the static import had.
  const data = payload("shop-access") as ShopAccessCatalog;
  const map = toAccessMap(data.entries);
  cached = { dataset, map };
  return map;
}

/**
 * The known access requirement for a shop, or undefined when the wiki-backed
 * table does not list one. Undefined means unknown, not "accessible".
 */
export function accessFor(shopPage: string): ShopAccessEntry | undefined {
  return accessMap().get(shopPage);
}
