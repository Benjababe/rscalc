/**
 * Minigame rate overrides: the throughput a minigame publishes, applied to the
 * recipes it operates.
 *
 * The recipe bucket describes a transformation and a tick count, and for a furnace
 * that is the right model: one bar, one action, six seconds. A **minigame** breaks
 * that assumption because the published tick count is the *process* time of one
 * item, not the rate a player achieves — at the Blast Furnace the bars are smelted
 * concurrently by the dwarven workers, so the bucket's 11 ticks for a steel bar
 * (545 bars/hour) sits far below the 2,900–3,400 bars/hour the wiki actually
 * documents. Pricing the bucket's number would have been wrong by a factor of five
 * and would have omitted the coffer fee entirely.
 *
 * So a minigame contributes an **overlay**, not a new recipe: its recipes stay the
 * source of the materials (the Blast Furnace bucket rows already halve the coal),
 * and this module replaces the rate and adds the fee.
 *
 * Two deliberate readings, both recorded in `docs/skilling-plan.md` §8.20:
 *
 *  - **A published range is priced at its lower bound.** The wiki writes rates as
 *    `2,900–3,400` because throughput depends on banking and lag. The lower bound is
 *    the same pessimistic reading the gathering model takes of a respawn table.
 *  - **The per-action fee is rounded up.** The coffer charges 12 gp per tick, so the
 *    fee per bar is fractional; rounding up keeps the row conservative and keeps all
 *    money integer, which the rest of the engine assumes.
 */

/** A minigame's published throughput and fee, keyed to the recipes it operates. */
export interface MinigameRate {
  /** The recipe's `facility`, exactly as the bucket writes it. */
  facility: string;
  /**
   * Published actions per hour per output item, at the lower bound of the wiki's
   * range. Only recipes producing **one** unit per action are supported, which is
   * what a bar is.
   */
  actionsPerHour: ReadonlyMap<string, number>;
  /** Coins the minigame charges per hour of play, as the wiki states it. */
  feePerHour: number;
  /** Where the numbers came from, for the artifact's citation and the docs. */
  source: string;
}

export interface MinigameOverlay {
  /** Published actions per hour for this output. */
  actionsPerHour: number;
  /** The hourly fee expressed per action, rounded up to whole gp. */
  feePerAction: number;
}

/**
 * The overlay for one recipe, or null when the minigame does not cover it.
 *
 * Matching is by facility name and output item name, both case-insensitively: the
 * bucket's spelling is stable but a curated list should never fail silently over
 * capitalisation.
 */
export function minigameOverlay(
  rates: readonly MinigameRate[],
  facility: string | null,
  outputItem: string,
): MinigameOverlay | null {
  if (facility === null) return null;
  const byFacility = rates.filter(
    (rate) => rate.facility.toLowerCase() === facility.toLowerCase(),
  );
  if (byFacility.length === 0) return null;

  const needle = outputItem.toLowerCase();
  for (const rate of byFacility) {
    for (const [item, perHour] of rate.actionsPerHour) {
      if (item.toLowerCase() !== needle) continue;
      if (!Number.isFinite(perHour) || perHour <= 0) return null;
      return {
        actionsPerHour: perHour,
        feePerAction: Math.ceil(rate.feePerHour / perHour),
      };
    }
  }
  return null;
}

/** Every output a curated rate table covers, for the "nothing matched" warning. */
export function overlayKeys(rates: readonly MinigameRate[]): Set<string> {
  const keys = new Set<string>();
  for (const rate of rates) {
    for (const item of rate.actionsPerHour.keys()) {
      keys.add(`${rate.facility}|${item}`.toLowerCase());
    }
  }
  return keys;
}
