/** Join helpers between a ranked opportunity and the pure domain planners. */

import type { ShopRow } from "../../src/domain/shopPrice";
import type { Opportunity } from "../../src/types";

/** Rebuild the shop price curve from the payload's pricing parameters. */
export function toShopRow(opp: Opportunity): ShopRow {
  return {
    itemValue: opp.itemValue,
    sellMultiplier: opp.sellMultiplier,
    buyMultiplier: opp.buyMultiplier,
    delta: opp.delta,
    baseStock: opp.baseStock ?? 0,
    infiniteStock: opp.infiniteStock,
  };
}

/**
 * Units the GE can absorb in a 4h window, no matter how many shops you visit.
 *
 * `sellablePer4h` is additionally capped by one shop visit's stock, so using it
 * as the budget cap would make world-hopping pointless. The cross-world bound
 * is the 24h volume slice the engine computed. The GE buy limit is a per-player
 * purchase cap and is deliberately not used here.
 */
export function sellableAcrossWorlds(opp: Opportunity): number {
  return Math.max(0, opp.volume4h);
}
