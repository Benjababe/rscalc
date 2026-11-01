/**
 * Turning a per-action profit into an hourly figure when the wiki publishes no
 * rate.
 *
 * The artifact's `gpPerHour` is sourced: it exists only where a tick count, a
 * respawn timer or a published action time does. Fishing publishes none of those,
 * and neither do the bird-snare Hunter creatures, so those rows carry
 * `gpPerHour = null` and the table shows `—` (the §4 rule in
 * `docs/skilling-plan.md`).
 *
 * A player can still answer "what does this earn me" because they know their own
 * rate. The input below therefore fills the **gap** and nothing else:
 *
 *  - a row with a published rate keeps it — a typed number never displaces a
 *    sourced one, because then the table could no longer be told apart from a
 *    guess;
 *  - a row without one uses the player's rate, and says so.
 *
 * The player's figure is capped by what the market can absorb in the window
 * (`marketActions4h / 4`), so typing `1000000` cannot produce a number that no
 * buyer exists for. That is the same "the market is the cap" rule the processing
 * engine applies, expressed per hour instead of per 4h.
 *
 * This is deliberately client-side arithmetic: the artifact is not regenerated for
 * a preference, and `#/earn` keeps ranking on sourced rates only.
 */

import type { SkillActivity } from '../../src/types';

/** Where an hourly figure came from. */
export type RateBasis = 'wiki' | 'manual' | null;

export interface HourlyRate {
  gpPerHour: number | null;
  basis: RateBasis;
  /** The player's figure after the market cap, or null when it was not applied. */
  appliedActionsPerHour: number | null;
  /** True when the market absorbed fewer actions than the player entered. */
  capped: boolean;
}

const NO_RATE: HourlyRate = {
  gpPerHour: null,
  basis: null,
  appliedActionsPerHour: null,
  capped: false,
};

/**
 * The hourly figure for one row.
 *
 * `manualActionsPerHour` of 0 (or less) means "no player rate given", which leaves
 * a rate-less row exactly as the artifact published it: no number.
 */
export function hourlyRate(
  activity: Pick<SkillActivity, 'gpPerHour' | 'profit' | 'marketActions4h'>,
  manualActionsPerHour: number,
): HourlyRate {
  if (activity.gpPerHour !== null) {
    return {
      gpPerHour: activity.gpPerHour,
      basis: 'wiki',
      appliedActionsPerHour: null,
      capped: false,
    };
  }
  if (!Number.isFinite(manualActionsPerHour) || manualActionsPerHour <= 0) {
    return NO_RATE;
  }

  // A 4h action count becomes a per-hour ceiling. `0` would delete a real row, and
  // a row whose market is that thin already carries a null rate, so the floor is 1
  // action/hour rather than 0.
  const ceiling = Math.max(1, Math.floor(activity.marketActions4h / 4));
  const applied = Math.min(manualActionsPerHour, ceiling);
  return {
    gpPerHour: activity.profit * applied,
    basis: 'manual',
    appliedActionsPerHour: applied,
    capped: applied < manualActionsPerHour,
  };
}
